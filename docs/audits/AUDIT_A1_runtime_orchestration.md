# AUDIT A1 — Runtime Orchestration (What actually runs, in what order)

Mandatory pre-step completed: `docs/project-layout.md` re-opened and followed (`docs/project-layout.md:1-187`).

## 1) Primary entrypoints

1. `src/main.ts` is the package-script entrypoint today.
- `npm run dev` uses `src/main.ts` (`package.json:7`).
- `npm start` uses `dist/main.js` built from `src/main.ts` (`package.json:5`, `package.json:9`).
- Current behavior: `main()` only initializes `InfoJobsClient` and stops (TODO comment), no orchestration/pipeline call (`src/main.ts:5-13`).

2. `src/runnerMain.ts` is the actual orchestrator entrypoint, but not wired in `package.json` scripts.
- It reads `RUN_MODE` and calls `runOnce()` or `runForever()` (`src/runnerMain.ts:31-43`).
- Valid modes are `once|forever`; invalid mode exits with code 1 (`src/runnerMain.ts:67-73`).
- Manual invocation is documented in file comments (`src/runnerMain.ts:9-16`).

3. Environment/runtime gates used by orchestration path.
- `RUN_MODE` gate for `runnerMain` behavior (`src/runnerMain.ts:32-43`).
- `DB_PATH` for SQLite location (`src/db/connection.ts:17-19`).
- InfoJobs credentials gate via `InfoJobsClient` constructor (`IJ_CLIENT_ID`, `IJ_CLIENT_SECRET`) (`src/clients/infojobs/infojobsClient.ts:79-91`).
- Optional Sheets branch gate in ingestion by `GOOGLE_SHEETS_SPREADSHEET_ID` (`src/ingestion/runOfferBatch.ts:85`, `src/constants/clients/googleSheets.ts:55`).
- No `LIVE_*` env gates found in `src/**` (only in tests). Evidence: `rg -n "LIVE_" src` returned no matches.

## 2) Call graph (ordered steps)

### 2.1 ATS orchestrator run (existing code path)

Status: no production entrypoint currently calls `runAtsOrchestratorOnce`.

Evidence (only declarations/imports):
```bash
rg -n "runAtsOrchestratorOnce|runLeverRunnerOnce|runGreenhouseRunnerOnce|runAtsDiscoveryBatch" src tests
```
Matches in `src/**` are confined to ATS orchestration modules themselves (`src/orchestration/ats/atsOrchestrator.ts`, runners, and `src/atsDiscovery/index.ts`), not `src/main.ts`/`src/runnerMain.ts`.

If invoked, ordered chain is:
1. `runAtsOrchestratorOnce(options)` (`src/orchestration/ats/atsOrchestrator.ts:47-53`).
2. Acquire global lock: `acquireRunLock(ownerId)` (`src/orchestration/ats/atsOrchestrator.ts:63-72`, `src/db/repos/runLockRepo.ts:24-71`).
3. Step 1 discovery: `runAtsDiscoveryBatch({ limit })` (`src/orchestration/ats/atsOrchestrator.ts:77-81`).
4. Discovery batch fetches candidates: `listCompaniesNeedingAtsDiscovery(limit)` (`src/atsDiscovery/runAtsDiscoveryBatch.ts:53-55`, `src/db/repos/companiesRepo.ts:545-563`).
5. For each company: `discoverAts(websiteUrl)` (`src/atsDiscovery/runAtsDiscoveryBatch.ts:65-67`, `src/atsDiscovery/atsDiscoveryService.ts:36-178`).
6. On found tenant: `persistDiscoveryResult(companyId, result)` (`src/atsDiscovery/runAtsDiscoveryBatch.ts:72-74`) → `upsertCompanySourceByCompanyProvider(...)` (`src/atsDiscovery/persistDiscoveryResult.ts:24-41`, `src/db/repos/companiesRepo.ts:301-352`).
7. Step 2 Lever: `runLeverRunnerOnce({ limit })` (`src/orchestration/ats/atsOrchestrator.ts:90-93`).
8. Lever runner checks pause: `isClientPaused("lever")` (`src/orchestration/ats/leverRunner.ts:45-59`, `src/db/repos/clientPauseRepo.ts:86-102`).
9. Lever runner executes `runLeverPipeline({ limit })` (`src/orchestration/ats/leverRunner.ts:63-64`, `src/ingestion/pipelines/lever.ts:28-31`).
10. Lever pipeline run lifecycle: `withRun("lever", ...)` (`src/ingestion/pipelines/lever.ts:46-173`, `src/ingestion/runLifecycle.ts:103-120`).
11. Lever source fetch: `listCompanySourcesByProvider("lever", limit)` (`src/ingestion/pipelines/lever.ts:50`, `src/db/repos/companiesRepo.ts:265-282`).
12. Per source: `listOffersForTenant(tenantKey)` and `hydrateOfferDetails(...)` (`src/ingestion/pipelines/lever.ts:87-93`, `src/clients/lever/leverAtsJobOffersClient.ts:60-126`, `src/clients/lever/leverAtsJobOffersClient.ts:143-218`).
13. Persist/match/score: `ingestOffers(...)` (`src/ingestion/pipelines/lever.ts:105-111`, `src/ingestion/ingestOffers.ts:39-169`) → `persistOffer(...)` (`src/ingestion/ingestOffers.ts:54`, `src/ingestion/offerPersistence.ts:131-353`) → `upsertMatch(...)` when description exists (`src/ingestion/ingestOffers.ts:88-101`).
14. Aggregate companies: `aggregateCompaniesAndPersist(...)` (`src/ingestion/pipelines/lever.ts:139-143`, `src/ingestion/aggregateCompanies.ts:112-152`).
15. Step 3 Greenhouse mirrors Lever: `runGreenhouseRunnerOnce` (`src/orchestration/ats/atsOrchestrator.ts:99-103`) → `runGreenhousePipeline` (`src/orchestration/ats/greenhouseRunner.ts:63-64`, `src/ingestion/pipelines/greenhouse.ts:28-31`) with analogous internals.
16. Release lock in `finally`: `releaseRunLock(ownerId)` (`src/orchestration/ats/atsOrchestrator.ts:126-130`, `src/db/repos/runLockRepo.ts:112-130`).

