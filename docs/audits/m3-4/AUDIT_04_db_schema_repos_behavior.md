# AUDIT 4: DB Schema + Repos Behavior

**Goal**: Understand DB layer invariants, uniqueness constraints, and idempotent behaviors to inform M3/M4 integration tests.

**Audit Date**: 2024
**Scope**: Migrations 0001-0005 + repos (companies, offers, matches, runs)

---

## 1. Schema Structure (Migrations 0001-0005)

### Migration Timeline

1. **0001_init.sql** - Base schema
2. **0002_company_sources_and_global_companies.sql** - Company identity refactor
3. **0003_company_aggregation_signals.sql** - M4 aggregation fields
4. **0004_offer_canonicalization.sql** - Duplicate detection fields
5. **0005_add_run_aggregation_counters.sql** - Run-level aggregation tracking

---

## 2. Table-by-Table Analysis

### 2.1 `companies` Table

**Purpose**: Global company identity hub (1 company across all providers)

**Schema**:

```sql
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_raw TEXT,
  name_display TEXT,
  normalized_name TEXT,
  website_url TEXT,
  website_domain TEXT,

  -- M4 aggregation signals (migration 0003)
  max_score REAL,
  offer_count INTEGER,
  unique_offer_count INTEGER,
  strong_offer_count INTEGER,
  avg_strong_score REAL,
  top_category_id TEXT,
  top_offer_id INTEGER,
  category_max_scores TEXT,  -- JSON {categoryId: maxScore}
  last_strong_at TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  UNIQUE(website_domain),
  UNIQUE(normalized_name)
);
CREATE INDEX idx_companies_normalized_name ON companies(normalized_name);
CREATE INDEX idx_companies_website_domain ON companies(website_domain);
```

**Uniqueness Constraints**:

- `UNIQUE(website_domain)` - Strongest identity signal
- `UNIQUE(normalized_name)` - Fallback identity signal
- Both constraints allow NULL (multiple NULL values permitted)

**Repo Behavior** (`companiesRepo.ts`):

**`upsertCompany(input: CompanyInput)`**:

- **Identity Resolution Order**:
  1. If `website_domain` present: lookup by domain
  2. Else: lookup by `normalized_name`
  3. If neither present: throws error
- **Conflict Strategy**: SELECT-then-UPDATE or INSERT
  - Not true upsert - uses application logic to resolve
  - Updates enrich existing fields with `COALESCE(?, existing)` (never overwrites with null)
- **Returns**: company_id

**`upsertCompanySource(input: CompanySourceInput)`**:

- Links global company to provider-specific identifier
- Conflict key: `(provider, provider_company_id)` if present
- Otherwise: just insert (allows multiple sources per provider)

**`updateCompanyAggregation(companyId, input)`**:

- **Partial update**: Only updates fields present in `input`
- **Deterministic**: Never nullifies fields not in input
- **JSON handling**: `category_max_scores` serialized; logs warning on failure
- **Throws**: If company doesn't exist

---

### 2.2 `company_sources` Table

**Purpose**: Provider-specific company metadata (N:1 with companies)

**Schema**:

```sql
CREATE TABLE company_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  provider TEXT NOT NULL,
  provider_company_id TEXT,
  provider_company_url TEXT,
  hidden INTEGER,
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_company_sources_company_id ON company_sources(company_id);
CREATE INDEX idx_company_sources_provider ON company_sources(provider, provider_company_id);
```

**Uniqueness**: No unique constraint (allows multiple sources per provider)

- Implicit uniqueness via `(provider, provider_company_id)` in repo logic

**Repo Behavior**:

- If `provider_company_id` present: SELECT-then-UPDATE or INSERT
- Otherwise: just insert

---

### 2.3 `offers` Table

**Purpose**: Job offers from providers, linked to global companies

**Schema**:

