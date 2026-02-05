# Phase 3 Audit — Orchestration & Aggregation Flow

**Flow Summary**
1. Path A (pipeline): `runInfojobsPipeline` builds a query, fetches offers, then calls `runOfferBatchIngestion` with the returned offers. (`src/ingestion/pipelines/infojobs.ts:runInfojobsPipeline`, `src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`)
2. Path B (direct batch): `runOfferBatchIngestion` wraps ingestion in `withRun`, sets counters, and orchestrates ingestion → aggregation → optional Sheets sync. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/ingestion/runLifecycle.ts:withRun`)
3. `ingestOffers` loads the catalog once, then loops offers: `persistOffer` → (if not duplicate) `matchOffer` → `scoreOffer` → `upsertMatch`. (`src/ingestion/ingestOffers.ts:ingestOffers`, `src/catalog/loader.ts:loadCatalog`, `src/ingestion/offerPersistence.ts:persistOffer`, `src/signal/matcher/matcher.ts:matchOffer`, `src/signal/scorer/scorer.ts:scoreOffer`, `src/db/repos/matchesRepo.ts:upsertMatch`)
4. `persistOffer` mutates DB state (companies/company_sources/offers, plus canonicalization fields on reposts); its result controls whether scoring happens. (`src/ingestion/offerPersistence.ts:persistOffer`, `src/ingestion/companyPersistence.ts:persistCompanyAndSource`, `src/db/repos/offersRepo.ts:upsertOffer`, `src/db/repos/offersRepo.ts:updateOfferLastSeenAt`, `src/db/repos/offersRepo.ts:incrementOfferRepostCount`)
5. Aggregation is triggered for all affected company IDs: `aggregateCompaniesAndPersist` chunks and retries, calling `aggregateCompanyAndPersist` for each company. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/ingestion/aggregateCompanies.ts:aggregateCompaniesAndPersist`, `src/signal/aggregation/aggregateCompanyAndPersist.ts:aggregateCompanyAndPersist`)
6. `aggregateCompanyAndPersist` reads offers+matches, maps rows to pure input, runs deterministic aggregation, then updates the company row with the new metrics. (`src/signal/aggregation/aggregateCompanyAndPersist.ts:aggregateCompanyAndPersist`, `src/db/repos/offersRepo.ts:listCompanyOffersForAggregation`, `src/signal/aggregation/mapCompanyOfferRows.ts:mapCompanyOfferRows`, `src/signal/aggregation/aggregateCompany.ts:aggregateCompany`, `src/db/repos/companiesRepo.ts:updateCompanyAggregation`)
7. Optional side effect: if `GOOGLE_SHEETS_SPREADSHEET_ID_ENV` is set, `runOfferBatchIngestion` calls `syncCompaniesToSheet` with a new `GoogleSheetsClient`, logging but not failing on errors. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/sheets/syncCompaniesToSheet.ts:syncCompaniesToSheet`, `src/clients/googleSheets/googleSheetsClient.ts:GoogleSheetsClient`)
8. Outputs: `runOfferBatchIngestion` returns run ID, ingestion result counts, and counters snapshot for callers/tests. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/types/ingestion.ts:RunOfferBatchResult`)

