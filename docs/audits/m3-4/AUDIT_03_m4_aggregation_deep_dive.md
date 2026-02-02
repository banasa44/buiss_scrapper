# AUDIT 3 — M4 Aggregation Deep Dive (Pure + Persistence Wiring)

**Date:** February 2, 2026  
**Scope:** M4 aggregation end-to-end audit (DB query → mapping → pure logic → persistence) to prepare integration + E2E tests  
**Status:** Implementation review only — no production code changes

---

## 1. Aggregation Pipeline Entry Points

### **1.1 Public Entry Points**

#### **Primary Orchestration Function**

**Function:** `aggregateCompanyAndPersist(companyId: number): Company`  
**Location:** `src/signal/aggregation/aggregateCompanyAndPersist.ts`  
**Purpose:** End-to-end orchestration for single company aggregation

**Pipeline Steps:**

1. Query offers from DB via `listCompanyOffersForAggregation(companyId)`
2. Map DB rows via `mapCompanyOfferRows(rows)`
3. Compute aggregation via `aggregateCompany(offers)` (pure function)
4. Map output to DB input format (`CompanyAggregationInput`)
5. Persist via `updateCompanyAggregation(companyId, input)`
6. Return updated `Company` record

**Safe to call multiple times:** Deterministic and idempotent

---

#### **Batch Orchestration Function**

**Function:** `aggregateCompaniesForRun(companyIds: number[]): Promise<AggregateCompaniesResult>`  
**Location:** `src/ingestion/aggregateCompanies.ts`  
**Purpose:** Batch processing with chunking and retry logic

**Features:**

- Chunked execution (50 companies per chunk)
- Per-company retries (max 2 retries)
- Retry delay: 100ms between attempts
- Graceful error handling (log + continue)

**Used by:** End-of-run pipeline after offers + matches persisted

---

### **1.2 Pure Aggregation Function**

**Function:** `aggregateCompany(offers: AggregatableOffer[]): CompanyAggregation`  
**Location:** `src/signal/aggregation/aggregateCompany.ts`

**Properties:**

- ✅ Pure function (no DB access, no side effects)
- ✅ Deterministic (same input → same output)
- ✅ Zero external dependencies
- ✅ Perfect unit test candidate

---

### **1.3 DB Repository Functions**

#### **Query Function**

**Function:** `listCompanyOffersForAggregation(companyId: number): CompanyOfferAggRow[]`  
**Location:** `src/db/repos/offersRepo.ts`

**SQL Strategy:**

```sql
SELECT
  o.id as offerId,
  o.canonical_offer_id as canonicalOfferId,
  o.repost_count as repostCount,
  o.published_at as publishedAt,
  o.updated_at as updatedAt,
  COALESCE(m.score, 0) as score,
  m.matched_keywords_json as matchedKeywordsJson
FROM offers o
LEFT JOIN matches m ON o.id = m.offer_id
WHERE o.company_id = ?
ORDER BY o.id ASC
```

**Key Behaviors:**

- LEFT JOIN ensures **unscored offers included** with `score=0`
- `topCategoryId` parsed from `matched_keywords_json` (contains `ScoreResult`)
- Ordered by `o.id ASC` for **deterministic output**
- JSON parsing failure → `topCategoryId=null` + log warning

---

#### **Persistence Function**

**Function:** `updateCompanyAggregation(companyId: number, input: CompanyAggregationInput): Company`  
**Location:** `src/db/repos/companiesRepo.ts`

**Features:**

- Partial update: only updates fields present in `input`
- Always updates `updated_at` timestamp
- JSON-serializes `category_max_scores` before storage
- Serialization failure → stores `null` + log warning
- Returns updated `Company` record after write
- Throws error if company doesn't exist

---

## 2. Mapping Layer Verification

### **2.1 DB Row Shape**

**Type:** `CompanyOfferAggRow` (from `src/types/db.ts`)

