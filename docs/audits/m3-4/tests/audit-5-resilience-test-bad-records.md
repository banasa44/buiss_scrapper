# AUDIT 5 — Resilience test audit (bad records)

Goal: validate that the bad-record E2E test truly simulates real external-data failure and confirms log+skip behavior.

## What makes the record “bad”
- The “bad” offer omits **all company identity evidence** (no `name`, `nameRaw`, `normalizedName`, `websiteUrl`, or `websiteDomain`). This mirrors a realistic upstream failure where the provider payload lacks company identity (e.g., missing author/company name or website). `tests/e2e/bad_record_skipped.e2e.test.ts:63-89`.
- It **does not bypass types unsafely**: `JobOfferCompany` fields are all optional, so `company: {}` is type-valid; no `as any` is used. `src/types/clients/job_offers.ts:37-45`, `tests/e2e/bad_record_skipped.e2e.test.ts:72-89`.

## Where skip reasons/counters are produced
- Identity derivation + skip decision happens in `persistCompanyAndSource`:
  - If no `websiteDomain` and no `normalizedName`, it logs and returns `{ ok: false, reason: "insufficient_identity_evidence" }`. `src/ingestion/companyPersistence.ts:55-127`.
- The offer is then skipped at `persistOffer`, which logs and returns `{ ok: false, reason: "company_unidentifiable" }`. `src/ingestion/offerPersistence.ts:100-114`.
- `ingestOffers` increments `skipped` and `acc.counters.offers_skipped` on this reason, and continues the loop (per-offer failures do not throw). `src/ingestion/ingestOffers.ts:50-110`.
- `runOfferBatchIngestion` wraps this in the run lifecycle and returns the counters + result. `src/ingestion/runOfferBatch.ts:45-97`.

## Assertions and end-state validation
- The test confirms **pipeline continues** and **valid offers persist** in all three scenarios:
  - Mixed valid + invalid: counters reflect 2 processed / 1 upserted / 1 skipped and valid offer exists in DB; invalid offer absent; aggregation ran. `tests/e2e/bad_record_skipped.e2e.test.ts:92-143`.
  - All invalid: processed=2, upserted=0, skipped=2, DB empty. `tests/e2e/bad_record_skipped.e2e.test.ts:145-176`.
  - Alternating valid/invalid: processed=5, upserted=3, skipped=2; all valid persisted; invalid absent; aggregation ran with offer_count=3. `tests/e2e/bad_record_skipped.e2e.test.ts:178-253`.
- It **does not assert logs** despite the goal statement referencing “log + skip”. There is no verification of logger output or skip reason text.
- It **does not verify run counters** (`result.counters.offers_skipped`) even though those are updated in `ingestOffers`; it only checks `result.result.*` and DB state.

## Confidence assessment
- **Medium-high confidence** that the pipeline correctly skips unidentifiable companies and continues processing valid offers, because the test uses the real ingestion entrypoint with real DB and verifies persistence + aggregation outcomes.
- **Medium confidence** on “log + skip” behavior because logging is not asserted, only inferred from counters and persistence results.

## Recommended adjustments (no code)
- Add a lightweight assertion on counters (`result.counters.offers_skipped` and `offers_fetched`) to validate the run-level accounting matches per-offer results.
- If “log + skip” is a contract, consider capturing logger output or injecting a logger spy to confirm the log message and reason are emitted when a record is skipped.
- Consider a second “bad” variant that mimics more realistic partial failures (e.g., `name` present but normalization yields empty string, or website URL is present but unparsable) to validate the identity derivation paths, not just the all-missing case.
