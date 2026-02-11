# AUDIT_11: Parity vs InfoJobs pipeline (using AUDIT_10 baseline)

## 1) Legacy flow summary (InfoJobs)
This section builds on the flow inventory already documented in `docs/audits/AUDIT_10_directory_to_ats_inventory.md:52` and `docs/audits/AUDIT_10_directory_to_ats_inventory.md:78`.

- Runner executes InfoJobs queries only (`src/queries/index.ts:14`, `src/orchestration/runner.ts:178`).
- `runInfojobsPipeline()` calls `InfoJobsClient.searchOffers()` and passes `searchResult.offers` directly to ingestion (`src/ingestion/pipelines/infojobs.ts:58`, `src/ingestion/pipelines/infojobs.ts:67`).
- `searchOffers()` maps list payloads to `JobOfferSummary` (`src/clients/infojobs/infojobsClient.ts:322`, `src/clients/infojobs/mappers.ts:97`).
- Company + source persistence for marketplace offers is done inside `persistOffer()` via `persistCompanyAndSource()` (when no `companyId` is provided) (`src/ingestion/offerPersistence.ts:144`, `src/ingestion/companyPersistence.ts:108`).
- This route also includes Sheets sync + feedback side-effects in `runOfferBatchIngestion()` (`src/ingestion/runOfferBatch.ts:84`, `src/ingestion/runOfferBatch.ts:129`).

## 2) New flow summary (Directory -> ATS)
This section also builds on `AUDIT_10` (stages in `docs/audits/AUDIT_10_directory_to_ats_inventory.md:54` to `docs/audits/AUDIT_10_directory_to_ats_inventory.md:76`).

- Directory companies are persisted by `ingestDirectorySources()` -> `upsertCompany()` (`src/companySources/ingestDirectorySources.ts:49`, `src/companySources/ingestDirectorySources.ts:122`).
- ATS discovery resolves tenants and writes to `company_sources` via `persistDiscoveryResult()` (`src/atsDiscovery/runAtsDiscoveryBatch.ts:66`, `src/atsDiscovery/persistDiscoveryResult.ts:24`, `src/atsDiscovery/persistDiscoveryResult.ts:34`).
- ATS pipelines (`runLeverPipeline`, `runGreenhousePipeline`) read `company_sources`, fetch offers, hydrate details, then call `ingestOffers()` with explicit `companyId` (`src/ingestion/pipelines/lever.ts:50`, `src/ingestion/pipelines/lever.ts:90`, `src/ingestion/pipelines/lever.ts:105`, `src/ingestion/pipelines/greenhouse.ts:50`, `src/ingestion/pipelines/greenhouse.ts:90`, `src/ingestion/pipelines/greenhouse.ts:105`).
- As captured in AUDIT_10, this route is currently not runner-wired (`docs/audits/AUDIT_10_directory_to_ats_inventory.md:83` to `docs/audits/AUDIT_10_directory_to_ats_inventory.md:86`).