```sql
CREATE TABLE offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_offer_id TEXT NOT NULL,
  provider_url TEXT,
  company_id INTEGER NOT NULL REFERENCES companies(id),

  -- Content fields
  title TEXT NOT NULL,
  description TEXT,
  min_requirements TEXT,
  desired_requirements TEXT,
  requirements_snippet TEXT,

  -- Timestamps
  published_at TEXT,
  updated_at TEXT,
  created_at TEXT,
  last_updated_at TEXT DEFAULT (datetime('now')),

  -- Metadata
  applications_count INTEGER,
  metadata_json TEXT,
  raw_json TEXT,

  -- M4 canonicalization (migration 0004)
  canonical_offer_id INTEGER REFERENCES offers(id),
  repost_count INTEGER DEFAULT 0,
  last_seen_at TEXT,
  content_fingerprint TEXT,

  UNIQUE(provider, provider_offer_id)
);
CREATE INDEX idx_offers_company_id ON offers(company_id);
CREATE INDEX idx_offers_canonical_offer_id ON offers(canonical_offer_id);
CREATE INDEX idx_offers_fingerprint_company ON offers(content_fingerprint, company_id);
```

**Uniqueness Constraints**:

- `UNIQUE(provider, provider_offer_id)` - Canonical offer identity from provider
- Allows re-ingestion of same offer without duplication

**Canonicalization Model** (M4):

- `canonical_offer_id = NULL` → This IS the canonical offer
- `canonical_offer_id = <id>` → This is a duplicate pointing to canonical
- `repost_count` → Incremented when duplicates detected
- `content_fingerprint` → Hash of (title + description + requirements) for deduplication
- `last_seen_at` → Last time duplicate was seen

**Repo Behavior** (`offersRepo.ts`):

**`upsertOffer(input: OfferInput)`**:

- **True upsert**: `INSERT ... ON CONFLICT(provider, provider_offer_id) DO UPDATE`
- **Overwrites**: All content fields (title, description, requirements, etc.)
- **Excludes**: Canonicalization fields (`canonical_offer_id`, `content_fingerprint`, `last_seen_at`) - managed only by M4
- **Updates**: `last_updated_at` on both insert and update
- **Returns**: offer_id

**`markOfferAsDuplicate(offerId, canonicalOfferId)`**:

- Sets `canonical_offer_id = canonicalOfferId`
- Throws if offer doesn't exist

**`incrementOfferRepostCount(offerId, lastSeenAt)`**:

- Increments `repost_count` by 1
- Updates `last_seen_at` if provided (COALESCE logic)
- Throws if offer doesn't exist

**`updateOfferCanonical(offerId, input)`**:

- Partial update for canonicalization fields only
- Only updates fields present in `input`
- Throws if offer doesn't exist

**`findCanonicalOffersByFingerprint(contentFingerprint, companyId)`**:

- Returns offers WHERE `content_fingerprint = ? AND company_id = ? AND canonical_offer_id IS NULL`
- Used by M4 dedupe to find potential duplicates within same company

**`listCompanyOffersForAggregation(companyId)`**:

- Joins offers with matches (LEFT JOIN to include unscored offers)
- Returns minimal data for M4 aggregation
- **Ordering**: `ORDER BY o.id ASC` (deterministic)
- Parses `topCategoryId` from `matched_keywords_json`

---

### 2.4 `matches` Table

**Purpose**: Scoring results (1:1 with offers)

**Schema**:

```sql
CREATE TABLE matches (
  offer_id INTEGER PRIMARY KEY REFERENCES offers(id),
  score REAL NOT NULL,
  matched_keywords_json TEXT,
  reasons TEXT,
  computed_at TEXT
);
```

**Uniqueness**: `offer_id` is PRIMARY KEY (1:1 relationship with offers)

**Repo Behavior** (`matchesRepo.ts`):

**`upsertMatch(input: MatchInput)`**:

- **True upsert**: `INSERT ... ON CONFLICT(offer_id) DO UPDATE`
- **Overwrites**: All fields (score, matched_keywords_json, reasons)
- **Always updates**: `computed_at = datetime('now')`
- **No return value** (void)

**Key Insight**: Scoring is fully recomputable - no preservation of old scores

---

### 2.5 `ingestion_runs` Table

**Purpose**: Batch execution tracking

**Schema**:

```sql
CREATE TABLE ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  query_fingerprint TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT,
  pages_fetched INTEGER,
  offers_fetched INTEGER,
  requests_count INTEGER,
  http_429_count INTEGER,
  errors_count INTEGER,
  notes TEXT,

  -- M4 aggregation counters (migration 0005)
  companies_aggregated INTEGER,
  companies_failed INTEGER
);
CREATE INDEX idx_runs_provider ON ingestion_runs(provider);
CREATE INDEX idx_runs_query_fingerprint ON ingestion_runs(query_fingerprint);
```

