# AUDIT 1 — Test Inventory & Current Coverage Map

**Date:** February 2, 2026  
**Scope:** Existing test suite audit to build accurate coverage map and identify gaps before adding new tests

---

## 1. Existing Tests by Category

### **Unit Tests** (`tests/unit/`)

#### 1.1 [companyIdentity.test.ts](../../../tests/unit/companyIdentity.test.ts) (334 lines)

**Verifies:** Pure normalization and identity utilities

**Modules Tested:**

- `normalizeCompanyName()` — company name normalization with accent stripping, legal suffix removal
- `extractWebsiteDomain()` — URL parsing and domain extraction with validation
- `pickCompanyWebsiteUrl()` — priority-based website URL selection

**Coverage Highlights:**

- Extensive edge cases: accents, legal suffixes (S.L., S.A., SLU), whitespace handling
- URL parsing: protocols, www stripping, paths, ports, malformed inputs
- Priority selection: corporateWebsiteUrl → websiteUrl → web fallback logic

**Assessment:** ✅ Comprehensive coverage for identity utilities

---

#### 1.2 [infojobs.mappers.test.ts](../../../tests/unit/infojobs.mappers.test.ts) (440 lines)

**Verifies:** InfoJobs payload → canonical type transformations

**Modules Tested:**

- `mapInfoJobsOfferListItemToSummary()` — search result list item mapping
- `mapInfoJobsOfferDetailToDetail()` — detail endpoint response mapping

**Coverage Highlights:**

- Field mapping from official InfoJobs API sample response
- Metadata extraction (category, contract, salary, experience, location)
- Company normalization integration
- Website URL priority selection and domain filtering (excludes infojobs.\* domains)
- Graceful degradation with missing/null fields

**Assessment:** ✅ Strong coverage for InfoJobs-specific transformations

---

### **Integration Tests** (`tests/integration/db/`)

#### 2.1 [harness.test.ts](../../../tests/integration/db/harness.test.ts) (68 lines)

**Verifies:** Test database harness infrastructure

**Modules Tested:**

- Test DB helper (`createTestDb()`)
- Migration execution in test environment
- Repository functionality with test DB
- Cleanup and temp file removal

**Coverage Highlights:**

- Fresh DB creation with migrations applied
- Repos work correctly with test DB connection
- Cleanup removes temp files after tests

**Assessment:** ✅ Adequate smoke test for test infrastructure

---

#### 2.2 [offer_ingestion_idempotency.test.ts](../../../tests/integration/db/offer_ingestion_idempotency.test.ts) (330 lines)

**Verifies:** Offer ingestion persistence contracts

**Modules Tested:**

- `runOfferBatchIngestion()` — batch ingestion orchestration
- `getOfferByProviderId()` — offer retrieval
- Company-offer linkage (foreign keys)

**Coverage Highlights:**

- **Idempotency:** Same batch ingested twice → no duplicates created
- **Overwrite semantics:** Re-ingestion with updated fields → values overwritten
- **Nullable field handling:** Re-ingestion with undefined → becomes null in DB
- **Bad record handling:** Offers with insufficient company identity → skipped, not failed
- **Mixed batches:** Valid and invalid records processed together without crashing

**Assessment:** ✅ Comprehensive coverage for M1 ingestion contracts

---

### **E2E Tests** (`tests/e2e/`)

#### 3.1 [infojobs_offline.test.ts](../../../tests/e2e/infojobs_offline.test.ts) (111 lines)

**Verifies:** InfoJobs client with mocked HTTP layer

**Modules Tested:**

- `InfoJobsClient` instantiation with mock HTTP
- Search and detail endpoint calls
- Canonical data shape validation

**Coverage Highlights:**

- Mock HTTP returns fixture data correctly
- Client produces canonical `JobOfferSummary` and `JobOfferDetail` types
- Unmocked requests throw errors (prevents accidental live calls)
- Company normalization works through client layer

**Assessment:** ✅ Good coverage for client isolation testing

---

#### 3.2 [infojobs_pipeline_offline_db.test.ts](../../../tests/e2e/infojobs_pipeline_offline_db.test.ts) (307 lines)

