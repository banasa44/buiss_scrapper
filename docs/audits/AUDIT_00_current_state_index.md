# AUDIT 00 — Current State Index (Directory -> ATS -> Scoring -> Sheets Feedback)

## 1) Entrypoints & how to run

### Actual CLI/runtime entrypoints

1. `src/main.ts` (legacy app entrypoint)
   - `npm run dev` runs `src/main.ts` (`package.json:7`).
   - `npm start` runs `dist/main.js` (`package.json:5`, `package.json:9`).
   - Current behavior: initializes `InfoJobsClient` and exits; no ingestion pipeline call yet (`src/main.ts:9`, `src/main.ts:12`).

2. `src/runnerMain.ts` (actual orchestration entrypoint used by docs)
   - No `package.json` script targets `runnerMain.ts` directly (`package.json:6-19`).
   - README/RUNBOOK instruct running `node dist/runnerMain.js` (`README.md:51-59`, `docs/RUNBOOK.md:37-53`).
   - Chooses mode via `RUN_MODE` and calls `runOnce`/`runForever` (`src/runnerMain.ts:32-39`, `src/runnerMain.ts:42`, `src/runnerMain.ts:37`).

3. DB utility entrypoints
   - `npm run db:migrate` -> `src/db/migrate.ts` (`package.json:10`, `src/db/migrate.ts:112-114`).
   - `npm run db:verify` -> `src/db/verify.ts` (`package.json:11`, `src/db/verify.ts:349-355`).

### Env gates and runtime effects