**Uniqueness**: None (multiple runs for same provider/query allowed)

**Repo Behavior** (`runsRepo.ts`):

**`createRun(input: IngestionRunInput)`**:

- Simple INSERT
- Returns: run_id

**`finishRun(runId, update: IngestionRunUpdate)`**:

- Partial update: only updates fields present in `update`
- No conflict handling (assumes run exists)
- Silently succeeds if no fields provided

---

## 3. DB Invariants for M3/M4 Testing

### INV-1: Company Identity Resolution

**Invariant**: A company can be looked up by either `website_domain` OR `normalized_name`, but at least one must be present.

**Violation**: `upsertCompany()` throws if both are null.

**Test Implications**:

- Integration tests must verify that offers with same domain → same company_id
- Integration tests must verify that offers with same normalized_name (no domain) → same company_id
- Edge case: Domain vs. name conflict resolution (domain wins)

---

### INV-2: Offer Provider Identity

**Invariant**: An offer is uniquely identified by `(provider, provider_offer_id)`. Re-ingesting the same offer overwrites content but preserves canonicalization state.

**Test Implications**:

- Re-running ingestion with same offers should be idempotent (same company linkage, updated content)
- Canonicalization fields should NOT be overwritten by re-ingestion

---

### INV-3: Match-Offer 1:1 Relationship

**Invariant**: Each offer has at most 1 match row. Rescoring overwrites previous match.

**Test Implications**:

- Running M3 twice on same offer should yield identical match row (deterministic scoring)
- No orphan matches allowed (offer must exist)

---

### INV-4: Canonical Offer Semantics

**Invariant**: If `canonical_offer_id IS NULL`, this offer is canonical. If `canonical_offer_id IS NOT NULL`, this is a duplicate pointing to a canonical offer.

**Derived Invariant**: `canonical_offer_id` must reference an existing offer with `canonical_offer_id IS NULL` (transitive closure not allowed: canonical → duplicate → canonical).

**Test Implications**:

- M4 dedupe logic must never set a duplicate as canonical
- Querying canonical offers: `WHERE canonical_offer_id IS NULL`
- Querying duplicates: `WHERE canonical_offer_id IS NOT NULL`

---

### INV-5: Company Aggregation Partial Updates

**Invariant**: `updateCompanyAggregation()` only updates fields present in input. Fields not in input are preserved.

**Test Implications**:

- Running aggregation twice with different field subsets should combine results
- No field should ever be nullified by aggregation (unless explicitly set to null)

---

### INV-6: Deterministic Aggregation Ordering

**Invariant**: `listCompanyOffersForAggregation()` returns offers ordered by `offers.id ASC`.

**Test Implications**:

- Aggregation results must be deterministic given same DB state
- Tests should verify stable ordering when multiple offers have same score

---

### INV-7: Content Fingerprint Uniqueness Within Company

**Invariant**: M4 dedupe uses `(content_fingerprint, company_id)` to detect duplicates. Same fingerprint + same company = potential duplicate.

**Test Implications**:

- Different companies can have same fingerprint (different jobs, same content)
- Same fingerprint within same company triggers dedupe logic

---

### INV-8: Repost Count Monotonicity

**Invariant**: `repost_count` only increases (via `incrementOfferRepostCount`). Never decreases.

**Test Implications**:

- Re-running dedupe on same data should not change repost_count (idempotency)
- Repost count should increment only when duplicate detected

---

### INV-9: Run Tracking Idempotency

**Invariant**: Multiple runs for same `(provider, query_fingerprint)` are allowed. No deduplication at run level.

**Test Implications**:

- Each ingestion creates a new run row
- Run metrics should reflect only that specific run's activity

---

### INV-10: Foreign Key Integrity

**Invariant**: All foreign keys must be valid:

- `offers.company_id → companies.id`
- `matches.offer_id → offers.id`
- `offers.canonical_offer_id → offers.id`
- `company_sources.company_id → companies.id`

**Test Implications**:

- Cannot create offer without company
- Cannot create match without offer
- Cannot set canonical_offer_id to non-existent offer

---

## 4. Idempotency Behaviors