```typescript
type CompanyOfferAggRow = {
  offerId: number;
  canonicalOfferId: number | null; // null = canonical offer
  repostCount: number; // activity counter
  publishedAt: string | null; // ISO timestamp
  updatedAt: string | null; // ISO timestamp
  score: number; // 0..10, or 0 if unscored
  topCategoryId: string | null; // parsed from matched_keywords_json
};
```

**Source Query:** LEFT JOIN between `offers` and `matches` tables

---

### **2.2 Transformation to AggregatableOffer**

**Function:** `mapCompanyOfferRows(rows: CompanyOfferAggRow[]): AggregatableOffer[]`  
**Location:** `src/signal/aggregation/mapCompanyOfferRows.ts`

**Mapping Rules:**

| AggregatableOffer Field | Source                 | Transformation                                  |
| ----------------------- | ---------------------- | ----------------------------------------------- |
| `offerId`               | `row.offerId`          | Direct copy                                     |
| `score`                 | `row.score`            | Direct copy (0..10)                             |
| `categoryId`            | `row.topCategoryId`    | Direct copy (may be null)                       |
| `isStrong`              | Computed               | `row.score >= STRONG_THRESHOLD` (threshold = 6) |
| `publishedAt`           | `row.publishedAt`      | Direct copy (ISO string or null)                |
| `updatedAt`             | `row.updatedAt`        | Direct copy (ISO string or null)                |
| `canonicalOfferId`      | `row.canonicalOfferId` | Direct copy (null = canonical)                  |
| `repostCount`           | `row.repostCount`      | Direct copy                                     |

**Pure Transformation:** No DB access, no side effects, no logging

---

### **2.3 topCategoryId Parsing**

**Function:** `parseTopCategoryId(json: string | null, offerId: number): string | null`  
**Location:** `src/db/repos/offersRepo.ts` (private helper)

**Algorithm:**

```typescript
if (!json) return null;

try {
  const parsed = JSON.parse(json);
  return parsed.topCategoryId ?? null;
} catch (err) {
  warn("Failed to parse topCategoryId from matched_keywords_json", {
    offerId,
    error: String(err),
  });
  return null;
}
```

**Error Handling:**

- Null JSON → `null` (no warning)
- Parse failure → `null` + log warning (uses `@/logger`)
- Missing field → `null` (no warning)
- Invalid type → `null` (captured by `?? null`)

**Expected JSON Structure:**

```json
{
  "score": 8,
  "topCategoryId": "cat_cloud_infra",
  "reasons": { ... }
}
```

---

## 3. Pure Aggregation Logic Verification

**Function:** `aggregateCompany(offers: AggregatableOffer[]): CompanyAggregation`

### **3.1 Canonical Offers Definition**

```typescript
const canonicalOffers = offers.filter((o) => o.canonicalOfferId === null);
```

**Rule:** An offer is canonical if `canonicalOfferId === null`

**Implication:**

- Duplicate offers (where `canonicalOfferId !== null`) are **excluded** from all metrics
- Only canonical offers contribute to scoring aggregation

---

### **3.2 Core Metrics**

#### **offerCount (Activity-Weighted)**

```typescript
const offerCount = canonicalOffers.reduce(
  (sum, o) => sum + (1 + o.repostCount),
  0,
);
```

**Formula:** `Σ(1 + repostCount)` for each canonical offer

**Examples:**

- 1 canonical offer, 0 reposts → `offerCount = 1`
- 1 canonical offer, 3 reposts → `offerCount = 4`
- 2 canonical offers, 2 reposts each → `offerCount = 6` (3+3)

**Purpose:** Measures total activity (including repost signals)

---

#### **uniqueOfferCount**

```typescript
const uniqueOfferCount = canonicalOffers.length;
```

**Formula:** Count of canonical offers only

**Examples:**

- 1 canonical offer, 10 reposts → `uniqueOfferCount = 1`
- 5 canonical offers (any reposts) → `uniqueOfferCount = 5`