### 2.2 Legacy/InfoJobs run

There are two distinct paths:

1. `src/main.ts` legacy path (package default):
- `main()` creates `InfoJobsClient` and logs only (`src/main.ts:5-13`).
- No call to `runInfojobsPipeline`, `runOnce`, or ATS orchestrator.

2. `src/runnerMain.ts` operational InfoJobs path:
1. `main()` dispatches to `runOnce()` or `runForever()` by `RUN_MODE` (`src/runnerMain.ts:31-43`).
2. `runForever()` loops `runOnce()` with cycle sleep jitter (`src/orchestration/runner.ts:461-528`).
3. `runOnce()` starts DB init: `openDb()` + `runMigrations()` (`src/orchestration/runner.ts:340-343`).
4. `runOnce()` acquires global lock (`src/orchestration/runner.ts:349-357`).
5. Ensures query rows: `ensureQueryStateRows()` (`src/orchestration/runner.ts:362-364`, `src/orchestration/runner.ts:296-317`).
6. Iterates `ALL_QUERIES` sequentially (`src/orchestration/runner.ts:370-400`).
7. For each query, paused clients are skipped: `isClientPausedDb(query.client)` (`src/orchestration/runner.ts:373-386`).
8. Executes query via `executeQuery(query)` (`src/orchestration/runner.ts:389`).
9. For `query.client === "infojobs"`, executes:
- `new InfoJobsClient()` (`src/orchestration/runner.ts:178-180`)
- `runInfojobsPipeline(...)` (`src/orchestration/runner.ts:180-187`, `src/ingestion/pipelines/infojobs.ts:34-89`)
10. `runInfojobsPipeline` does:
- `client.searchOffers(query)` (`src/ingestion/pipelines/infojobs.ts:56-59`, `src/clients/infojobs/infojobsClient.ts:247-425`)
- `runOfferBatchIngestion(provider, offers, queryKey)` (`src/ingestion/pipelines/infojobs.ts:66-71`, `src/ingestion/runOfferBatch.ts:47-256`)
11. `runOfferBatchIngestion` does:
- `withRun(...)` (`src/ingestion/runOfferBatch.ts:55-232`, `src/ingestion/runLifecycle.ts:103-120`)
- `ingestOffers(...)` (`src/ingestion/runOfferBatch.ts:68-73`)
- `aggregateCompaniesAndPersist(...)` (`src/ingestion/runOfferBatch.ts:75-78`)
- Optional Sheets branch when spreadsheet env exists (`src/ingestion/runOfferBatch.ts:85-224`)
- In Sheets branch: `syncCompaniesToSheet(...)` (`src/ingestion/runOfferBatch.ts:108-112`), then `processSheetsFeedback(...)` (`src/ingestion/runOfferBatch.ts:132`) and conditional `applyValidatedFeedbackPlanToDb(...)` (`src/ingestion/runOfferBatch.ts:140-142`, `src/sheets/feedbackPersistence.ts:41-127`).
12. Query state writebacks:
- success: `markQuerySuccess(...)` (`src/orchestration/runner.ts:193`)
- failure: `markQueryError(...)` (`src/orchestration/runner.ts:261-265`)
13. Lock release in `finally`: `releaseRunLock(ownerId)` (`src/orchestration/runner.ts:440-448`).