## 3) Parity checklist
| Area | Legacy (InfoJobs) | New (Directory->ATS) | Parity |
|---|---|---|---|
| Company identity inputs | Mostly normalized name from list author; website fields appear only in detail mapper (`src/clients/infojobs/mappers.ts:121`, `src/clients/infojobs/mappers.ts:128`, `src/clients/infojobs/mappers.ts:164`) | Directory extraction provides `website_url` + `website_domain` + normalized name before persistence (`src/companySources/shared/listingExtraction.ts`, `src/companySources/shared/directoryPipeline.ts`) | Partial |
| Company persistence path | `persistOffer` -> `persistCompanyAndSource` -> `upsertCompany` + `upsertCompanySource` (`src/ingestion/offerPersistence.ts:146`, `src/ingestion/companyPersistence.ts:129`, `src/ingestion/companyPersistence.ts:140`) | Directory stage calls `upsertCompany` directly; ATS offers pass `companyId` and bypass `persistCompanyAndSource` (`src/companySources/ingestDirectorySources.ts:122`, `src/ingestion/offerPersistence.ts:136`) | Partial |
| Offer dedupe key | Same canonical dedupe `(provider, provider_offer_id)` via `upsertOffer` (`src/db/repos/offersRepo.ts:18`, `src/db/repos/offersRepo.ts:38`) | Same (`src/db/repos/offersRepo.ts:18`, `src/db/repos/offersRepo.ts:38`) | Yes |
| Repost dedupe behavior | Same `persistOffer()` repost logic (fingerprint + similarity) (`src/ingestion/offerPersistence.ts:211`, `src/ingestion/offerPersistence.ts:253`) | Same shared `persistOffer()` (`src/ingestion/offerPersistence.ts:211`, `src/ingestion/offerPersistence.ts:253`) | Yes |
| Scoring/matching trigger | Ingested offers are summaries from list API; scoring only runs when `"description" in offer` (`src/ingestion/pipelines/infojobs.ts:67`, `src/ingestion/ingestOffers.ts:85`) | ATS pipelines hydrate to details before ingest, so scoring path is reached more consistently (`src/ingestion/pipelines/lever.ts:90`, `src/ingestion/pipelines/greenhouse.ts:90`, `src/ingestion/ingestOffers.ts:85`) | No |
| Failure mode: provider fetch | InfoJobs auth 401/403 is fatal throw (`src/clients/infojobs/infojobsClient.ts:365`, `src/clients/infojobs/infojobsClient.ts:375`) | ATS client fetch/hydrate failures return empty arrays (non-throw), pipeline continues (`src/clients/lever/leverAtsJobOffersClient.ts:110`, `src/clients/lever/leverAtsJobOffersClient.ts:209`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:141`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:238`) | No |
| Run counters semantics | `runOfferBatchIngestion` sets `offers_fetched = offers.length` and returns raw `ingestOffers` result (`src/ingestion/runOfferBatch.ts:62`, `src/ingestion/runOfferBatch.ts:229`) | ATS pipelines compute `processed` manually and hardcode `duplicates: 0` (`src/ingestion/pipelines/lever.ts:163`, `src/ingestion/pipelines/lever.ts:165`, `src/ingestion/pipelines/greenhouse.ts:163`, `src/ingestion/pipelines/greenhouse.ts:165`) | No |
| Downstream side-effects | Includes Sheets sync + feedback logic (`src/ingestion/runOfferBatch.ts:84`, `src/ingestion/runOfferBatch.ts:129`) | ATS pipelines do not run those side-effects (`src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`) | No |
| Runtime orchestration | Fully runner-driven today (`src/orchestration/runner.ts:178`) | Not runner-wired today (from AUDIT_10 baseline) (`docs/audits/AUDIT_10_directory_to_ats_inventory.md:83`) | No |

## 4) Differences (classified) + one fix/test each

1. **Scoring parity gap: InfoJobs route ingests summaries, ATS route ingests details**
   - Classification: **Bug**
   - Evidence:
     - InfoJobs passes `searchResult.offers` directly (`JobOfferSummary[]`) into ingestion (`src/ingestion/pipelines/infojobs.ts:67`).
     - Scoring requires `"description" in offer` (`src/ingestion/ingestOffers.ts:85`).
     - InfoJobs list mapper has no `description` field (`src/clients/infojobs/mappers.ts:114` to `src/clients/infojobs/mappers.ts:137`).
     - ATS routes explicitly hydrate details before ingestion (`src/ingestion/pipelines/lever.ts:90`, `src/ingestion/pipelines/greenhouse.ts:90`).
   - Recommendation (test): Add an integration test that asserts InfoJobs ingests at least one `matches` row for a mocked offer containing detail text; this will fail until detail hydration is wired for InfoJobs.

2. **Cross-route company merge can fail on directory ingest after InfoJobs-created company**
   - Classification: **Bug**
   - Evidence:
     - `upsertCompany()` chooses domain-first strategy and inserts if domain not found, without normalized-name fallback in that branch (`src/db/repos/companiesRepo.ts:42` to `src/db/repos/companiesRepo.ts:86`).
     - DB enforces unique `normalized_name` and unique `website_domain` (`migrations/0002_company_sources_and_global_companies.sql:39` to `migrations/0002_company_sources_and_global_companies.sql:48`).
     - Directory ingestion catches upsert errors and counts failure (`src/companySources/ingestDirectorySources.ts:129` to `src/companySources/ingestDirectorySources.ts:135`).
   - Recommendation (test): Add a repo test where an existing company with same `normalized_name` and null domain is followed by an upsert with new domain + same name; expected behavior should be enrichment, not failure.