### 4.1 Company Upsert

**Behavior**: `upsertCompany()` with same identity key (domain or name) returns same `company_id` and enriches fields.

**Idempotency Test**:

```typescript
const id1 = upsertCompany({ website_domain: "acme.com", name_raw: "Acme" });
const id2 = upsertCompany({
  website_domain: "acme.com",
  name_raw: "Acme Corp",
});
// id1 === id2
// name_raw updated from "Acme" to "Acme Corp"
```

---

### 4.2 Offer Upsert

**Behavior**: `upsertOffer()` with same `(provider, provider_offer_id)` updates content but preserves offer_id and canonicalization fields.

**Idempotency Test**:

```typescript
const id1 = upsertOffer({
  provider: "infojobs",
  provider_offer_id: "123",
  title: "Engineer",
  company_id: 1,
});
const id2 = upsertOffer({
  provider: "infojobs",
  provider_offer_id: "123",
  title: "Senior Engineer",
  company_id: 1,
});
// id1 === id2
// title updated from "Engineer" to "Senior Engineer"
// canonical_offer_id unchanged
```

---

### 4.3 Match Upsert

**Behavior**: `upsertMatch()` with same `offer_id` overwrites previous score.

**Idempotency Test**:

```typescript
upsertMatch({ offer_id: 1, score: 5.0, matched_keywords_json: "{...}" });
upsertMatch({ offer_id: 1, score: 6.0, matched_keywords_json: "{...}" });
// Only 1 match row exists for offer_id=1
// score = 6.0 (latest)
```

---

### 4.4 Company Aggregation

**Behavior**: `updateCompanyAggregation()` partial updates preserve unspecified fields.

**Idempotency Test**:

```typescript
updateCompanyAggregation(1, { max_score: 8.0, offer_count: 10 });
updateCompanyAggregation(1, { strong_offer_count: 5 });
// max_score = 8.0 (preserved)
// offer_count = 10 (preserved)
// strong_offer_count = 5 (new)
```

---

### 4.5 Offer Canonicalization

**Behavior**: `markOfferAsDuplicate()` is idempotent if called with same arguments.

**Idempotency Test**:

```typescript
markOfferAsDuplicate(offerId: 2, canonicalOfferId: 1);
markOfferAsDuplicate(offerId: 2, canonicalOfferId: 1); // No error, no change
```

**Non-idempotent**: `incrementOfferRepostCount()` increments each time called.

```typescript
incrementOfferRepostCount(1, "2024-01-01");
incrementOfferRepostCount(1, "2024-01-01");
// repost_count = 2 (incremented twice)
```

---

## 5. Integration Test Scenarios

### T1: Company Identity Resolution (INV-1)

**Setup**:

- Ingest offer A with domain "acme.com"
- Ingest offer B with domain "acme.com"
- Ingest offer C with normalized_name "acme" (no domain)

**Assert**:

- Offers A and B → same company_id
- Offer C → different company_id (domain takes precedence)

---

### T2: Offer Re-ingestion (INV-2)

**Setup**:

- Ingest offer X (provider="infojobs", provider_offer_id="123", title="Engineer")
- Mark offer X as scored (create match)
- Re-ingest offer X with updated title="Senior Engineer"

**Assert**:

- Same offer_id
- Title updated to "Senior Engineer"
- Match row preserved (offer_id unchanged)

---

### T3: Match Rescoring (INV-3)

**Setup**:

- Score offer Y with M3 pipeline → score=5.0
- Rescore offer Y with same input → score=5.0

**Assert**:

- Only 1 match row exists for offer Y
- Score identical (deterministic)

---

### T4: Canonical Offer Semantics (INV-4)

**Setup**:

- Create offer A (canonical)
- Create offer B, mark as duplicate of A
- Query canonical offers

**Assert**:

- Offer A has `canonical_offer_id IS NULL`
- Offer B has `canonical_offer_id = A.id`
- Query returns only offer A

---

### T5: Company Aggregation Partial Updates (INV-5)

**Setup**:

- Aggregate company 1 → set max_score=8.0, offer_count=10
- Aggregate company 1 again → set strong_offer_count=5

**Assert**:

- max_score=8.0 (preserved)
- offer_count=10 (preserved)
- strong_offer_count=5 (new)

