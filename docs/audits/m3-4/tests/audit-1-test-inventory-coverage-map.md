# AUDIT 1 — Test inventory + coverage map (M3/M4 + pipeline)

Goal: build a complete inventory of all tests added/modified during the recent testing effort and map them to the intended coverage.

## Inventory
- Recent changes detected via git: `tests/e2e/bad_record_skipped.e2e.test.ts` is untracked (new). `git diff --name-status` is empty, so no other modified test files in the working tree.
- `tests/unit/textNormalization.test.ts` — Area: M3 matcher/scorer preprocessing; Type: unit; Validates: empty/whitespace -> [], lowercase + diacritics stripping, separator splitting (/, -, _, (), [], punctuation, quotes, pipe, backslash), preserves negation tokens and C++, handles long/mixed input.
- `tests/unit/aggregateCompany.test.ts` — Area: M4 aggregation (pure); Type: unit; Validates: default metrics for no offers/duplicates, canonical-only unique counts, offer_count weighting (1 + repost_count), strong/avg strong counts, top offer tie-breakers, category_max_scores, lastStrongAt.
- `tests/unit/matcher.keywords.test.ts` — Area: M3 matcher (keywords); Type: unit; Validates: boundary protection, multi-token keywords, field inclusion, duplicate hits preserved, negation integration, unique category/keyword counts.
- `tests/unit/matcher.phrases.test.ts` — Area: M3 matcher (phrases); Type: unit; Validates: consecutive token matching, case-insensitive matching, punctuation splitting, negation integration, repeated hits preserved, coexistence with keywords.
- `tests/unit/negation.test.ts` — Area: M3 negation detection; Type: unit; Validates: before/after windows, EN/ES cues, multi-token spans, list contexts, boundary constants.
- `tests/unit/scorer.test.ts` — Area: M3 scoring; Type: unit; Validates: tier*field weights, category aggregation rules, phrase boosts per unique phrase, negated hits excluded, MAX_SCORE clamp, topCategory selection.
- `tests/unit/companyIdentity.test.ts` — Area: ingestion identity utils; Type: unit; Validates: company name normalization (trim/lower/diacritics/suffix), website domain extraction rules, website URL priority + trimming, invalid URL handling.
- `tests/unit/infojobs.mappers.test.ts` — Area: ingestion mapping; Type: unit; Validates: InfoJobs list/detail mapping, required fields, normalized company, metadata/location mapping, website extraction priority + filtering, missing/empty/null handling.
- `tests/integration/db/harness.test.ts` — Area: DB harness; Type: integration; Validates: test DB creation, migrations applied, repo wiring, cleanup removes temp DB.
- `tests/integration/db/offer_ingestion_idempotency.test.ts` — Area: ingestion + DB persistence + resilience; Type: integration; Validates: idempotent upserts, overwrite semantics (including nulling), bad-record skip with counters, no duplicates.
- `tests/integration/db/aggregateCompanyAndPersist.test.ts` — Area: M4 aggregation persistence; Type: integration; Validates: aggregation metrics from offers/matches, persistence to companies, idempotency, canonical-only handling, offer_count weighting, lastStrongAt selection.
- `tests/e2e/ingestion_to_aggregation.e2e.test.ts` — Area: end-to-end pipeline (ingest->match->score->aggregate); Type: e2e; Validates: offers/matches persisted, strong threshold behavior, aggregation metrics, idempotency, multi-company handling, strong vs weak mix.
- `tests/e2e/repost_detection_to_aggregation.e2e.test.ts` — Area: repost/duplicate handling + aggregation; Type: e2e; Validates: same provider_offer_id upserts without duplicates, published_at updated, canonical_offer_id null, unique/offer counts correct for distinct offers.
- `tests/e2e/bad_record_skipped.e2e.test.ts` — Area: pipeline resilience; Type: e2e; Validates: invalid offers skipped without crash, counters accurate, valid offers persist, DB counts correct, continues after multiple bad records.
- `tests/e2e/infojobs_pipeline_offline_db.test.ts` — Area: InfoJobs pipeline (mock HTTP + real DB); Type: e2e; Validates: runInfojobsPipeline end-to-end persistence, run lifecycle finished_at, counters, skip invalid offer in batch.
- `tests/e2e/infojobs_offline.test.ts` — Area: InfoJobs client; Type: e2e; Validates: mocked HTTP search/detail mapping, canonical shapes, unmocked request returns error-truncated result.

## Coverage map
Legend (unit): U1=`tests/unit/textNormalization.test.ts`, U2=`tests/unit/aggregateCompany.test.ts`, U3=`tests/unit/matcher.keywords.test.ts`, U4=`tests/unit/matcher.phrases.test.ts`, U5=`tests/unit/negation.test.ts`, U6=`tests/unit/scorer.test.ts`, U7=`tests/unit/companyIdentity.test.ts`, U8=`tests/unit/infojobs.mappers.test.ts`