**Purpose:** Measures distinct job posting count

---

#### **strongOfferCount**

```typescript
const strongCanonicalOffers = canonicalOffers.filter((o) => o.isStrong);
const strongOfferCount = strongCanonicalOffers.length;
```

**Formula:** Count of canonical offers where `score >= STRONG_THRESHOLD` (6)

**NOT Weighted:** Reposts do NOT increase strong count

**Examples:**

- 1 strong canonical offer, 10 reposts → `strongOfferCount = 1`
- 2 strong canonical offers → `strongOfferCount = 2`

---

#### **avgStrongScore**

```typescript
const avgStrongScore =
  strongOfferCount > 0
    ? strongCanonicalOffers.reduce((sum, o) => sum + o.score, 0) /
      strongOfferCount
    : null;
```

**Formula:** Simple average of strong canonical offer scores

**NOT Weighted:** Reposts do NOT affect average

**Null Case:** Returns `null` if no strong offers (not 0)

**Examples:**

- No strong offers → `avgStrongScore = null`
- 1 strong offer (score 8) → `avgStrongScore = 8.0`
- 2 strong offers (scores 7, 9) → `avgStrongScore = 8.0`
- 3 strong offers (scores 6, 8, 10) → `avgStrongScore = 8.0`

---

#### **maxScore**

```typescript
let topOffer = canonicalOffers[0];
for (const offer of canonicalOffers) {
  if (
    offer.score > topOffer.score ||
    (offer.score === topOffer.score &&
      compareTimestamps(getOfferTimestamp(offer), getOfferTimestamp(topOffer)) >
        0)
  ) {
    topOffer = offer;
  }
}
const maxScore = topOffer.score;
```

**Formula:** Max score across canonical offers

**Tie-Breaker:** If scores equal, select **most recent timestamp**

---

### **3.3 Top Offer Selection Rules**

**Algorithm:**

1. Iterate through all canonical offers
2. Select offer with highest `score`
3. **Tie-breaker:** If `score` equal, select most recent timestamp
4. Extract `topOfferId`, `topCategoryId` from selected offer

**Timestamp Priority:** `publishedAt` > `updatedAt` > `null`

**Timestamp Comparison:**

```typescript
function compareTimestamps(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1; // null is "older"
  if (!b) return 1; // non-null is "newer"
  return a.localeCompare(b); // lexicographic comparison (ISO strings)
}
```

**Edge Cases:**

- Both timestamps null → first offer in array order wins
- One timestamp null → non-null timestamp wins
- Both timestamps present → lexicographic comparison (ISO format sorts chronologically)

---

### **3.4 lastStrongAt Derivation**

```typescript
let lastStrongAt: string | null = null;
for (const offer of strongCanonicalOffers) {
  const timestamp = getOfferTimestamp(offer);
  if (
    timestamp &&
    (!lastStrongAt || compareTimestamps(timestamp, lastStrongAt) > 0)
  ) {
    lastStrongAt = timestamp;
  }
}
```

**Formula:** Most recent timestamp among strong canonical offers

**Rules:**

- Only strong offers considered (score >= 6)
- Timestamp priority: `publishedAt` > `updatedAt` > `null`
- Null timestamps skipped
- If no strong offers with valid timestamps → `lastStrongAt = null`

**Examples:**

- No strong offers → `lastStrongAt = null`
- 1 strong offer (published 2026-01-15) → `lastStrongAt = "2026-01-15T..."`
- 2 strong offers (published 2026-01-10, 2026-01-20) → `lastStrongAt = "2026-01-20T..."`
- Strong offer with null timestamps → `lastStrongAt = null`

---

### **3.5 categoryMaxScores Shape and Behavior**

```typescript
const categoryMaxScores: Record<string, number> = {};
for (const offer of canonicalOffers) {
  if (offer.categoryId) {
    const currentMax = categoryMaxScores[offer.categoryId] ?? 0;
    if (offer.score > currentMax) {
      categoryMaxScores[offer.categoryId] = offer.score;
    }
  }
}
```