---

### T6: Deterministic Aggregation Ordering (INV-6)

**Setup**:

- Create 3 offers for company 1 with IDs: 10, 20, 30
- Query via `listCompanyOffersForAggregation(1)`

**Assert**:

- Offers returned in order: [10, 20, 30]
- Repeated queries yield identical order

---

### T7: Content Fingerprint Deduplication (INV-7)

**Setup**:

- Create offer A (company 1, fingerprint "abc123")
- Create offer B (company 1, fingerprint "abc123")
- Create offer C (company 2, fingerprint "abc123")

**Assert**:

- Offers A and B are duplicates (same company + fingerprint)
- Offer C is NOT a duplicate (different company)

---

### T8: Repost Count Monotonicity (INV-8)

**Setup**:

- Create canonical offer A with repost_count=0
- Increment repost count twice

**Assert**:

- repost_count=2
- Re-running increment increases count (not idempotent)

---

### T9: Run Tracking (INV-9)

**Setup**:

- Create run 1 for provider="infojobs", query_fingerprint="search123"
- Create run 2 for provider="infojobs", query_fingerprint="search123"

**Assert**:

- Both runs exist with different IDs
- No deduplication at run level

---

### T10: Foreign Key Integrity (INV-10)

**Setup**:

- Attempt to create offer with non-existent company_id
- Attempt to create match with non-existent offer_id

**Assert**:

- Both operations throw foreign key constraint error

---

## 6. Key Repo Patterns

### Pattern 1: SELECT-then-UPDATE vs True Upsert

- **Companies**: SELECT-then-UPDATE (application logic for identity resolution)
- **Offers**: True upsert (`ON CONFLICT DO UPDATE`)
- **Matches**: True upsert (`ON CONFLICT DO UPDATE`)

### Pattern 2: Partial Updates with COALESCE

- **Companies**: Enrichment pattern - `COALESCE(?, existing)` prevents nullification
- **Offers**: Full content overwrite on upsert (except canonicalization)
- **Matches**: Full overwrite (scoring is recomputable)

### Pattern 3: JSON Field Handling

- **Companies**: `category_max_scores` serialized with try-catch, logs warning on failure
- **Offers**: `matched_keywords_json` parsed with try-catch, logs warning on failure
- **Defensive**: Both use null fallback to prevent DB corruption

### Pattern 4: Deterministic Ordering

- **Offers**: Always `ORDER BY id ASC` in aggregation queries
- **Ensures**: Stable aggregation results across runs

---

## 7. Recommendations for Integration Tests

### Priority 1: Idempotency Tests

1. **Company Upsert Idempotency** (T1)
2. **Offer Re-ingestion Idempotency** (T2)
3. **Match Rescoring Determinism** (T3)

### Priority 2: Invariant Validation Tests

4. **Canonical Offer Semantics** (T4)
5. **Aggregation Partial Updates** (T5)
6. **Content Fingerprint Deduplication** (T7)

### Priority 3: Edge Case Tests

7. **Deterministic Ordering** (T6)
8. **Repost Count Behavior** (T8)
9. **Foreign Key Integrity** (T10)

### Priority 4: End-to-End Tests

10. **Run Tracking + Aggregation** (T9)

---

## 8. Summary

**Key Findings**:

- **Strong Identity Constraints**: Companies via domain/name, offers via (provider, provider_offer_id)
- **Idempotency**: Company and offer upserts are safe to re-run; match rescoring is deterministic
- **Partial Updates**: Aggregation uses opt-in field updates (never nullifies unspecified fields)
- **Canonicalization Model**: Clear distinction between canonical offers (canonical_offer_id=NULL) and duplicates
- **Deterministic Behavior**: Aggregation queries use ORDER BY id to ensure stable results

**Testing Implications**:

- Integration tests must validate idempotency at each layer (company, offer, match)
- Canonicalization logic requires careful testing to prevent invalid states (duplicate→duplicate chains)
- Aggregation tests must verify partial update semantics (field preservation)
- Dedupe tests must validate fingerprint-based detection within company boundaries

**Next Steps**:

- Implement 10 integration tests (T1-T10) in `tests/integration/db/`
- Add stress tests for concurrent upserts (SQLite WAL mode)
- Validate foreign key constraints under edge cases