**Verifies:** Full InfoJobs pipeline with mock HTTP and real DB

**Modules Tested:**

- `runInfojobsPipeline()` — complete pipeline orchestration
- Client → Mapper → Ingestion → DB persistence flow
- Run lifecycle (`createRun`, `finishRun`)
- Company linkage and persistence

**Coverage Highlights:**

- End-to-end flow: Mock HTTP → InfoJobsClient → Pipeline → SQLite DB
- Offer persistence verified via DB queries
- Company linkage verified (foreign key integrity)
- Run lifecycle tracked (runId, finished_at timestamp)
- Mixed valid/invalid batches handled gracefully
- Counters match ingestion results

**Assessment:** ✅ Excellent high-confidence E2E test for M1 pipeline

---

## 2. Critical Gaps for M3 + M4

### **Currently NOT Tested (Critical Components)**

#### ❌ **Matcher + Negation** (`src/signal/matcher/`)

**Missing Tests:**

- `matcher.ts` → keyword matching (single-token, multi-token, consecutive token sequences)
- `negation.ts` → negation detection with context windows

**Why Critical:**

- Core M3 deliverable — foundation for signal detection
- Incorrect matching = false positives/negatives = bad scoring
- Negation bugs = "no AWS experience" matches AWS incorrectly

**Impact:** HIGH — bugs cascade into scoring and aggregation

---

#### ❌ **Scorer** (`src/signal/scorer/`)

**Missing Tests:**

- `scorer.ts` → offer-level scoring (tier/field weights, category aggregation, phrase boosts, negation exclusion)

**Why Critical:**

- Converts matches to numeric scores [0-10]
- Must verify: category max-1-hit rule, tier/field weight multiplication, phrase boosts, negation exclusion
- Incorrect scoring = wrong company rankings

**Impact:** HIGH — directly affects output quality

---

#### ❌ **Aggregation (Pure Logic)** (`src/signal/aggregation/`)

**Missing Tests:**

- `aggregateCompany.ts` → pure in-memory company signal aggregation
  - Metrics: `maxScore`, `offerCount`, `uniqueOfferCount`, `strongOfferCount`, `avgStrongScore`
  - Evidence: `topCategoryId`, `topOfferRef`

**Why Critical:**

- M4 core deliverable
- Pure function — perfect candidate for unit testing
- Incorrect aggregation = wrong final rankings

**Impact:** HIGH — M4 business logic

---

#### ❌ **Aggregation Persistence** (`src/signal/aggregation/`)

**Missing Tests:**

- `aggregateCompanyAndPersist.ts` → orchestrates DB read → aggregate → DB write
- Must verify idempotency and transactional correctness

**Why Critical:**

- M4 orchestration layer
- Must handle retry scenarios correctly
- Data corruption risk if not idempotent

**Impact:** HIGH — data integrity

---

#### ❌ **Text Normalization** (`src/utils/textNormalization.ts`)

**Missing Tests:**

- `normalizeToTokens()` → tokenization for matcher (word boundaries, punctuation splitting)

**Why Critical:**

- Foundation for matcher logic
- Incorrect tokenization = missed keywords or false matches
- Token boundary handling directly affects matching accuracy

**Impact:** HIGH — matcher dependency

---

#### ❌ **Match Persistence** (`src/db/repos/matchesRepo.ts`)

**Missing Tests:**

- Storing keyword/phrase hits to `offer_matches` table
- Idempotency of match writes

**Why Critical:**

- Audit trail for scoring decisions
- Must not create duplicate match records
- Integration with scoring pipeline

**Impact:** MEDIUM — audit/debug capability

---

#### ❌ **Catalog Loading & Validation** (`src/catalog/`)

**Missing Tests:**

- `loader.ts` → loads and compiles catalog from JSON
- `catalogValidation.ts` → validates catalog structure before runtime

**Why Critical:**

- Invalid catalog = runtime errors in matcher
- Prevents app from starting with bad configuration

**Impact:** MEDIUM — robustness

---

#### ❌ **Company Persistence (Aggregation Signals)** (`src/db/repos/companiesRepo.ts`)

**Missing Tests:**

- `updateCompanyAggregation()` → writes M4 signals to companies table
- Idempotency of aggregation updates