**Type:** `Record<string, number>` — plain JavaScript object

**Algorithm:**

1. For each canonical offer
2. Skip if `categoryId` is null
3. Track max score per category
4. Overwrite only if new score is higher

**Examples:**

```typescript
// 1 offer: categoryId="cat_cloud", score=8
{ "cat_cloud": 8 }

// 2 offers, same category: scores 6, 8
{ "cat_cloud": 8 }

// 2 offers, different categories
{ "cat_cloud": 8, "cat_ads": 7 }

// Offer with null categoryId
// (skipped, not included in map)
```

**Edge Cases:**

- Empty offers → `{}`
- All offers have null categoryId → `{}`
- Same category, multiple scores → max wins

---

### **3.6 Edge Case: No Canonical Offers**

```typescript
if (canonicalOffers.length === 0) {
  return {
    maxScore: 0,
    offerCount: 0,
    uniqueOfferCount: 0,
    strongOfferCount: 0,
    avgStrongScore: null, // null, not 0
    topCategoryId: null,
    topOfferId: null,
    categoryMaxScores: {}, // empty object
    lastStrongAt: null,
  };
}
```

**Trigger:** All offers are duplicates (no canonical offers in input)

**Behavior:** Returns zero/null metrics with empty categoryMaxScores

---

## 4. Persistence Layer Verification

### **4.1 Updated Company Fields**

**Table:** `companies` (schema from `migrations/0003_company_aggregation_signals.sql`)

**Columns Updated:**

| Column                | Type    | Nullable | Source                                        |
| --------------------- | ------- | -------- | --------------------------------------------- |
| `max_score`           | REAL    | Yes      | `aggregation.maxScore`                        |
| `offer_count`         | INTEGER | Yes      | `aggregation.offerCount`                      |
| `unique_offer_count`  | INTEGER | Yes      | `aggregation.uniqueOfferCount`                |
| `strong_offer_count`  | INTEGER | Yes      | `aggregation.strongOfferCount`                |
| `avg_strong_score`    | REAL    | Yes      | `aggregation.avgStrongScore`                  |
| `top_category_id`     | TEXT    | Yes      | `aggregation.topCategoryId`                   |
| `top_offer_id`        | INTEGER | Yes      | `aggregation.topOfferId`                      |
| `category_max_scores` | TEXT    | Yes      | JSON.stringify(aggregation.categoryMaxScores) |
| `last_strong_at`      | TEXT    | Yes      | `aggregation.lastStrongAt`                    |
| `updated_at`          | TEXT    | No       | `datetime('now')`                             |

**Always Updated:** `updated_at` timestamp (even if no other fields change)

---

### **4.2 JSON Serialization Format**

**Field:** `category_max_scores`

**Storage Type:** TEXT (JSON string)

**Serialization:**

```typescript
if (input.category_max_scores !== undefined) {
  let serialized: string | null = null;
  if (input.category_max_scores !== null) {
    try {
      serialized = JSON.stringify(input.category_max_scores);
    } catch (err) {
      warn("Failed to serialize category_max_scores, storing null", {
        companyId,
        error: String(err),
      });
      serialized = null;
    }
  }
  updates.push("category_max_scores = ?");
  values.push(serialized);
}
```

**Error Handling:**

- Serialization failure → store `null` + log warning (via `@/logger`)
- Input is `null` → store `null` (no warning)
- Input is `undefined` → skip update (partial update semantics)

**Example Stored Values:**

```json
// Valid serialization
"{\"cat_cloud\":8,\"cat_ads\":7}"

// Null case
null

// Empty object case
"{}"
```

**Deserialization:** Consumer's responsibility (not handled by aggregation pipeline)

---

### **4.3 Idempotency Expectations**

**Safe to Run Multiple Times:**