Legend (integration): I1=`tests/integration/db/harness.test.ts`, I2=`tests/integration/db/offer_ingestion_idempotency.test.ts`, I3=`tests/integration/db/aggregateCompanyAndPersist.test.ts`

Legend (e2e): E1=`tests/e2e/ingestion_to_aggregation.e2e.test.ts`, E2=`tests/e2e/repost_detection_to_aggregation.e2e.test.ts`, E3=`tests/e2e/bad_record_skipped.e2e.test.ts`, E4=`tests/e2e/infojobs_pipeline_offline_db.test.ts`, E5=`tests/e2e/infojobs_offline.test.ts`

```
Requirement                                           | U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | I1 | I2 | I3 | E1 | E2 | E3 | E4 | E5
------------------------------------------------------+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----+----
M3 determinism (fixed inputs -> fixed outputs)        | X  |    | X  | X  | X  | X  |    |    |    |    |    |    |    |    |    |
M3 token normalization/diacritics/separators          | X  |    | X  | X  |    |    |    |    |    |    |    |    |    |    |    |
M3 keyword boundaries + multi-token + fields          |    |    | X  |    |    |    |    |    |    |    |    |    |    |    |    |
M3 phrase matching consecutive + punctuation + case   |    |    |    | X  |    |    |    |    |    |    |    |    |    |    |    |
M3 negation windows/cues (EN/ES)                      |    |    | X  | X  | X  |    |    |    |    |    |    |    |    |    |    |
M3 scoring formula + category aggregation             |    |    |    |    |    | X  |    |    |    |    |    |    |    |    |    |
M3 scoring cap (MAX_SCORE)                            |    |    |    |    |    | X  |    |    |    |    |    |    |    |    |    |
M3 negated hits excluded from scoring                 |    |    |    |    |    | X  |    |    |    |    |    |    |    |    |    |
M3 topCategory selection                              |    |    |    |    |    | X  |    |    |    |    |    |    |    |    |    |
M4 aggregation metrics (max/strong/avg/top/lastStrong) |    | X  |    |    |    |    |    |    |    |    | X  | X  |    |    |    |
M4 canonical vs duplicate handling                    |    | X  |    |    |    |    |    |    |    |    | X  |    | X  |    |    |
M4 offer_count weighting (1 + repost_count)           |    | X  |    |    |    |    |    |    |    |    | X  |    |    |    |    |
M4 aggregation persistence to DB                      |    |    |    |    |    |    |    |    |    |    | X  | X  |    |    |    |
M4 aggregation idempotency                            |    |    |    |    |    |    |    |    |    |    | X  | X  |    |    |    |
Ingestion idempotency (no dup offers)                 |    |    |    |    |    |    |    |    |    | X  |    | X  | X  |    |    |
Upsert overwrite semantics (mutable + null)           |    |    |    |    |    |    |    |    |    | X  |    |    |    |    |    |
Repost handling by provider_offer_id                  |    |    |    |    |    |    |    |    |    |    |    |    | X  |    |    |
Bad-record skip (insufficient company identity)       |    |    |    |    |    |    |    |    |    | X  |    |    |    | X  | X  |
Pipeline E2E ingest->match->score->aggregate          |    |    |    |    |    |    |    |    |    |    |    | X  |    |    |    |
Matches persisted                                     |    |    |    |    |    |    |    |    |    |    |    | X  |    |    |    |
Company identity normalization + website domain       |    |    |    |    |    |    | X  | X  |    |    |    |    |    |    | X  |
InfoJobs API mapping (list/detail)                    |    |    |    |    |    |    |    | X  |    |    |    |    |    |    |    |
InfoJobs client offline behavior                      |    |    |    |    |    |    |    |    |    |    |    |    |    |    | X  |
DB harness/migrations + repo wiring                   |    |    |    |    |    |    |    |    | X  |    |    |    |    |    |    |
Run lifecycle persistence/counters                    |    |    |    |    |    |    |    |    |    |    |    |    |    |    | X  |
FK integrity enforcement (negative case)              |    |    |    |    |    |    |    |    |    |    |    |    |    |    |    |
```

## Gaps and overlaps + risk assessment
- Gaps: FK integrity enforcement is not directly tested (no negative FK insert); no explicit cross-run determinism test for matcher/scorer beyond fixed-output unit checks; no test that exercises a DB failure path and validates `failed` counters; no coverage for any dedupe/canonicalization logic beyond provider_offer_id upserts (if expected).
- Overlaps: bad-record skip covered in I2/E3/E4; ingestion idempotency covered in I2/E1/E2; aggregation metrics covered in U2/I3/E1; company identity handling covered in U7/U8/E4; negation covered in U5 plus integration in U3/U4.
- Risk assessment: low risk for M3 matching/scoring math and M4 aggregation calculations (unit + integration + e2e coverage); medium risk around DB constraint enforcement and failure-path behavior; medium risk if future canonicalization/dup detection expands beyond provider_offer_id.