3. **Run telemetry parity mismatch in ATS pipelines (duplicates/processed semantics)**
   - Classification: **Risk**
   - Evidence:
     - `ingestOffers` returns `processed = offers.length` and tracks `duplicates` (`src/ingestion/ingestOffers.ts:143`, `src/ingestion/ingestOffers.ts:149`).
     - ATS pipelines recompute `processed` as `upserted+skipped+failed` and force `duplicates: 0` (`src/ingestion/pipelines/lever.ts:163` to `src/ingestion/pipelines/lever.ts:166`, `src/ingestion/pipelines/greenhouse.ts:163` to `src/ingestion/pipelines/greenhouse.ts:166`).
   - Recommendation (fix): Return the accumulated `ingestOffers` totals directly (including `duplicates`) in ATS pipeline results to match legacy telemetry semantics.

4. **Failure-handling asymmetry: InfoJobs fails fast on auth; ATS clients degrade silently to empty**
   - Classification: **Risk**
   - Evidence:
     - InfoJobs throws on 401/403 (`src/clients/infojobs/infojobsClient.ts:365` to `src/clients/infojobs/infojobsClient.ts:377`).
     - Lever/Greenhouse client fetch/hydrate failures return empty arrays (`src/clients/lever/leverAtsJobOffersClient.ts:110` to `src/clients/lever/leverAtsJobOffersClient.ts:125`, `src/clients/lever/leverAtsJobOffersClient.ts:209` to `src/clients/lever/leverAtsJobOffersClient.ts:217`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:141` to `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:156`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:238` to `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:246`).
   - Recommendation (test): Add pipeline tests asserting that persistent provider-fetch failures increment a surfaced error counter and mark run notes, rather than only producing zero offers.

5. **Persistence side-effects differ: InfoJobs route triggers Sheets/feedback; ATS route does not**
   - Classification: **Acceptable (for now), but operationally divergent**
   - Evidence:
     - InfoJobs path uses `runOfferBatchIngestion()` with Sheets sync + feedback logic (`src/ingestion/runOfferBatch.ts:84` to `src/ingestion/runOfferBatch.ts:223`).
     - ATS pipelines do not call that path (`src/ingestion/pipelines/lever.ts:46`, `src/ingestion/pipelines/greenhouse.ts:46`).
   - Recommendation (test): Add an orchestration-level test documenting expected side-effects per provider (whether sheet sync is expected) to prevent accidental behavior drift.

6. **Company source persistence semantics differ between routes**
   - Classification: **Risk**
   - Evidence:
     - InfoJobs marketplace offers always attempt `upsertCompanySource` (`src/ingestion/companyPersistence.ts:132` to `src/ingestion/companyPersistence.ts:141`).
     - ATS offers bypass company/source persistence when `companyId` is supplied (`src/ingestion/offerPersistence.ts:136` to `src/ingestion/offerPersistence.ts:144`).
     - ATS discovery writes `hidden: null` by design (`src/atsDiscovery/persistDiscoveryResult.ts:39`).
   - Recommendation (test): Add a regression test asserting expected `company_sources.hidden`/`provider_company_url` behavior after repeated ATS ingestions, so stale source metadata is intentional and monitored.

7. **End-to-end parity with legacy scheduler is not achieved yet**
   - Classification: **Risk**
   - Evidence:
     - AUDIT_10 explicitly records new chain is not runner-wired (`docs/audits/AUDIT_10_directory_to_ats_inventory.md:83` to `docs/audits/AUDIT_10_directory_to_ats_inventory.md:86`).
     - Runner still dispatches only `infojobs` client queries (`src/orchestration/runner.ts:178` to `src/orchestration/runner.ts:190`).
   - Recommendation (fix): Add a dedicated orchestration entrypoint that executes `ingestDirectorySources` -> `runAtsDiscoveryBatch` -> `runLeverPipeline`/`runGreenhousePipeline`, then integration-test it under `runOnce` mode.

## Notes
- This parity audit intentionally reuses AUDIT_10’s inventory baseline instead of rebuilding it.
- Optional compile check was **not run** in this audit turn.