- Pure aggregation function is deterministic
- DB update uses `UPDATE` statement (overwrites existing values)
- No incrementing or additive logic
- Same input → same DB state

**Concurrent Safety:**

- SQLite default isolation (serializable)
- Single UPDATE statement is atomic
- No multi-step transactions in aggregation path

**Idempotency Test:**

```
Run 1: aggregateCompanyAndPersist(1)
  → company.max_score = 8

Run 2: aggregateCompanyAndPersist(1) (no new offers)
  → company.max_score = 8 (unchanged)

Run 3: aggregateCompanyAndPersist(1) (new offer added)
  → company.max_score = 9 (deterministic update)
```

**Partial Update Semantics:**

- Only fields in `CompanyAggregationInput` are updated
- Missing fields are **not nulled** (skipped in UPDATE)
- In practice, aggregation always sets all 9 fields atomically

---

## 5. Constants and Tunables

### **5.1 Strong Threshold**

**Constant:** `STRONG_THRESHOLD = 6`  
**Location:** `src/constants/scoring.ts`  
**Usage:**

- `isStrong = score >= STRONG_THRESHOLD` (mapping layer)
- `strongOfferCount` calculation (pure aggregation)
- `avgStrongScore` calculation (pure aggregation)
- `lastStrongAt` filtering (pure aggregation)

---

### **5.2 Batch Processing Constants**

**Location:** `src/ingestion/aggregateCompanies.ts`

| Constant         | Value | Purpose                      |
| ---------------- | ----- | ---------------------------- |
| `CHUNK_SIZE`     | 50    | Companies per batch          |
| `MAX_RETRIES`    | 2     | Retry attempts per company   |
| `RETRY_DELAY_MS` | 100   | Milliseconds between retries |

---

### **5.3 Timestamp Priority**

**Hardcoded Logic:** `publishedAt` > `updatedAt` > `null`

**Function:** `getOfferTimestamp(offer: AggregatableOffer): string | null`

```typescript
return offer.publishedAt ?? offer.updatedAt ?? null;
```

**Rationale:**

- `publishedAt` is canonical publication date (preferred)
- `updatedAt` is fallback for modified offers
- `null` if neither available

---

## 6. External Data Reliability Handling

### **6.1 Missing Dates**

| Scenario                                | Behavior                             | Impact                              |
| --------------------------------------- | ------------------------------------ | ----------------------------------- |
| Both `publishedAt` and `updatedAt` null | `getOfferTimestamp()` returns `null` | Excluded from timestamp comparisons |
| Tie-breaker with null timestamp         | Null treated as "older"              | Non-null timestamp wins             |
| `lastStrongAt` with all null timestamps | `lastStrongAt = null`                | No freshness indicator              |

---

### **6.2 Missing Categories**

| Scenario                                   | Behavior                            | Impact                       |
| ------------------------------------------ | ----------------------------------- | ---------------------------- |
| `topCategoryId` is `null` (unscored offer) | Skipped in `categoryMaxScores` loop | Not included in category map |
| All offers have `null` categoryId          | `categoryMaxScores = {}`            | Empty category map           |
| Top offer has `null` categoryId            | `topCategoryId = null`              | Valid state for persistence  |

---

### **6.3 JSON Parsing Failures**

| Scenario                                  | Behavior               | Logging                       |
| ----------------------------------------- | ---------------------- | ----------------------------- |
| `matched_keywords_json` is `null`         | `topCategoryId = null` | No warning                    |
| `matched_keywords_json` parse error       | `topCategoryId = null` | Warning logged with offerId   |
| `topCategoryId` field missing in JSON     | `topCategoryId = null` | No warning (valid case)       |
| `category_max_scores` serialization fails | Store `null`           | Warning logged with companyId |

---

## 7. Determinism and Tie-Breakers

### **7.1 Top Offer Selection**

**Deterministic Conditions:**