**Why Critical:**

- M4 persistence layer
- Must handle concurrent updates correctly
- Incorrect updates = wrong company metadata

**Impact:** MEDIUM — M4 data integrity

---

#### ❌ **Full M3+M4 E2E Pipeline**

**Missing Tests:**

- End-to-end flow: Ingestion → Match → Score → Persist Matches → Aggregate → Persist Aggregation
- Integration test for complete M3+M4 data flow

**Why Critical:**

- Highest confidence test for M3+M4 integration
- Catches wiring errors between layers
- Verifies complete data lineage

**Impact:** HIGH — integration confidence

---

#### ❌ **Batch Company Aggregation** (`src/ingestion/aggregateCompanies.ts`)

**Missing Tests:**

- `aggregateCompaniesForRun()` → batch aggregation with chunking and retries
- Error handling for transient failures

**Why Critical:**

- M4 batch orchestration
- Must handle partial failures gracefully
- Retry logic must be verified

**Impact:** MEDIUM — robustness

---

## 3. Testing Patterns & Helpers (Already Available)

### **Test DB Setup**

**Helper:** [tests/helpers/testDb.ts](../../../tests/helpers/testDb.ts) (201 lines)

**Pattern:**

- Creates temporary SQLite database per test
- Runs real migrations from `migrations/` directory
- Sets DB singleton via `setDbForTesting()` for repo usage
- Cleanup deletes temp file after test

**Functions:**

- `createTestDb()` — async version
- `createTestDbSync()` — synchronous version

**Usage Example:**

```typescript
let harness: TestDbHarness;

beforeEach(async () => {
  harness = await createTestDb();
});

afterEach(() => {
  harness.cleanup();
});
```

**Assessment:** ✅ Robust pattern, well-implemented

---

### **HTTP Mocking / Offline Fixtures**

**Helper:** [tests/helpers/mockHttp.ts](../../../tests/helpers/mockHttp.ts) (125 lines)

**Pattern:**

- Mock HTTP layer with route registration
- Returns fixture JSON for registered routes
- Throws loudly on unmocked requests (prevents accidental live calls)
- Supports custom handlers for dynamic responses

**Functions:**

- `createMockHttp()` — creates mock instance
- `mock.on(method, url, response)` — register static response
- `mock.onCustom(method, url, handler)` — register custom handler
- `mock.reset()` — clear all mocks
- `mock.getRecordedRequests()` — debugging/assertions

**Fixtures:**

- `tests/fixtures/infojobs/sample_search_response.json` — official InfoJobs API sample

**Usage Example:**

```typescript
const mockHttp = createMockHttp();

mockHttp.on("GET", "https://api.infojobs.net/api/9/offer", fixtureData);

const client = new InfoJobsClient({
  httpRequest: mockHttp.request,
  credentials: { clientId: "test", clientSecret: "test" },
});
```

**Assessment:** ✅ Excellent design, prevents flaky network-dependent tests

---

### **Assertion Helpers**

**Current State:** None identified — tests use Vitest's built-in `expect()` directly

**Opportunity:** Could add domain-specific assertions for improved readability

**Potential Helpers:**

- `expectValidOfferRow(row)` — validates DB offer row structure
- `expectCompanyLinked(offerId, companyId)` — verifies foreign key relationship
- `expectMatchExists(offerId, keywordId)` — verifies match record
- `expectScoreInRange(score, min, max)` — validates score bounds

**Assessment:** Low priority — current approach is adequate

---

## 4. Coverage Matrix