1. `RUN_MODE` (`once|forever`) gates runner behavior (`src/runnerMain.ts:32-39`, `src/runnerMain.ts:67-73`).
2. `IJ_CLIENT_ID` and `IJ_CLIENT_SECRET` are required by `InfoJobsClient` constructor; missing values throw (`src/clients/infojobs/infojobsClient.ts:79-91`).
3. `DB_PATH` is optional; defaults to `./data/app.db` (`src/db/connection.ts:17-19`, `.env.example:12-13`).
4. `LOG_LEVEL` is optional; defaults to `info` (`src/logger/logger.ts:10`, `.env.example:5-6`).
5. `GOOGLE_SHEETS_SPREADSHEET_ID` gates Sheets sync+feedback branch in ingestion (`src/ingestion/runOfferBatch.ts:85`, `src/constants/clients/googleSheets.ts:55`, `.env.example:36-39`).
6. If Sheets is enabled, service-account env vars are required (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`; `src/clients/googleSheets/googleSheetsClient.ts:94-111`, `.env.example:40-46`).
7. `LIVE_*` gates are test-only, not runtime orchestration gates in `src/`:
   - `LIVE_SHEETS_TEST` (`.env.example:56`, `tests/integration/live/sheets_connectivity.test.ts:5`, `tests/integration/live/sheets_connectivity.test.ts:32`).
   - `LIVE_ATS_TEST` (`tests/integration/live/flows/directory_to_ats.live.test.ts:11`, `tests/integration/live/flows/directory_to_ats.live.test.ts:33`).

### Unknowns

1. Production CLI trigger for Directory -> ATS orchestration is unknown.
   - Checked: `package.json` scripts (`package.json:6-19`), `src/main.ts`, `src/runnerMain.ts`, `src/orchestration/runner.ts`.
   - No entrypoint imports `companySources`, `atsDiscovery`, or `orchestration/ats` (`rg -n "companySources|atsDiscovery|orchestration/ats|runLeverPipeline|runGreenhousePipeline|runAtsOrchestratorOnce|ingestDirectorySources" src/main.ts src/runnerMain.ts src/orchestration/runner.ts` -> no matches).

---

## 2) Runtime flows (high-level map)

### Flow A: InfoJobs route (wired)

1. `main()` in `src/runnerMain.ts` parses `RUN_MODE` and calls `runOnce()` or `runForever()` (`src/runnerMain.ts:31-43`).
2. `runOnce()` opens DB + runs migrations + acquires global lock (`src/orchestration/runner.ts:342-350`).
3. `runOnce()` iterates `ALL_QUERIES` (`src/orchestration/runner.ts:370-371`), and `ALL_QUERIES` currently contains only `INFOJOBS_QUERIES` (`src/queries/index.ts:14`, `src/queries/infojobs.ts:24-44`).
4. `executeQuery()` supports `query.client === "infojobs"`; other clients throw unsupported error (`src/orchestration/runner.ts:178-190`).
5. InfoJobs branch calls `runInfojobsPipeline()` (`src/orchestration/runner.ts:180`).
6. `runInfojobsPipeline()` calls `InfoJobsClient.searchOffers()` then `runOfferBatchIngestion()` (`src/ingestion/pipelines/infojobs.ts:58`, `src/ingestion/pipelines/infojobs.ts:67`).
7. `runOfferBatchIngestion()` wraps work in `withRun()` lifecycle (`src/ingestion/runOfferBatch.ts:55-58`, `src/ingestion/runLifecycle.ts:103-120`).
8. `runOfferBatchIngestion()` calls `ingestOffers()` (`src/ingestion/runOfferBatch.ts:68`).
9. `ingestOffers()` calls `persistOffer()` per offer (`src/ingestion/ingestOffers.ts:53-56`).
10. `persistOffer()` persists company/offer + dedupe/repost logic (`src/ingestion/offerPersistence.ts:166-182`, `src/ingestion/offerPersistence.ts:206-219`, `src/ingestion/offerPersistence.ts:231-344`).
11. If the ingested offer has `description`, `ingestOffers()` does matching/scoring and writes `matches` (`src/ingestion/ingestOffers.ts:90-100`) via `matchOffer()` and `scoreOffer()` (`src/signal/matcher/matcher.ts:198-241`, `src/signal/scorer/scorer.ts:148-202`).
12. End-of-run aggregation executes `aggregateCompaniesAndPersist()` (`src/ingestion/runOfferBatch.ts:76-82`, `src/ingestion/aggregateCompanies.ts:112-152`).
13. Optional branch: if `GOOGLE_SHEETS_SPREADSHEET_ID` is set, run Sheets sync and feedback loop (`src/ingestion/runOfferBatch.ts:85-224`):
   - `syncCompaniesToSheet()` (`src/ingestion/runOfferBatch.ts:109-113`, `src/sheets/syncCompaniesToSheet.ts:36-41`).
   - `processSheetsFeedback()` (`src/ingestion/runOfferBatch.ts:132`, `src/sheets/processSheetsFeedback.ts:52-83`).
   - `applyValidatedFeedbackPlanToDb()` (`src/ingestion/runOfferBatch.ts:140-142`, `src/sheets/feedbackPersistence.ts:41-127`).

### Flow B: Directory -> ATS route (exists, but not wired to active entrypoints)

Current module chain (callable directly; used by integration tests):

1. Directory ingestion: `ingestDirectorySources()` (`src/companySources/ingestDirectorySources.ts:49-169`).
2. ATS discovery batch: `runAtsDiscoveryBatch()` (`src/atsDiscovery/runAtsDiscoveryBatch.ts:37-136`).
3. ATS detection core: `discoverAts()` (`src/atsDiscovery/atsDiscoveryService.ts:36-178`).
4. Discovery persistence: `persistDiscoveryResult()` -> `upsertCompanySourceByCompanyProvider()` (`src/atsDiscovery/persistDiscoveryResult.ts:24-41`, `src/db/repos/companiesRepo.ts:301-351`).
5. Provider ingestion:
   - `runLeverPipeline()` (`src/ingestion/pipelines/lever.ts:28-180`).
   - `runGreenhousePipeline()` (`src/ingestion/pipelines/greenhouse.ts:28-180`).
6. Both ATS pipelines call `ingestOffers()` with known `companyId` (`src/ingestion/pipelines/lever.ts:105-111`, `src/ingestion/pipelines/greenhouse.ts:105-111`), then aggregate (`src/ingestion/pipelines/lever.ts:140-146`, `src/ingestion/pipelines/greenhouse.ts:140-146`).

Wiring status for Flow B:

1. `runAtsOrchestratorOnce()` exists (`src/orchestration/ats/atsOrchestrator.ts:47-132`) but has no caller in `src/` or `tests/` (`rg -n "runAtsOrchestratorOnce" src tests` returns only `src/orchestration/ats/atsOrchestrator.ts:47`).
2. End-to-end Flow B is currently exercised from tests, not entrypoints (`tests/integration/flows/directory_to_ats.offline.test.ts:164-189`).

---

## 3) What is wired today vs what exists

### Wired today (via active runner path)

1. `src/runnerMain.ts` -> `src/orchestration/runner.ts` -> InfoJobs pipeline (`src/orchestration/runner.ts:42-43`, `src/orchestration/runner.ts:178-187`).
2. Query registry currently schedules only InfoJobs (`src/queries/index.ts:14`, `src/queries/infojobs.ts:24-44`).
3. InfoJobs ingestion path includes optional Sheets sync + feedback apply (`src/ingestion/runOfferBatch.ts:85-224`).

### Exists but does not appear to be called by any runtime entrypoint

1. `src/companySources/**` (Catalonia, Madri+d, Lanzadera, shared pipeline, ingestion wrapper)
   - Evidence: no imports from runner/main path (`rg -n "companySources|ingestDirectorySources" src/main.ts src/runnerMain.ts src/orchestration/runner.ts` -> no matches).
   - Additional evidence: in `src/`, references are internal exports/definitions only (`src/companySources/index.ts:16-19`, `src/companySources/ingestDirectorySources.ts:49`).

2. `src/atsDiscovery/**` as runtime path
   - Evidence: only `src/orchestration/ats/atsOrchestrator.ts` imports `runAtsDiscoveryBatch` (`src/orchestration/ats/atsOrchestrator.ts:17`, `src/orchestration/ats/atsOrchestrator.ts:79`), and orchestrator itself has no caller.

3. `src/orchestration/ats/**` (atsOrchestrator + provider runners)
   - Evidence: no imports outside the folder (`rg -n "@/orchestration/ats|runAtsOrchestratorOnce" src --glob '!src/orchestration/ats/**'` -> no matches).
   - `runAtsOrchestratorOnce` has definition-only usage (`src/orchestration/ats/atsOrchestrator.ts:47`).

4. ATS pipelines + ATS clients as production path
   - `runLeverPipeline`/`runGreenhousePipeline` are referenced by ATS runners only (`src/orchestration/ats/leverRunner.ts:11`, `src/orchestration/ats/greenhouseRunner.ts:11`).
   - ATS runners are referenced only by `atsOrchestrator` (`src/orchestration/ats/atsOrchestrator.ts:18-19`, `src/orchestration/ats/atsOrchestrator.ts:92`, `src/orchestration/ats/atsOrchestrator.ts:101`).

5. `src/main.ts` is wired by `npm run dev`/`npm start` but not as end-to-end ingestion
   - It currently initializes client and stops (`src/main.ts:9-13`).

### Exists and is called, but only from tests (not entrypoints)

1. Directory -> ATS -> ATS pipelines chain in integration tests (`tests/integration/flows/directory_to_ats.offline.test.ts:164-189`).
2. Live ATS smoke tests gated by `LIVE_ATS_TEST` (`tests/integration/live/flows/directory_to_ats.live.test.ts:33`, `tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts:34`).

---

## 4) Key invariants currently enforced

### Offers

1. Deduplication key is `(provider, provider_offer_id)`
   - DB-level UNIQUE constraint (`migrations/0002_company_sources_and_global_companies.sql:120`).
   - Repo-level upsert uses `ON CONFLICT(provider, provider_offer_id)` (`src/db/repos/offersRepo.ts:31-39`).

2. ATS offers require non-empty description
   - Enforced in `persistOffer` for ATS providers only (`src/ingestion/offerPersistence.ts:137-150`).

3. Repost detection and duplicate suppression
   - Fingerprint fast-path (`src/ingestion/offerPersistence.ts:235-253`) + fallback similarity detector (`src/ingestion/offerPersistence.ts:273-307`, `src/signal/repost/repostDetection.ts:63-162`).
   - Duplicate outcome increments canonical repost counters (`src/ingestion/offerPersistence.ts:252`, `src/ingestion/offerPersistence.ts:288`, `src/db/repos/offersRepo.ts:144-167`).

4. Idempotency on repeated ingestion
   - Existing offer ID path updates same row + `last_seen_at` (`src/ingestion/offerPersistence.ts:206-219`).
   - Match persistence is idempotent/upsert by `offer_id` (`src/db/repos/matchesRepo.ts:24-31`).

5. Resolution gate blocks further offer ingestion for resolved companies
   - `persistOffer` skips `ACCEPTED/REJECTED/ALREADY_REVOLUT` companies (`src/ingestion/offerPersistence.ts:184-199`, `src/constants/sheets.ts:170-174`).

### Companies

1. Identity requirement: must have `website_domain` or `normalized_name`
   - Directory ingest filter (`src/companySources/ingestDirectorySources.ts:20-22`, `src/companySources/ingestDirectorySources.ts:107-116`).
   - Company persistence derivation + guard (`src/ingestion/companyPersistence.ts:55-58`, `src/ingestion/companyPersistence.ts:116-127`).
   - Repo hard check throws if both missing (`src/db/repos/companiesRepo.ts:35-39`).

2. Company dedupe strategy
   - Prefer `website_domain` identity, fallback `normalized_name` (`src/db/repos/companiesRepo.ts:42-49`, `src/db/repos/companiesRepo.ts:89-95`).
   - Backed by unique indexes (`migrations/0002_company_sources_and_global_companies.sql:39-48`).

3. Company upsert semantics are enrich/COALESCE (not overwrite-null)
   - `upsertCompany` updates use `COALESCE` (`src/db/repos/companiesRepo.ts:54-58`, `src/db/repos/companiesRepo.ts:100-104`).

### Company sources / table writes

1. Directory source ingestion writes `companies` only
   - Explicit module contract (`src/companySources/ingestDirectorySources.ts:7`) and direct `upsertCompany` call (`src/companySources/ingestDirectorySources.ts:122`).

2. Marketplace offer path writes both `companies` and `company_sources`
   - `persistCompanyAndSource` runs `upsertCompany` then `upsertCompanySource` (`src/ingestion/companyPersistence.ts:130`, `src/ingestion/companyPersistence.ts:140`).

3. ATS discovery writes `company_sources` with `(company_id, provider)` upsert behavior
   - `persistDiscoveryResult` -> `upsertCompanySourceByCompanyProvider` (`src/atsDiscovery/persistDiscoveryResult.ts:34-41`, `src/db/repos/companiesRepo.ts:301-351`).

4. ATS ingestion pipelines use pre-known `companyId` and bypass company discovery/source upsert
   - `persistOffer` uses provided `companyId` branch (`src/ingestion/offerPersistence.ts:156-163`).

---

## 5) Known gaps / uncertainties

1. Where should `runAtsOrchestratorOnce()` be invoked in production? No runtime caller found (`src/orchestration/ats/atsOrchestrator.ts:47`; no other references).
2. Should ATS orchestrator own DB initialization? It acquires run lock without calling `openDb()`/`runMigrations()` (`src/orchestration/ats/atsOrchestrator.ts:64-66` vs `src/orchestration/runner.ts:342-343`).
3. Should ATS pipelines trigger Sheets sync/feedback too? Current Sheets/feedback branch exists only in `runOfferBatchIngestion` used by InfoJobs pipeline (`src/ingestion/pipelines/infojobs.ts:67`, `src/ingestion/runOfferBatch.ts:85-224`).
4. Should InfoJobs scoring require detail hydration? `runInfojobsPipeline` ingests search summaries only (`src/ingestion/pipelines/infojobs.ts:58-70`), and scoring runs only when `description` exists (`src/ingestion/ingestOffers.ts:90-100`).
5. Is `src/main.ts` intended to remain as runnable script despite not running ingestion (`src/main.ts:9-13`, `package.json:7`, `package.json:9`)?
6. Should there be an npm script for `runnerMain` to avoid manual `node dist/runnerMain.js` usage (`package.json:6-19`, `README.md:51-59`)?
7. Is directory-source provenance intentionally omitted from `company_sources`? Current contract says no provider-context writes for directory ingestion (`src/companySources/ingestDirectorySources.ts:7`).
8. Should `runAtsOrchestratorOnce` defaults be `1` for all limits in non-test contexts (`src/orchestration/ats/atsOrchestrator.ts:50-52`)?
9. Is mixed `company_sources` upsert identity intentional: `(provider, provider_company_id)` in one path vs `(company_id, provider)` in discovery path (`src/db/repos/companiesRepo.ts:145-216`, `src/db/repos/companiesRepo.ts:301-351`)?
10. Should `LIVE_ATS_TEST` be documented in `.env.example` (currently only `LIVE_SHEETS_TEST` is present; `.env.example:56`)?

---

## 6) Next audits to run

### A1 runtime orchestration audit

1. Validate single-source-of-truth runtime entrypoint and mode behavior.
   - Files: `src/runnerMain.ts`, `package.json`, `README.md`, `docs/RUNBOOK.md`.
2. Trace lock lifecycle and failure modes (including DB-not-open conditions).
   - Files: `src/orchestration/runner.ts`, `src/orchestration/ats/atsOrchestrator.ts`, `src/db/repos/runLockRepo.ts`.
3. Validate per-query state transitions and retry/pause semantics.
   - Files: `src/orchestration/runner.ts`, `src/db/repos/queryStateRepo.ts`, `src/db/repos/clientPauseRepo.ts`.
4. Verify query registry composition and unsupported-client behavior.
   - Files: `src/queries/index.ts`, `src/queries/infojobs.ts`, `src/orchestration/runner.ts`.
5. Confirm run lifecycle consistency (`withRun`, counters, success/failure finalization).
   - Files: `src/ingestion/runLifecycle.ts`, `src/db/repos/runsRepo.ts`, `src/ingestion/runOfferBatch.ts`.
6. Define explicit runtime integration point (or deliberate separation) for ATS orchestrator.
   - Files: `src/orchestration/ats/atsOrchestrator.ts`, `src/runnerMain.ts`, `src/orchestration/runner.ts`.

### A2 parity audit (InfoJobs vs Directory/ATS)

1. Compare InfoJobs vs Lever/Greenhouse ingestion orchestration (run wrappers, counters, failure handling).
   - Files: `src/ingestion/pipelines/infojobs.ts`, `src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`.
2. Compare scoring/matching trigger parity across routes.
   - Files: `src/ingestion/ingestOffers.ts`, `src/clients/infojobs/mappers.ts`, `src/clients/lever/mappers.ts`, `src/clients/greenhouse/mappers.ts`.
3. Compare dedupe/repost and company-link semantics under marketplace vs ATS.
   - Files: `src/ingestion/offerPersistence.ts`, `src/ingestion/companyPersistence.ts`, `src/db/repos/offersRepo.ts`, `src/db/repos/companiesRepo.ts`.
4. Compare Sheets/feedback side effects by route (present vs absent).
   - Files: `src/ingestion/runOfferBatch.ts`, `src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`.
5. Compare provider client contracts and hydration behavior.
   - Files: `src/interfaces/clients/jobOffersClient.ts`, `src/interfaces/clients/atsJobOffersClient.ts`, `src/clients/infojobs/infojobsClient.ts`, `src/clients/lever/leverAtsJobOffersClient.ts`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts`.
6. Validate parity expectations against existing integration tests.
   - Files: `tests/integration/flows/directory_to_ats.offline.test.ts`, `tests/integration/ats/lever_ingestion_rules.offline.test.ts`.

### A3 architecture/boundaries audit

1. Check runtime architecture compliance against `docs/project-layout.md` (entrypoint, layering, client isolation).
   - Files: `docs/project-layout.md`, `src/main.ts`, `src/runnerMain.ts`, `src/orchestration/runner.ts`.
2. Validate boundaries between `companySources`, `atsDiscovery`, `ingestion`, `db/repos`, and `sheets`.
   - Files: `src/companySources/**`, `src/atsDiscovery/**`, `src/ingestion/**`, `src/db/repos/**`, `src/sheets/**`.
3. Validate whether orchestration responsibilities are centralized or split inconsistently.
   - Files: `src/orchestration/runner.ts`, `src/orchestration/ats/atsOrchestrator.ts`, `src/ingestion/runOfferBatch.ts`.
4. Validate canonical type usage and provider-specific leakage.
   - Files: `src/types/clients/job_offers.ts`, `src/types/clients/lever.ts`, `src/types/clients/greenhouse.ts`, `src/clients/**`.
5. Validate constants ownership and env-gate definitions across modules.
   - Files: `src/constants/**`, `.env.example`.
6. Validate error-handling policy consistency (throw vs log+skip).
   - Files: `src/ingestion/offerPersistence.ts`, `src/companySources/ingestDirectorySources.ts`, `src/atsDiscovery/atsDiscoveryService.ts`, `src/sheets/processSheetsFeedback.ts`.

### A4 dead-code/inconsistency audit

1. Build a definitive unused runtime module list starting from actual entrypoints.
   - Files: `src/main.ts`, `src/runnerMain.ts`, `src/orchestration/runner.ts`, `src/orchestration/ats/**`, `src/companySources/**`, `src/atsDiscovery/**`.
2. Identify modules referenced only by tests and decide keep/remove/promote.
   - Files: `tests/integration/flows/directory_to_ats.offline.test.ts`, `tests/integration/live/flows/directory_to_ats.live.test.ts`, `tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts`.
3. Audit script/doc mismatch (`main.ts` legacy vs runner docs).
   - Files: `package.json`, `README.md`, `docs/RUNBOOK.md`, `src/main.ts`, `src/runnerMain.ts`.
4. Audit ATS orchestration dead path and any stale barrel exports.
   - Files: `src/orchestration/ats/index.ts`, `src/atsDiscovery/index.ts`, `src/ingestion/pipelines/index.ts`.
5. Audit unresolved TODOs and unreachable branches in runtime-critical modules.
   - Files: `src/main.ts`, `src/ingestion/runOfferBatch.ts`, `src/ingestion/pipelines/*.ts`.
6. Produce a cleanup plan with risk labels (safe delete, wire-up candidate, keep-test-only).
   - Files: all modules above plus `docs/audits/AUDIT_00_current_state_index.md` as baseline.

---

## Completion checklist

- [x] No production code was modified.
- [x] No tests or fixtures were added/changed.
- [x] Report statements are evidence-based and tied to concrete files/lines or explicit grep outputs.
