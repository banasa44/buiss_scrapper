# Unit Test Plan (M1)

This document identifies high-ROI unit test targets for M1, focusing on **deterministic, pure logic** that can be tested in isolation without database or network dependencies.

---

## Recommended Unit Test Targets (Prioritized)

### Priority 1: Identity & Normalization Utilities

These are **core deterministic helpers** that underpin company identity resolution. Bugs here cascade throughout the entire ingestion pipeline.

#### 1.1 `src/utils/companyIdentity.ts` → `normalizeCompanyName()`

**Why test:**

- Foundation of company deduplication logic
- Deterministic, pure function
- High impact: incorrect normalization = duplicate companies

**Key behaviors:**

- Trim whitespace (leading/trailing)
- Convert to lowercase
- Strip accents/diacritics (e.g., "Café" → "cafe")
- Collapse repeated whitespace to single spaces
- Remove legal suffixes (sl, s.l., slu, sa, s.a.)
- Empty input handling

**Edge cases (10):**

1. Empty string → `""`
2. Whitespace-only input → `""`
3. Leading/trailing spaces → trimmed
4. Mixed case → `"TeSt CoMpAnY"` → `"test company"`
5. Accents/diacritics → `"Société Générale"` → `"societe generale"`
6. Multiple spaces → `"Test    Company"` → `"test company"`
7. Legal suffix: `"Acme Corp S.L."` → `"acme corp"`
8. Legal suffix: `"Test S.A."` → `"test"`
9. Legal suffix with comma: `"Test, S.L.U."` → `"test"`
10. No legal suffix → `"Test Sales"` → `"test sales"` (don't strip "s" from "sales")

---

#### 1.2 `src/utils/companyIdentity.ts` → `extractWebsiteDomain()`

**Why test:**

- Critical for company identity resolution via domain matching
- Deterministic, pure function
- Must handle malformed URLs gracefully (no throws)

**Key behaviors:**

- Extract hostname from valid URL
- Convert to lowercase
- Strip leading "www."
- Return null for invalid/malformed URLs
- Validate domain has at least one dot
- Handle various URL schemes (http, https)

**Edge cases (10):**

1. Valid HTTP → `"http://example.com"` → `"example.com"`
2. Valid HTTPS → `"https://example.com"` → `"example.com"`
3. With www → `"https://www.example.com"` → `"example.com"`
4. With path → `"https://example.com/about"` → `"example.com"`
5. With port → `"https://example.com:8080"` → `"example.com"`
6. Uppercase → `"HTTPS://EXAMPLE.COM"` → `"example.com"`
7. Malformed URL → `"not a url"` → `null`
8. Empty string → `""` → `null`
9. Missing protocol → `"example.com"` → `null` (URL() requires protocol)
10. Invalid domain (no dot) → `"http://localhost"` → `null`

---

#### 1.3 `src/utils/companyIdentity.ts` → `pickCompanyWebsiteUrl()`

**Why test:**

- Deterministic priority selection logic
- Simple but critical for mapper correctness

**Key behaviors:**

- Priority order: corporateWebsiteUrl → websiteUrl → web
- Return first non-empty, trimmed candidate
- Return null if all are empty/undefined

**Edge cases (8):**

1. All fields present → returns corporateWebsiteUrl
2. Only websiteUrl present → returns websiteUrl
3. Only web present → returns web
4. corporateWebsiteUrl empty, websiteUrl present → returns websiteUrl
5. All empty strings → `null`
6. All undefined → `null`
7. Whitespace-only strings → `null` (trim collapses to empty)
8. Mixed (corporateWebsiteUrl = whitespace, websiteUrl = valid) → returns websiteUrl

---

### Priority 2: Mapper Functions (InfoJobs)

These transform provider payloads to canonical types. Testing WITHOUT DB ensures mapper correctness in isolation.

#### 2.1 `src/clients/infojobs/mappers.ts` → `mapInfoJobsOfferListItemToSummary()`

**Why test:**

- Validates InfoJobs API → canonical mapping
- Can be tested without DB (uses mock InfoJobs payloads)
- High value: catches mapping regressions

**Key behaviors:**

- Return null if `raw.id` is missing (required field)
- Map all standard fields correctly (title, company, location, metadata)
- Call `normalizeCompanyName()` for company.normalizedName
- Handle missing/undefined fields gracefully (use `||` or `??`)
- Construct JobOfferSummary with correct structure

**Edge cases (10):**

1. Minimal valid offer (only `id` present) → valid JobOfferSummary
2. Missing `id` → `null`
3. Missing company author → company fields undefined
4. Missing title → `""`
5. Missing metadata fields → metadata = undefined
6. Missing location → location = undefined
7. All fields present → all mapped correctly
8. Company name with accents → normalizedName strips them
9. Empty strings vs undefined → handle both
10. Nested null values (e.g., `author: null`) → no crash, graceful handling

---

#### 2.2 `src/clients/infojobs/mappers.ts` → `mapInfoJobsOfferDetailToDetail()`

**Why test:**

- Similar to 2.1 but for detail endpoint
- Includes website domain extraction + InfoJobs domain filtering

**Key behaviors:**

- Return null if `raw.id` is missing
- Map detail-specific fields (description, minRequirements, etc.)
- Extract website domain using `pickCompanyWebsiteUrl()` + `extractWebsiteDomain()`
- Filter out InfoJobs internal domains (`infojobs.*`)
- Handle missing `profile` gracefully

**Edge cases (10):**

1. Minimal valid offer (only `id`) → valid JobOfferDetail
2. Missing `id` → `null`
3. Profile with valid corporateWebsiteUrl → websiteDomain extracted
4. Profile with InfoJobs domain → websiteDomain = null (filtered)
5. Profile with malformed URL → websiteDomain = null
6. No profile → websiteUrl/websiteDomain = undefined
7. Profile with all three URL fields → corporateWebsiteUrl wins (priority)
8. Detail-specific fields present (description, minRequirements) → mapped
9. Metadata uses `journey` instead of `workDay` → mapped correctly
10. Company name normalization → normalizedName derived

---

### Priority 3: Input Builder Helpers (Persistence Layer)

These are **private helper functions** that are deterministic and testable without DB, BUT they are not exported. Testing them would require either:

- Exporting them (violates encapsulation)
- Testing via public API (integration test territory)

**Decision for M1:** Skip unit testing these; cover via integration tests instead.

#### Non-targets (rationale):

- `buildCompanyInput()` (companyPersistence.ts)
  - **Why skip:** Uses `normalizeCompanyName()` and `extractWebsiteDomain()` (already unit tested). The logic is derivation + validation, which is better tested via integration (real DB input/output).

- `buildOfferInput()` (offerPersistence.ts)
  - **Why skip:** Straightforward mapping logic, no complex edge cases. Integration tests will validate correctness.

- `serializeMetadata()` (offerPersistence.ts)
  - **Why skip:** Trivial JSON.stringify wrapper with try/catch. Low ROI for unit test.

- `buildCompanySourceInput()` (companyPersistence.ts)
  - **Why skip:** Simple field mapping, no branching logic.

---

## Explicit Non-Targets for M1 Unit Tests

These should NOT be unit tested in M1:

### Database Repositories

- `companiesRepo.ts`, `offersRepo.ts`, `runsRepo.ts`
- **Why:** Database behavior must be tested with real DB (integration tests)

### Persistence Orchestration

- `persistCompanyAndSource()` (companyPersistence.ts)
- `persistOffer()` (offerPersistence.ts)
- **Why:** These call DB repos and log. Testing requires DB + logger mocks (integration layer)

### Run Lifecycle Functions

- `startRun()`, `finishRun()`, `withRunLifecycle()` (runLifecycle.ts)
- **Why:** These call DB repos and manage run state. Requires real DB (integration tests)

### Ingestion Orchestration

- `ingestOffers()` (ingestOffers.ts)
- **Why:** Calls `persistOffer()` which touches DB. Integration test scope.

### HTTP Clients

- `infojobsClient.ts`, `httpClient.ts`
- **Why:** Network/API calls. Use E2E offline tests with mocked HTTP fixtures.

### Pipeline Orchestration

- `src/ingestion/pipelines/infojobs.ts`
- **Why:** Wires multiple layers together. E2E offline test scope.

---

## Suggested Fixture Needs

For mapper tests (`mapInfoJobsOfferListItemToSummary`, `mapInfoJobsOfferDetailToDetail`), create minimal InfoJobs payload fixtures:

### Recommended fixtures:

1. **`tests/fixtures/infojobs/minimal_list_item.json`**
   - Minimal valid InfoJobs list item (only `id` present)
   - Use for testing required field validation

2. **`tests/fixtures/infojobs/full_list_item.json`**
   - Complete InfoJobs list item with all fields populated
   - Use for comprehensive mapping verification

3. **`tests/fixtures/infojobs/minimal_detail.json`**
   - Minimal valid InfoJobs detail payload (only `id` present)

4. **`tests/fixtures/infojobs/full_detail.json`**
   - Complete InfoJobs detail payload with all fields (including profile with website URLs)

5. **`tests/fixtures/infojobs/detail_with_infojobs_domain.json`**
   - Detail payload with `profile.corporateWebsiteUrl` containing "infojobs.net"
   - Use for testing InfoJobs domain filtering

6. **Edge case inline fixtures (no files needed):**
   - Missing `id`, missing author, empty strings, malformed URLs
   - These can be constructed inline in test code

---

## Summary

**Unit test implementation order:**

1. `normalizeCompanyName()` — foundational
2. `extractWebsiteDomain()` — foundational
3. `pickCompanyWebsiteUrl()` — simple, high confidence
4. `mapInfoJobsOfferListItemToSummary()` — mapper correctness
5. `mapInfoJobsOfferDetailToDetail()` — mapper correctness

**Estimated test count:** ~40-50 test cases across 5 functions

**ROI:** High. These tests cover deterministic logic with minimal setup, catch regressions early, and run extremely fast (no I/O).

---

## Next Steps (Not This Task)

After unit tests are written:

1. Integration tests for persistence layer (with real DB)
2. E2E offline tests for full pipeline (mocked HTTP + real DB)
3. Validation that all three layers provide complementary coverage