| **Component**                  | **Unit**                    | **Integration (DB)**                   | **E2E**                                 |
| ------------------------------ | --------------------------- | -------------------------------------- | --------------------------------------- |
| **Identity Utils**             | ✅ companyIdentity.test.ts  | —                                      | —                                       |
| **Text Normalization**         | ❌ **MISSING**              | —                                      | —                                       |
| **InfoJobs Mappers**           | ✅ infojobs.mappers.test.ts | —                                      | ✅ infojobs_offline.test.ts             |
| **Catalog Loading**            | ❌ **MISSING**              | —                                      | —                                       |
| **Catalog Validation**         | ❌ **MISSING**              | —                                      | —                                       |
| **Matcher (keyword)**          | ❌ **MISSING**              | —                                      | —                                       |
| **Negation Detection**         | ❌ **MISSING**              | —                                      | —                                       |
| **Scorer (offer-level)**       | ❌ **MISSING**              | —                                      | —                                       |
| **Aggregation (pure)**         | ❌ **MISSING**              | —                                      | —                                       |
| **Aggregation Orchestration**  | —                           | ❌ **MISSING**                         | —                                       |
| **Match Persistence**          | —                           | ❌ **MISSING**                         | —                                       |
| **Offer Persistence**          | —                           | ✅ offer_ingestion_idempotency.test.ts | —                                       |
| **Company Persistence**        | —                           | (partial via offer tests)              | —                                       |
| **Company Aggregation Update** | —                           | ❌ **MISSING**                         | —                                       |
| **Run Lifecycle**              | —                           | ✅ harness.test.ts                     | ✅ infojobs_pipeline_offline_db.test.ts |
| **InfoJobs Pipeline**          | —                           | —                                      | ✅ infojobs_pipeline_offline_db.test.ts |
| **Full M3+M4 Pipeline**        | —                           | —                                      | ❌ **MISSING**                          |
| **Batch Aggregation**          | —                           | ❌ **MISSING**                         | —                                       |

**Legend:**

- ✅ = Test exists with good coverage
- (partial) = Covered indirectly, not explicitly tested
- ❌ **MISSING** = No test coverage, critical gap

---

## 5. Prioritized Gap List (Top 10)

### **Priority 1 — Critical for M3 Signal Quality**

#### 1. **Matcher Unit Tests** (`src/signal/matcher/matcher.ts`)

**Rationale:**

- Core M3 deliverable — foundation for all signal detection
- Must verify: single-token matching, multi-token matching, consecutive token sequences
- Must verify: phrase boost matching (independent from keywords)
- Token boundary enforcement (via tokenization)

**Risk if Untested:**

- False positives: "awesome" matches "aws"
- False negatives: "AWS" doesn't match "aws" due to normalization bugs
- Multi-token sequences fail: "Google Ads" as two separate tokens

**Recommended Test Cases:**

- Single-token exact matches (case-insensitive)
- Multi-token consecutive sequence matching
- Token boundary enforcement (no substring matches)
- Phrase boost matching (independent from keyword hits)
- Empty/null input handling
- Match position tracking for negation

---

#### 2. **Negation Detection Unit Tests** (`src/signal/matcher/negation.ts`)

**Rationale:**

- Prevents "no AWS" or "sin experiencia con AWS" from matching positively
- Window-based context checking (8 tokens before, 2 after)
- Directly impacts scoring accuracy

**Risk if Untested:**

- Negated mentions inflate scores incorrectly
- Window boundaries incorrectly calculated
- Edge cases (match at start/end of text) fail

**Recommended Test Cases:**

- Negation cue before match within window
- Negation cue after match within window
- Negation cue outside window (should NOT negate)
- Multiple negation cues
- Match at start of text (no tokens before)
- Match at end of text (no tokens after)
- Spanish negation cues ("no", "sin")
- English negation cues ("not", "without")

---

#### 3. **Scorer Unit Tests** (`src/signal/scorer/scorer.ts`)

**Rationale:**

- Converts matches to scores [0-10] using tier/field weights
- Must verify: category max-1-hit rule, tier/field weight multiplication
- Must verify: phrase boosts are independent and non-stacking
- Must verify: negated hits excluded before scoring

**Risk if Untested:**

- Multiple keywords from same category stack (violates design)
- Negated hits contribute points
- Phrase boosts stack incorrectly
- Score exceeds max (10) due to missing clamp

**Recommended Test Cases:**

- Single category hit: tier weight × field weight
- Multiple keywords, same category → max 1 hit (highest field weight wins)
- Multiple keywords, different categories → all contribute
- Phrase boosts add points independently
- Multiple phrase matches → unique phrase count only
- Negated hits contribute 0 points
- Empty match result → score = 0
- Score clamped to [0, 10]

---

#### 4. **Text Normalization Unit Tests** (`src/utils/textNormalization.ts`)