1. Unique max score → deterministic (highest score wins)
2. Tie on score, unique timestamps → deterministic (most recent wins)
3. Tie on score, one null timestamp → deterministic (non-null wins)
4. Tie on score, both null timestamps → **non-deterministic** (array order)

**Non-Deterministic Edge Case:**

```typescript
// Two offers with same score, both timestamps null
offers = [
  { offerId: 1, score: 8, publishedAt: null, updatedAt: null },
  { offerId: 2, score: 8, publishedAt: null, updatedAt: null },
];
// Result depends on array order (offerId: 1 wins in this case)
```

**Mitigation:** Deterministic SQL ordering (`ORDER BY o.id ASC`) ensures consistent array order

---

### **7.2 Category Max Scores**

**Deterministic:** Last-write-wins within loop (order doesn't matter, max value is deterministic)

```typescript
// Order-independent (max is commutative)
offers = [
  { categoryId: "cat_cloud", score: 6 },
  { categoryId: "cat_cloud", score: 8 },
];
// Result: { "cat_cloud": 8 } (regardless of order)
```

---

### **7.3 Average Strong Score**

**Deterministic:** Simple arithmetic mean (commutative)

```typescript
// Order-independent
strongOffers = [{ score: 6 }, { score: 8 }, { score: 10 }];
// Result: avgStrongScore = (6 + 8 + 10) / 3 = 8.0 (always)
```

---

## 8. Minimal Spec: M4 Guarantees

### **What M4 Must Guarantee**

1. **Determinism:** Same company offers → same aggregation output
2. **Canonical-Only Metrics:** Only offers with `canonicalOfferId === null` contribute
3. **Activity Weighting:** `offerCount` includes reposts; `strongOfferCount` does NOT
4. **Null Safety:** `avgStrongScore` is `null` (not 0) when no strong offers
5. **Timestamp Priority:** `publishedAt` > `updatedAt` > `null`
6. **Top Offer Tie-Break:** Most recent timestamp wins (null is "older")
7. **Category Max:** Highest score per category (across canonical offers only)
8. **Freshness:** `lastStrongAt` is most recent strong offer timestamp
9. **Idempotency:** Safe to run multiple times on same company
10. **Partial Failure Isolation:** One company failure doesn't block others (batch mode)
11. **Error Logging:** JSON parse/serialize failures logged via `@/logger`
12. **Graceful Degradation:** Missing timestamps/categories handled as `null`

---

## 9. Recommended Unit Tests (Pure Aggregation)

**Target Function:** `aggregateCompany(offers: AggregatableOffer[]): CompanyAggregation`

### **Test 1: Empty Input**

**Name:** `aggregateCompany_empty_input_returns_zero_metrics`  
**Input:** `[]`  
**Expected:** All metrics = 0 or null, `categoryMaxScores = {}`

---

### **Test 2: No Canonical Offers (All Duplicates)**

**Name:** `aggregateCompany_all_duplicates_returns_zero_metrics`  
**Input:** `[{ canonicalOfferId: 1, score: 8 }]` (all are duplicates)  
**Expected:** Same as empty input (duplicates ignored)

---

### **Test 3: Single Canonical Offer**

**Name:** `aggregateCompany_single_canonical_offer`  
**Input:** `[{ offerId: 1, canonicalOfferId: null, score: 8, repostCount: 0, isStrong: true, categoryId: "cat_cloud", publishedAt: "2026-01-15T10:00:00Z" }]`  
**Expected:**

- `maxScore = 8`
- `offerCount = 1`
- `uniqueOfferCount = 1`
- `strongOfferCount = 1`
- `avgStrongScore = 8.0`
- `topOfferId = 1`
- `topCategoryId = "cat_cloud"`
- `categoryMaxScores = { "cat_cloud": 8 }`
- `lastStrongAt = "2026-01-15T10:00:00Z"`

---

### **Test 4: Activity Weighting (Reposts)**

**Name:** `aggregateCompany_activity_weighted_offer_count`  
**Input:** `[{ canonicalOfferId: null, score: 8, repostCount: 3 }]`  
**Expected:** `offerCount = 4` (1 + 3), `uniqueOfferCount = 1`

---

### **Test 5: Strong Offer Count NOT Weighted**

**Name:** `aggregateCompany_strong_count_not_weighted_by_reposts`  
**Input:** `[{ canonicalOfferId: null, score: 7, repostCount: 10, isStrong: true }]`  
**Expected:** `strongOfferCount = 1` (not 11), `offerCount = 11`

---

### **Test 6: Average Strong Score (Null Case)**

**Name:** `aggregateCompany_avg_strong_score_null_when_no_strong`  
**Input:** `[{ score: 4, isStrong: false }, { score: 5, isStrong: false }]`  
**Expected:** `avgStrongScore = null` (not 0)

---

### **Test 7: Average Strong Score Calculation**

**Name:** `aggregateCompany_avg_strong_score_simple_mean`  
**Input:** `[{ score: 6, isStrong: true }, { score: 8, isStrong: true }, { score: 10, isStrong: true }]`  
**Expected:** `avgStrongScore = 8.0` ((6+8+10)/3)

---

### **Test 8: Top Offer Tie-Break by Timestamp**

**Name:** `aggregateCompany_top_offer_tie_break_by_timestamp`  
**Input:**

```typescript
[
  { offerId: 1, score: 8, publishedAt: "2026-01-10T00:00:00Z" },
  { offerId: 2, score: 8, publishedAt: "2026-01-20T00:00:00Z" }, // newer
];
```

**Expected:** `topOfferId = 2` (most recent)

---

### **Test 9: Timestamp Priority (publishedAt > updatedAt)**

**Name:** `aggregateCompany_timestamp_priority_published_over_updated`  
**Input:**

```typescript
[
  {
    offerId: 1,
    score: 8,
    publishedAt: "2026-01-10T00:00:00Z",
    updatedAt: "2026-01-25T00:00:00Z",
  },
  {
    offerId: 2,
    score: 8,
    publishedAt: "2026-01-20T00:00:00Z",
    updatedAt: "2026-01-05T00:00:00Z",
  },
];
```

**Expected:** `topOfferId = 2` (publishedAt wins, not updatedAt)

---

### **Test 10: Category Max Scores (Multiple Categories)**

**Name:** `aggregateCompany_category_max_scores_different_categories`  
**Input:**

```typescript
[
  { categoryId: "cat_cloud", score: 8 },
  { categoryId: "cat_ads", score: 7 },
  { categoryId: "cat_cloud", score: 6 }, // lower score
];
```

**Expected:** `categoryMaxScores = { "cat_cloud": 8, "cat_ads": 7 }`

---

### **Test 11: Category Max Scores (Null Category Skipped)**

**Name:** `aggregateCompany_null_category_skipped_in_max_scores`  
**Input:**

```typescript
[
  { categoryId: "cat_cloud", score: 8 },
  { categoryId: null, score: 9 }, // higher score but no category
];
```

**Expected:** `categoryMaxScores = { "cat_cloud": 8 }`, `topOfferId` = offer with score 9

---

### **Test 12: lastStrongAt (Most Recent Strong)**

**Name:** `aggregateCompany_last_strong_at_most_recent`  
**Input:**

```typescript
[
  { score: 7, isStrong: true, publishedAt: "2026-01-10T00:00:00Z" },
  { score: 6, isStrong: true, publishedAt: "2026-01-20T00:00:00Z" }, // more recent
  { score: 4, isStrong: false, publishedAt: "2026-01-25T00:00:00Z" }, // not strong
];
```

**Expected:** `lastStrongAt = "2026-01-20T00:00:00Z"`

---

## 10. Recommended Integration Tests (Persistence)

**Target Function:** `aggregateCompanyAndPersist(companyId: number): Company`

### **Test 1: Fresh Aggregation (Null → Populated)**

**Name:** `aggregation_persist_fresh_company_null_to_populated`  
**Setup:** Create company with offers, no prior aggregation (all fields null)  
**Action:** `aggregateCompanyAndPersist(companyId)`  
**Verify:** All aggregation fields populated in DB, `updated_at` changed

---

### **Test 2: Re-Aggregation (Idempotency)**

**Name:** `aggregation_persist_idempotent_same_offers`  
**Setup:** Run aggregation twice on same company (no offer changes)  
**Action:** `aggregateCompanyAndPersist(companyId)` → `aggregateCompanyAndPersist(companyId)`  
**Verify:** Second run produces identical DB state (no changes except `updated_at`)

---

### **Test 3: Aggregation Update (New Offers)**

**Name:** `aggregation_persist_update_after_new_offers`  
**Setup:** Run aggregation, add new scored offers, re-run aggregation  
**Action:** `aggregateCompanyAndPersist(companyId)` → insert offers → `aggregateCompanyAndPersist(companyId)`  
**Verify:** Metrics updated correctly (`maxScore`, `offerCount` reflect new offers)

---

### **Test 4: JSON Serialization (category_max_scores)**

**Name:** `aggregation_persist_json_serialization_category_max_scores`  
**Setup:** Company with offers in multiple categories  
**Action:** `aggregateCompanyAndPersist(companyId)`  
**Verify:** `category_max_scores` field contains valid JSON string, deserializes correctly

---

### **Test 5: No Canonical Offers (Zero Metrics)**

**Name:** `aggregation_persist_no_canonical_offers_zero_metrics`  
**Setup:** Company with only duplicate offers (all have `canonicalOfferId !== null`)  
**Action:** `aggregateCompanyAndPersist(companyId)`  
**Verify:** All metrics = 0 or null, `category_max_scores = "{}"`

---

### **Test 6: Nonexistent Company Error**

**Name:** `aggregation_persist_nonexistent_company_throws`  
**Setup:** No company with given ID  
**Action:** `aggregateCompanyAndPersist(99999)`  
**Verify:** Throws error with message "Cannot update aggregation: company id 99999 does not exist"

---

## 11. External Dependencies and Logging

### **11.1 Logger Usage**

**Import:** `import { warn } from "@/logger"`

**Usage Locations:**

| File                    | Function                     | Trigger                | Message                                                    |
| ----------------------- | ---------------------------- | ---------------------- | ---------------------------------------------------------- |
| `offersRepo.ts`         | `parseTopCategoryId()`       | JSON parse failure     | "Failed to parse topCategoryId from matched_keywords_json" |
| `companiesRepo.ts`      | `updateCompanyAggregation()` | JSON stringify failure | "Failed to serialize category_max_scores, storing null"    |
| `aggregateCompanies.ts` | `aggregateWithRetry()`       | Retry attempt          | "Company aggregation attempt failed, will retry"           |
| `aggregateCompanies.ts` | `aggregateWithRetry()`       | All retries failed     | "Company aggregation failed after all retries"             |

**No Console Logging:** All logging goes through project logger (`@/logger`)

---

## Conclusion

**M4 Aggregation Pipeline is Well-Structured:**

- Clear separation: DB query → mapping → pure logic → persistence
- Deterministic pure function perfect for unit testing
- Graceful error handling with logging
- Idempotent persistence safe for retries

**Critical Testing Targets:**

- **Pure aggregation (12 unit tests):** Cover all metric formulas, edge cases, tie-breakers
- **Persistence (6 integration tests):** Verify DB writes, idempotency, JSON serialization

**Identified Edge Cases:**

- No canonical offers (all duplicates) → zero metrics
- No strong offers → `avgStrongScore = null`
- Null timestamps → excluded from comparisons
- Null categories → skipped in `categoryMaxScores`
- JSON parse/serialize failures → log warning + store null

**Ready for Test Implementation:** All behaviors documented, no ambiguities found.