## 3) Run controls

### 3.1 Run lock behavior

1. Lock model is DB-backed singleton lock with TTL.
- Name/TTL constants: `RUN_LOCK_NAME="global"`, `RUN_LOCK_TTL_SECONDS=3600` (`src/constants/runLock.ts:10-17`).
- Acquire is atomic via `INSERT ... ON CONFLICT ... WHERE datetime('now') >= expires_at` (`src/db/repos/runLockRepo.ts:34-53`).

2. Lock acquisition outcomes.
- `{ ok: true }` on insert/update (`src/db/repos/runLockRepo.ts:55-58`).
- `{ ok: false, reason: "LOCKED" }` when active lock exists (`src/db/repos/runLockRepo.ts:60-61`).
- `{ ok: false, reason: "DB_NOT_OPEN" }` when DB not opened (`src/db/repos/runLockRepo.ts:62-66`).

3. Lock ownership enforcement on release.
- `releaseRunLock(ownerId)` deletes only when `owner_id` matches (`src/db/repos/runLockRepo.ts:116-124`).

4. Where enforced.
- InfoJobs runner `runOnce` gates on lock (`src/orchestration/runner.ts:349-357`).
- ATS orchestrator also gates on lock (`src/orchestration/ats/atsOrchestrator.ts:63-72`).

### 3.2 Client pause behavior

1. Pause write path.
- `pauseClient()` in runner sets `paused_until` with reason `RATE_LIMIT` via `setClientPause(...)` (`src/orchestration/runner.ts:142-145`, `src/db/repos/clientPauseRepo.ts:35-52`).

2. Pause read/expiry path.
- `isClientPaused()` compares `paused_until` and auto-clears expired pauses (`src/db/repos/clientPauseRepo.ts:86-102`).

3. Where pause state is checked.
- InfoJobs run loop skips paused clients before execution (`src/orchestration/runner.ts:373-386`).
- ATS provider runners skip when paused (`src/orchestration/ats/leverRunner.ts:45-59`, `src/orchestration/ats/greenhouseRunner.ts:45-59`).

### 3.3 Rate-limit handling (set/read)

1. Runner-level classification and action.
- `classifyError()` marks RATE_LIMIT when error message contains `"429"` or `"rate limit"` (`src/orchestration/runner.ts:81-84`).
- On RATE_LIMIT, runner pauses client and stops retries for that query (`src/orchestration/runner.ts:241-245`).

2. HTTP-layer retries.
- Shared `httpRequest` retries idempotent requests on `429`, `408`, and `5xx`; honors `Retry-After` (`src/clients/http/httpClient.ts:277-285`, `src/clients/http/httpClient.ts:324-339`, `src/constants/clients/http.ts:54-62`).

3. ATS/Sheets clients retry internally but do not set pause state.
- Lever/Greenhouse clients pass retry config but return empty results on errors (`src/clients/lever/leverAtsJobOffersClient.ts:81-90`, `src/clients/lever/leverAtsJobOffersClient.ts:110-125`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:83-92`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:141-156`).
- Google Sheets client retries `429/408/5xx` internally (`src/clients/googleSheets/googleSheetsClient.ts:259-285`).

## 4) Boundedness

1. Query-set boundedness.
- `ALL_QUERIES` currently includes only `INFOJOBS_QUERIES` (`src/queries/index.ts:14`).
- Current registry size is 2 (`es_generic_tech`, `es_generic_all`) (`src/queries/infojobs.ts:24-44`).

2. Query-level retry/sleep bounds in runner.
- `MAX_RETRIES_PER_QUERY=3` (`src/constants/runner.ts:11`), used by `executeQuery` retry loop (`src/orchestration/runner.ts:173-176`).
- Inter-query jitter 10s–60s (`src/constants/runner.ts:23-29`, `src/orchestration/runner.ts:396-399`).
- Forever-mode cycle sleep 5–15 minutes (`src/constants/runner.ts:34-39`, `src/orchestration/runner.ts:519-527`).
- Rate-limit pause duration 6 hours (`src/constants/runner.ts:17`, `src/orchestration/runner.ts:243`).

3. InfoJobs fetch bounds.
- Query defaults: `maxPages=10`, `maxOffers=500` (`src/constants/clients/infojobs.ts:41-47`, `src/ingestion/pipelines/infojobs.ts:52-54`).
- Pagination stops by page cap, offer cap, empty pages, errors (`src/clients/infojobs/infojobsClient.ts:275-349`, `src/clients/infojobs/infojobsClient.ts:392-404`).