**Failure modes & recovery**
- Catalog load failure stops the batch before any offer processing; the error propagates and the run is finalized by `withRun`. (`src/ingestion/ingestOffers.ts:ingestOffers`, `src/catalog/loader.ts:loadCatalog`, `src/ingestion/runLifecycle.ts:withRun`)
- Unidentifiable companies are skipped without throwing; counters are updated and processing continues. (`src/ingestion/ingestOffers.ts:ingestOffers`, `src/ingestion/companyPersistence.ts:persistCompanyAndSource`)
- DB errors in `persistOffer` are captured as `db_error` results; ingestion continues and affected companies are still queued for aggregation. (`src/ingestion/offerPersistence.ts:persistOffer`, `src/ingestion/ingestOffers.ts:ingestOffers`)
- Scoring/match persistence errors are caught per-offer and logged; the offer remains ingested but has no match record if `upsertMatch` fails. (`src/ingestion/ingestOffers.ts:ingestOffers`, `src/db/repos/matchesRepo.ts:upsertMatch`)
- Aggregation retries are per-company with fixed delay; failures are logged and do not stop the batch. (`src/ingestion/aggregateCompanies.ts:aggregateCompaniesAndPersist`, `src/ingestion/aggregateCompanies.ts:aggregateWithRetry`)
- Sheets sync failures are logged and do not fail the run. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/sheets/syncCompaniesToSheet.ts:syncCompaniesToSheet`)

**Findings (High/Med/Low)**

**High**
- No high-severity orchestration defects observed in current flow; the core pipeline is linear and uses explicit error containment for per-offer and per-company failures. (`src/ingestion/ingestOffers.ts:ingestOffers`, `src/ingestion/aggregateCompanies.ts:aggregateCompaniesAndPersist`, `src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`)

**Medium**
- Aggregation retry/backoff is fixed-delay and only applies to aggregation; there is no retry for ingestion writes or match persistence, so transient DB errors can cause missing matches or partial state without retry. (`src/ingestion/aggregateCompanies.ts:aggregateWithRetry`, `src/ingestion/ingestOffers.ts:ingestOffers`, `src/db/repos/matchesRepo.ts:upsertMatch`)
- Orchestration mixes multiple side effects in a single function (`runOfferBatchIngestion` handles ingestion, aggregation, and Sheets sync), which makes it harder to reason about error domains; only Sheets errors are explicitly isolated as non-fatal. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/sheets/syncCompaniesToSheet.ts:syncCompaniesToSheet`)

**Low**
- Chunking/batching knobs are hard-coded only for aggregation (`CHUNK_SIZE`, `MAX_RETRIES`, `RETRY_DELAY_MS`), while offer ingestion runs unchunked across the input array; large batches may cause long single-pass loops. (`src/ingestion/aggregateCompanies.ts:aggregateCompaniesAndPersist`, `src/ingestion/ingestOffers.ts:ingestOffers`)
- Aggregation logic is not duplicated: `mapCompanyOfferRows` performs data shaping, and `aggregateCompany` contains the sole aggregation algorithm; orchestration layers just wire these pieces. (`src/signal/aggregation/mapCompanyOfferRows.ts:mapCompanyOfferRows`, `src/signal/aggregation/aggregateCompany.ts:aggregateCompany`, `src/signal/aggregation/aggregateCompanyAndPersist.ts:aggregateCompanyAndPersist`)
- Determinism and idempotency are explicit in the pure aggregation path: `aggregateCompany` is deterministic and `aggregateCompanyAndPersist` recomputes from DB state each time. (`src/signal/aggregation/aggregateCompany.ts:aggregateCompany`, `src/signal/aggregation/aggregateCompanyAndPersist.ts:aggregateCompanyAndPersist`)

**Test gaps**
- No E2E test exercises the aggregation retry path (fail then succeed) or validates retry counts/delays. (`src/ingestion/aggregateCompanies.ts:aggregateWithRetry`, `tests/e2e/*.test.ts`)
- No E2E test covers Sheets sync behavior (success or failure) even though it is part of the orchestration path. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/sheets/syncCompaniesToSheet.ts:syncCompaniesToSheet`, `tests/e2e/*.test.ts`)
- Partial failure scenarios in scoring/match persistence (e.g., `upsertMatch` throwing) are not represented in E2E coverage. (`src/ingestion/ingestOffers.ts:ingestOffers`, `src/db/repos/matchesRepo.ts:upsertMatch`, `tests/e2e/*.test.ts`)
- Run lifecycle assertions are covered in `infojobs_pipeline_offline_db` but not in other E2E tests that use `runOfferBatchIngestion`, so run record fields beyond `finished_at` are not consistently asserted. (`tests/e2e/infojobs_pipeline_offline_db.test.ts`, `tests/e2e/ingestion_to_aggregation.e2e.test.ts`, `src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`)