**Rationale:**

- Foundation for matcher — tokenization determines word boundaries
- Must split on: whitespace, punctuation, technical separators (`/`, `\`, `-`, `_`, `.`, `:`, `@`)
- Lowercase normalization, accent stripping

**Risk if Untested:**

- Incorrect token boundaries = missed keywords
- Punctuation handling errors = false matches
- Technical separators not split correctly (e.g., "AWS/GCP" becomes one token)

**Recommended Test Cases:**

- Whitespace splitting
- Punctuation splitting (`.`, `,`, `;`, `!`, `?`)
- Technical separator splitting (`/`, `\`, `-`, `_`, `.`, `:`, `@`)
- Lowercase conversion
- Accent stripping (Spanish: á, é, í, ó, ú, ñ)
- Empty string handling
- Mixed separators in single string

---

### **Priority 2 — Critical for M4 Aggregation Correctness**

#### 5. **Aggregation Pure Logic Unit Tests** (`src/signal/aggregation/aggregateCompany.ts`)

**Rationale:**

- M4 core deliverable — pure function, perfect for unit testing
- Must verify: `maxScore`, `offerCount`, `uniqueOfferCount`, `strongOfferCount`, `avgStrongScore`
- Must verify: activity weighting (reposts contribute to offerCount)
- Must verify: canonical-only metrics (strong count uses canonical offers only)

**Risk if Untested:**

- Incorrect aggregation formulas = wrong company rankings
- Repost logic broken = inflated/deflated counts
- Strong offer threshold not applied correctly

**Recommended Test Cases:**

- Single canonical offer → metrics correct
- Multiple canonical offers → maxScore, avgStrongScore correct
- Canonical + duplicates → offerCount includes reposts, uniqueOfferCount = canonical only
- Mix of strong/weak offers → strongOfferCount and avgStrongScore correct
- All weak offers → avgStrongScore = null
- Edge case: no scored offers → all metrics = 0 or null
- Representative category selection (from max score offer)

---

#### 6. **Aggregation Persistence Integration Tests** (`src/signal/aggregation/aggregateCompanyAndPersist.ts`)

**Rationale:**

- M4 orchestration — reads offers from DB, aggregates, writes signals back
- Must be idempotent (safe to run multiple times)
- Must handle missing offers gracefully

**Risk if Untested:**

- Non-idempotent writes = data corruption on retry
- Transaction failures = partial updates
- Concurrent access issues

**Recommended Test Cases:**

- Fresh aggregation → signals written correctly
- Re-aggregation (idempotency) → signals updated, not duplicated
- Company with no offers → signals = 0/null
- Company with only canonical offers
- Company with canonical + duplicates
- Verify DB transaction rollback on error

---

### **Priority 3 — Supporting Infrastructure & Integration**

#### 7. **Match Persistence Integration Tests** (`src/db/repos/matchesRepo.ts`)

**Rationale:**

- Audit trail for scoring decisions
- Must handle batch inserts efficiently
- Must be idempotent (same match written twice = no duplicate)

**Risk if Untested:**

- Duplicate match records accumulate
- Foreign key violations on invalid offer_id
- Batch insert failures

**Recommended Test Cases:**

- Insert single match record
- Insert batch of matches (multiple keywords per offer)
- Idempotency: inserting same matches twice = no duplicates
- Retrieve matches by offer_id
- Negation flag stored correctly
- Category contribution data stored correctly

---

#### 8. **Catalog Validation Unit Tests** (`src/catalog/catalogValidation.ts`)

**Rationale:**

- Prevents runtime errors from invalid catalog structure
- Should validate before app starts
- Pure validation logic — easy to unit test

**Risk if Untested:**

- Invalid catalog loaded = matcher crashes at runtime
- Missing required fields = undefined errors
- Duplicate keyword IDs = ambiguous matches

**Recommended Test Cases:**

- Valid catalog passes validation
- Missing required fields detected
- Duplicate keyword IDs detected
- Invalid tier values detected
- Empty categories detected
- Malformed alias structures detected

---

#### 9. **E2E Test for Full M3+M4 Pipeline**

**Rationale:**

- Highest confidence test for complete data flow
- Verifies: Ingestion → Match → Score → Persist Matches → Aggregate → Persist Aggregation
- Catches wiring errors between layers

**Risk if Untested:**

- Integration bugs only caught in production
- Data lineage errors (matches not linked to offers correctly)
- Aggregation signals not computed after scoring

**Recommended Test Cases:**

- Full pipeline with mock HTTP + real DB
- Verify offers ingested, matches persisted, scores computed, aggregation signals updated
- Verify data lineage: offer → matches → score → company aggregation
- Mixed valid/invalid offers handled correctly
- Verify run counters include aggregation metrics

---

#### 10. **Company Aggregation Signal Update Integration Tests** (`src/db/repos/companiesRepo.ts`)

**Rationale:**

- Writes M4 signals to `companies` table
- Must be idempotent (safe to update multiple times)
- Must handle null values correctly

**Risk if Untested:**

- Non-idempotent updates = incorrect aggregation signals
- Concurrent updates = race conditions
- Foreign key violations

**Recommended Test Cases:**

- Update fresh company (signals = null → populated)
- Update existing company (signals overwritten)
- Idempotency: updating same signals twice = consistent result
- Verify all signal fields written correctly (`max_score`, `offer_count`, etc.)
- Verify top_category_id and top_offer_id linkage

---

## Summary & Rationale

### **Current State: Strong Foundation**

✅ **Well-Tested:**

- M1 ingestion pipeline (idempotency, overwrite semantics, bad record handling)
- Identity and normalization utilities (company name, domain extraction)
- InfoJobs mappers (payload transformation)
- E2E pipeline test for InfoJobs (mock HTTP + real DB)

✅ **Excellent Test Infrastructure:**

- Test DB harness (fresh SQLite per test, real migrations)
- HTTP mocking (offline fixtures, prevents live calls)
- Vitest setup with good patterns

---

### **Critical Gaps: M3 + M4 Intelligence Layer**

❌ **Zero Coverage for Core M3 Logic:**

- Matcher (keyword matching, multi-token, token boundaries)
- Negation detection (context windows, cue words)
- Scorer (tier/field weights, category aggregation, phrase boosts)
- Text normalization (tokenization foundation)

❌ **Zero Coverage for M4 Aggregation:**

- Pure aggregation logic (maxScore, offerCount, strongOfferCount)
- Aggregation persistence (orchestration, idempotency)
- Company signal updates (DB writes)

❌ **No E2E Test for M3+M4 Integration:**

- Complete flow: Ingestion → Match → Score → Aggregate
- Data lineage verification

---

### **Why This Matters**

**Business Impact:**

- M3+M4 are the project's differentiators (signal quality = business value)
- Scoring bugs = wrong company rankings = wrong leads
- Aggregation bugs = wrong final output = customer dissatisfaction

**Technical Risk:**

- M3 bugs cascade into M4 (compounding errors)
- No safety net for refactoring matcher/scorer
- Production debugging without test coverage = slow, risky

**Development Velocity:**

- Cannot confidently iterate on scoring parameters without tests
- Cannot add new keyword categories without regression tests
- Cannot optimize matcher performance without correctness baseline

---

### **Recommended Next Steps**

1. **Immediate (Before Any New Features):**
   - Add matcher + negation unit tests (Priority 1, items 1-2)
   - Add scorer unit tests (Priority 1, item 3)
   - Add text normalization unit tests (Priority 1, item 4)

2. **Short-Term (Before M4 Production):**
   - Add aggregation pure logic unit tests (Priority 2, item 5)
   - Add aggregation persistence integration tests (Priority 2, item 6)

3. **Medium-Term (After M3+M4 Stable):**
   - Add match persistence tests (Priority 3, item 7)
   - Add catalog validation tests (Priority 3, item 8)
   - Add full M3+M4 E2E test (Priority 3, item 9)
   - Add company aggregation update tests (Priority 3, item 10)

---

**Conclusion:**

The existing test suite provides a solid foundation for M1 ingestion, but **M3+M4 (the intelligence layer) has zero test coverage**. This is a critical gap that must be addressed before considering M3+M4 production-ready. The test infrastructure is excellent and ready to support adding these tests efficiently.