4. ATS orchestrator and ATS pipeline bounds.
- Orchestrator defaults each phase to `1` when options absent (`src/orchestration/ats/atsOrchestrator.ts:50-53`).
- ATS discovery default batch limit `100` (`src/constants/runner.ts:45`, `src/atsDiscovery/runAtsDiscoveryBatch.ts:40`).
- Lever/Greenhouse source limits default `50` each (`src/constants/runner.ts:51-57`, `src/ingestion/pipelines/lever.ts:31`, `src/ingestion/pipelines/greenhouse.ts:31`).
- SQL-level `LIMIT ?` enforced for both source listings (`src/db/repos/companiesRepo.ts:277-282`, `src/db/repos/companiesRepo.ts:559-563`).
- Greenhouse per-tenant cap: `MAX_JOBS_PER_TENANT=200` (`src/constants/clients/greenhouse.ts:37-43`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:99-103`).

5. ATS discovery scan bounds.
- Candidate URL cap and HTML scan cap via `LIMITS` (`src/constants/atsDiscovery.ts:83-88`, `src/atsDiscovery/atsDiscoveryService.ts:77`).
- 1-hop follow capped by `MAX_LINKS_TO_FOLLOW=5` (`src/constants/atsDiscovery.ts:113-116`, `src/atsDiscovery/atsDiscoveryService.ts:145-148`).

6. Sheets feedback bounded by time window.
- Feedback processing only within 03:00–06:00 Europe/Madrid (`src/constants/sheets.ts:213-216`, `src/sheets/feedbackWindow.ts:50-55`).
- Outside window returns skipped result (`src/sheets/processSheetsFeedback.ts:56-67`).

## 5) Gaps (including non-invoked code)

1. Default app entrypoint does not run orchestration.
- `npm run dev/start` executes `main.ts` (`package.json:7-9`), but `main.ts` only initializes client and has TODO (`src/main.ts:9-13`).

2. Operational runner exists but is not package-script wired.
- `runnerMain.ts` contains orchestration startup (`src/runnerMain.ts:31-43`), but no script points to it (`package.json:6-19`).

3. ATS orchestrator is not called by any production entrypoint.
- `runAtsOrchestratorOnce` appears only in its defining module (`src/orchestration/ats/atsOrchestrator.ts:47`) and not in `src/main.ts`/`src/runnerMain.ts` (search evidence above).

4. ATS discovery/ATS runners are transitively dormant from production entrypoints.
- `runAtsDiscoveryBatch` is called by ATS orchestrator (`src/orchestration/ats/atsOrchestrator.ts:79-81`) and by tests, but not by entrypoints.

5. `runOnce()` likely returns early due DB lifecycle ordering (inference from code).
- `runOnce()` calls `openDb(); runMigrations();` (`src/orchestration/runner.ts:342-343`).
- `runMigrations()` always `closeDb()` in `finally` (`src/db/migrate.ts:95-97`).
- Next step is lock acquisition, which needs open DB (`src/orchestration/runner.ts:349-351`, `src/db/repos/runLockRepo.ts:26`, `src/db/connection.ts:64-66`).
- This implies lock acquisition can return `DB_NOT_OPEN` (`src/db/repos/runLockRepo.ts:64-66`), causing `runOnce()` to exit with zero work (`src/orchestration/runner.ts:352-357`).

6. ATS orchestrator has no DB open/migration pre-step.
- `runAtsOrchestratorOnce` acquires lock immediately (`src/orchestration/ats/atsOrchestrator.ts:63-66`) without `openDb()`/`runMigrations()` in that function.

7. `refreshRunLock` exists but is not used in production flow.
- Defined in `runLockRepo` (`src/db/repos/runLockRepo.ts:82-102`), no calls in `src/**` outside repo (search: `rg -n "refreshRunLock\(" src`).

8. `ATS_PROVIDER_EXECUTION_ORDER` constant exists but is unused.
- Declared (`src/constants/runner.ts:63`) with no references in `src/**` (search: `rg -n "ATS_PROVIDER_EXECUTION_ORDER" src`).

9. Pause writes are centralized to InfoJobs runner path only.
- Write path found only in `src/orchestration/runner.ts:144`.
- ATS runners read pause state but do not set pause on provider errors (`src/orchestration/ats/leverRunner.ts:45-59`, `src/orchestration/ats/greenhouseRunner.ts:45-59`).

---

Completion checklist:
- No production code/tests were modified; only this audit document was added.
- Statements above are evidence-based with concrete function names and file/line citations; one inferred item is explicitly labeled as inference.
