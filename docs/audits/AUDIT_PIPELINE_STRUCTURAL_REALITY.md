# AUDIT_PIPELINE_STRUCTURAL_REALITY

## 1. Execution Graph Reality

### 1.1 Entrypoint Inventory
- `src/main.ts:5` → `main()` is a legacy dead-end entrypoint: logs startup, constructs `InfoJobsClient`, returns. No DB open, no query execution, no ingestion call.
- `src/runnerMain.ts:26` → `main()` dispatches to `runOnce()` or `runForever()` from `src/orchestration/runner.ts:331` and `src/orchestration/runner.ts:461`.
- `src/orchestration/ats/atsOrchestrator.ts:47` exports ATS sequence entrypoint `runAtsOrchestratorOnce()`, but it is not imported by any production entrypoint.

### 1.2 Function-Level Execution Graphs

#### Graph A: `main.ts` (legacy)
```text
src/main.ts:5 main()
  -> new InfoJobsClient() (src/main.ts:9)
  -> return
```

#### Graph B: `runnerMain.ts` once-mode (actual current execution)
```text
src/runnerMain.ts:26 main()
  -> runOnce() (src/orchestration/runner.ts:331)
     -> openDb() (src/orchestration/runner.ts:342)
     -> runMigrations() (src/orchestration/runner.ts:343)
        -> closeDb() in finally (src/db/migrate.ts:95)
     -> acquireRunLock(ownerId) (src/orchestration/runner.ts:350)
        -> returns { ok: false, reason: "DB_NOT_OPEN" } (src/db/repos/runLockRepo.ts:64)
     -> early return { total: 0, success: 0, failed: 0, skipped: 0 } (src/orchestration/runner.ts:356)
```

#### Graph C: `runnerMain.ts` forever-mode
```text
src/runnerMain.ts:26 main()
  -> runForever() (src/orchestration/runner.ts:461)
     -> loop:
        -> runOnce() (same Graph B)
        -> sleep jitter
```

#### Graph D: ATS orchestrator direct call (actual current execution)
```text
src/orchestration/ats/atsOrchestrator.ts:47 runAtsOrchestratorOnce()
  -> acquireRunLock(ownerId) (src/orchestration/ats/atsOrchestrator.ts:65)
     -> returns { ok: false, reason: "DB_NOT_OPEN" } (src/db/repos/runLockRepo.ts:64)
  -> return
```

### 1.3 Runtime Reachability vs Intended Pipeline Stages

For `src/main.ts` execution:
- Directory ingestion: not reached
- ATS discovery: not reached
- ATS ingestion: not reached
- Scoring/metrics: not reached
- Sheets sync: not reached
- Feedback apply: not reached

For `src/runnerMain.ts` execution (current code behavior):
- Query loop: not reached (lock acquisition exits early)
- InfoJobs pipeline: not reached
- Directory/ATS modules: not reached
- Scoring/metrics: not reached
- Sheets/feedback: not reached

Observed runtime evidence:
- `npx ts-node -r tsconfig-paths/register src/runnerMain.ts` emitted `reason:"DB_NOT_OPEN"` and exited with totals `0/0/0/0`.
- `npx ts-node -r tsconfig-paths/register -e "import { runAtsOrchestratorOnce } ..."` emitted `reason:"DB_NOT_OPEN"`.

### 1.4 Exists but Not Called by Production Entrypoints
- `src/orchestration/ats/atsOrchestrator.ts:47` `runAtsOrchestratorOnce` (definition-only in `src/`).
- `src/orchestration/ats/leverRunner.ts:37` `runLeverRunnerOnce` (only called by ATS orchestrator).
- `src/orchestration/ats/greenhouseRunner.ts:37` `runGreenhouseRunnerOnce` (only called by ATS orchestrator).
- `src/companySources/ingestDirectorySources.ts:49` `ingestDirectorySources` (used in tests, not production orchestration).
- `src/atsDiscovery/runAtsDiscoveryBatch.ts:37` `runAtsDiscoveryBatch` (called by ATS orchestrator + tests only).
- `src/ingestion/pipelines/lever.ts:28` `runLeverPipeline` (called by ATS runners + tests only).
- `src/ingestion/pipelines/greenhouse.ts:28` `runGreenhousePipeline` (called by ATS runners + tests only).

## 2. Directory Layer Reality

### 2.1 Entry Functions
- `src/companySources/ingestDirectorySources.ts:49` `ingestDirectorySources(sources)`.
- Source fetchers:
- `src/companySources/catalonia/cataloniaSource.ts:41` `fetchCataloniaCompanies`.
- `src/companySources/madrimasd/madrimasdSource.ts:43` `fetchMadrimasdCompanies`.
- `src/companySources/lanzadera/lanzaderaSource.ts:81` `fetchLanzaderaCompanies`.
- Shared multi-step helper:
- `src/companySources/shared/directoryPipeline.ts:50` `fetchCompaniesViaDetailPages`.

### 2.2 Persistence Layer and DB Writes
- Persistence call: `upsertCompany(...)` from `src/companySources/ingestDirectorySources.ts:122`.
- Repo target: `src/db/repos/companiesRepo.ts:31` (`companies` table).
- Explicit non-write to `company_sources` in this path (`src/companySources/ingestDirectorySources.ts:7`).

### 2.3 Orchestration Reachability
- No imports from `src/main.ts`, `src/runnerMain.ts`, or `src/orchestration/runner.ts`.
- Usage observed in tests only (`tests/integration/flows/directory_to_ats.offline.test.ts:2`, live equivalents).
- Manual scripts in `scripts/` call source fetchers, not production orchestration.

### 2.4 Reachability Classification
- Runtime-reachable from production entrypoints: **No**
- Test-reachable: **Yes**
- Persistence behavior: **Writes to `companies` only**

## 3. ATS Discovery Reality

### 3.1 Entry + Internal Chain
```text
runAtsDiscoveryBatch() (src/atsDiscovery/runAtsDiscoveryBatch.ts:37)
  -> listCompaniesNeedingAtsDiscovery(limit) (src/db/repos/companiesRepo.ts:545)
  -> discoverAts(websiteUrl) (src/atsDiscovery/atsDiscoveryService.ts:36)
     -> fetchHtmlPage / tryDetectAtsFromUrl / detectors
  -> persistDiscoveryResult(companyId, result) (src/atsDiscovery/persistDiscoveryResult.ts:24)
     -> upsertCompanySourceByCompanyProvider(...) (src/db/repos/companiesRepo.ts:301)
```

### 3.2 Company Selection Semantics
- Selection query in `src/db/repos/companiesRepo.ts:548`:
- `companies.website_url IS NOT NULL`
- excludes companies already having `company_sources.provider IN ('lever','greenhouse')`
- ordered by `companies.id ASC`, limited by parameter.

### 3.3 DB Writes
- Writes to `company_sources` via `upsertCompanySourceByCompanyProvider` (`src/atsDiscovery/persistDiscoveryResult.ts:34`).
- No writes to `query_state`, `ingestion_runs`, or `offers` in discovery path.

### 3.4 Dependency on Directory Ingestion
- Hard dependency: **No explicit call dependency**.
- Data dependency: needs companies with non-null `website_url` (`src/db/repos/companiesRepo.ts:551`).
- Directory ingestion is one practical producer of such rows; not the only theoretical source.

### 3.5 Runtime Wiring
- Called by ATS orchestrator (`src/orchestration/ats/atsOrchestrator.ts:79`) and tests.
- Not called by `src/main.ts` or `src/runnerMain.ts`.
- Runtime-reachable from production entrypoints: **No**.

## 4. ATS Ingestion Reality

### 4.1 Lever Chain (Exact)
```text
runLeverPipeline() (src/ingestion/pipelines/lever.ts:28)
  -> withRun("lever") (src/ingestion/pipelines/lever.ts:46)
     -> listCompanySourcesByProvider("lever", limit) (src/ingestion/pipelines/lever.ts:50)
     -> LeverAtsJobOffersClient.listOffersForTenant(tenantKey) (src/ingestion/pipelines/lever.ts:87)
     -> LeverAtsJobOffersClient.hydrateOfferDetails(...) (src/ingestion/pipelines/lever.ts:90)
     -> ingestOffers(...) (src/ingestion/pipelines/lever.ts:105)
        -> persistOffer(...) (src/ingestion/ingestOffers.ts:54)
           -> upsertOffer / repost detection updates (src/ingestion/offerPersistence.ts:311, :252, :288)
        -> matchOffer(...) (src/ingestion/ingestOffers.ts:92)
        -> scoreOffer(...) (src/ingestion/ingestOffers.ts:93)
        -> upsertMatch(...) (src/ingestion/ingestOffers.ts:96)
     -> aggregateCompaniesAndPersist(...) (src/ingestion/pipelines/lever.ts:140)
        -> aggregateCompanyAndPersist(companyId) (src/ingestion/aggregateCompanies.ts:48)
        -> listCompanyOffersForAggregation(...) (src/signal/aggregation/aggregateCompanyAndPersist.ts:39)
        -> aggregateCompany(...) (src/signal/aggregation/aggregateCompanyAndPersist.ts:45)
        -> updateCompanyAggregation(...) (src/signal/aggregation/aggregateCompanyAndPersist.ts:61)
```

### 4.2 Greenhouse Chain (Exact)
- Mirrors Lever with provider/client swap:
- `runGreenhousePipeline` (`src/ingestion/pipelines/greenhouse.ts:28`)
- `GreenhouseAtsJobOffersClient.listOffersForTenant` (`src/ingestion/pipelines/greenhouse.ts:87`)
- `hydrateOfferDetails` (`src/ingestion/pipelines/greenhouse.ts:90`)
- same `ingestOffers` → `persistOffer` → `matchOffer` → `scoreOffer` → `upsertMatch`
- same `aggregateCompaniesAndPersist`.

### 4.3 Trigger Mechanism Today
- Direct triggers:
- ATS runners (`src/orchestration/ats/leverRunner.ts:63`, `src/orchestration/ats/greenhouseRunner.ts:63`)
- tests
- Production entrypoint trigger: **none**.

### 4.4 InfoJobs Coupling Check
- ATS pipelines do **not** call `runOfferBatchIngestion`.
- ATS pipelines use `withRun + ingestOffers + aggregateCompaniesAndPersist` directly.
- Therefore ATS ingestion is **not wrapped inside InfoJobs-specific pipeline code**.

### 4.5 Scoring + Match Persistence Semantics
- Scoring occurs in `ingestOffers` only for offers carrying `description` (`src/ingestion/ingestOffers.ts:90`).
- ATS guard enforces description for ATS providers (`src/ingestion/offerPersistence.ts:137`).
- Matches are persisted via `upsertMatch` when scoring executes (`src/ingestion/ingestOffers.ts:96`).
- Scoring is skipped for repost duplicates (`src/ingestion/ingestOffers.ts:74`) and for skipped/failed persistence branches.

### 4.6 Reachability Classification
- Lever/Greenhouse ingestion exists and is test/manual callable.
- Runtime-reachable from production entrypoints: **No**.

## 5. Sheets & Feedback Reality

### 5.1 Trigger Path
```text
runOfferBatchIngestion(...) (src/ingestion/runOfferBatch.ts:47)
  -> if GOOGLE_SHEETS_SPREADSHEET_ID exists (src/ingestion/runOfferBatch.ts:85)
     -> new GoogleSheetsClient(...) (src/ingestion/runOfferBatch.ts:90)
     -> assertAuthReady() (src/ingestion/runOfferBatch.ts:99)
     -> syncCompaniesToSheet(...) (src/ingestion/runOfferBatch.ts:109)
        -> provisionCompaniesSheet (src/sheets/syncCompaniesToSheet.ts:41)
        -> appendNewCompaniesToSheet (src/sheets/syncCompaniesToSheet.ts:46)
        -> updateCompanyMetricsInSheet (src/sheets/syncCompaniesToSheet.ts:52)
     -> processSheetsFeedback(...) (src/ingestion/runOfferBatch.ts:132)
        -> window gate (src/sheets/processSheetsFeedback.ts:57)
        -> read / compare / validate
     -> applyValidatedFeedbackPlanToDb(...) when plan exists (src/ingestion/runOfferBatch.ts:140)
        -> updateCompanyResolution (src/sheets/feedbackPersistence.ts:66)
        -> deleteOffersByCompanyId for destructive transitions (src/sheets/feedbackPersistence.ts:95)
```

### 5.2 ATS Compatibility vs ATS Wiring
- Data model compatibility: operates on `companies`/`offers` globally (provider-agnostic tables).
- Actual invocation wiring: only from `runOfferBatchIngestion` (`src/ingestion/runOfferBatch.ts:22`), and that wrapper is called only by `runInfojobsPipeline` (`src/ingestion/pipelines/infojobs.ts:67`).
- ATS pipelines (`src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`) do not invoke sheets/feedback modules.

### 5.3 Feature Gates
- Env gate: `GOOGLE_SHEETS_SPREADSHEET_ID` required (`src/ingestion/runOfferBatch.ts:85`, constant `src/constants/clients/googleSheets.ts:55`).
- Auth gate: service-account env/credentials required inside `GoogleSheetsClient` constructor (`src/clients/googleSheets/googleSheetsClient.ts:94`).
- Time gate for feedback: 03:00-06:00 Europe/Madrid (`src/sheets/feedbackWindow.ts:50`, `src/constants/sheets.ts:213`).

### 5.4 Reachability Classification
- Sheets sync reachable from InfoJobs batch wrapper path only.
- Feedback processing/apply reachable from same path only.
- Sheets/feedback reachable from ATS ingestion flow: **No**.

## 6. State & Run Infrastructure Reality

### 6.1 Persisted State Surfaces
- `ingestion_runs` via `src/db/repos/runsRepo.ts`.
- `query_state` via `src/db/repos/queryStateRepo.ts`.
- `run_lock` via `src/db/repos/runLockRepo.ts`.
- `client_pause` via `src/db/repos/clientPauseRepo.ts`.

### 6.2 Active Runtime Usage
- `ingestion_runs`:
- Created/finalized by `withRun` (`src/ingestion/runLifecycle.ts:109`, `:119`) for InfoJobs and ATS pipelines.
- `query_fingerprint` populated only when caller supplies `queryKey`; ATS pipelines call `withRun` without queryKey (`src/ingestion/pipelines/lever.ts:46`, `src/ingestion/pipelines/greenhouse.ts:46`).
- `query_state`:
- Used only by `src/orchestration/runner.ts` (`markQueryRunning`, `markQuerySuccess`, `markQueryError`).
- Not used by ATS pipelines/runners.
- `run_lock`:
- Used by `runOnce()` (`src/orchestration/runner.ts:350`) and ATS orchestrator (`src/orchestration/ats/atsOrchestrator.ts:65`).
- `client_pause`:
- InfoJobs runner sets pauses on RATE_LIMIT (`src/orchestration/runner.ts:144`).
- ATS runners only read pause state (`src/orchestration/ats/leverRunner.ts:45`, `src/orchestration/ats/greenhouseRunner.ts:45`).

### 6.3 Effective Resumability
- Implemented:
- Retry loop per query in runner (`src/orchestration/runner.ts:173`).
- Persistent pause state with expiry cleanup (`src/db/repos/clientPauseRepo.ts:86`).
- Run lock with TTL (`src/constants/runLock.ts:17`).
- Not implemented in runtime behavior:
- Mid-query/tenant resume checkpoints.
- Replay cursor logic based on `query_state.last_processed_date`.
- Lock heartbeat usage (`refreshRunLock` is not used by runtime orchestration).

### 6.4 Dead/Unused State Abstractions and Fields
- Functions unused by runtime orchestration (test-only usage):
- `refreshRunLock` (`src/db/repos/runLockRepo.ts:82`)
- `getRunLock` (`src/db/repos/runLockRepo.ts:137`)
- `setQueryStatus` (`src/db/repos/queryStateRepo.ts:321`)
- `resetConsecutiveFailures` (`src/db/repos/queryStateRepo.ts:301`)
- Persisted fields present but not actively populated by live ingestion code paths:
- `ingestion_runs.requests_count`, `ingestion_runs.http_429_count`, `ingestion_runs.notes` (no runtime writer in `src/`).
- `query_state.last_processed_date` is schema-supported but not passed by runner call sites (`markQuerySuccess(queryKey)` at `src/orchestration/runner.ts:193`).

### 6.5 Overlapping Concepts (Runs vs Query State)
- `ingestion_runs` = append-only execution history + counters (`provider`, optional `query_fingerprint`).
- `query_state` = latest per-query operational state (`status`, failures, timestamps).
- Link is soft by `queryKey` string in `query_fingerprint`; no FK/transactional coupling.
- ATS runs generally have `query_fingerprint = NULL` and no corresponding `query_state` rows.

## 7. Orphaned / Dead / Unreachable Code

| Path | Symbol/Area | Why Orphaned/Unreachable | Evidence |
|---|---|---|---|
| `src/orchestration/ats/atsOrchestrator.ts:47` | `runAtsOrchestratorOnce` | No caller in production entrypoints or tests | `rg -n "runAtsOrchestratorOnce" src tests` returns definition only |
| `src/orchestration/ats/leverRunner.ts:37` | `runLeverRunnerOnce` | Reachable only through ATS orchestrator, which has no caller | references only inside ATS subtree |
| `src/orchestration/ats/greenhouseRunner.ts:37` | `runGreenhouseRunnerOnce` | Same isolation as Lever runner | references only inside ATS subtree |
| `src/orchestration/ats/index.ts:1` | ATS barrel | Not imported by runtime code | no `@/orchestration/ats` imports in `src/` |
| `src/companySources/ingestDirectorySources.ts:49` | Directory ingestion entry | Not wired into production runtime | imports found in tests, none in entrypoint/orchestration files |
| `src/atsDiscovery/runAtsDiscoveryBatch.ts:37` | Discovery batch | Called only by ATS orchestrator + tests; no production caller path | no entrypoint import chain |
| `src/ingestion/pipelines/lever.ts:28` | Lever pipeline | Called by ATS runner + tests only; ATS runner subtree not entrypoint-wired | no usage in `src/main.ts` or `src/runnerMain.ts` |
| `src/ingestion/pipelines/greenhouse.ts:28` | Greenhouse pipeline | Same as Lever pipeline | same evidence pattern |
| `src/sheets/exportPlanner.ts:29` | `buildExportPlan` | Exported but not called in `src/` runtime or tests | `rg -n "buildExportPlan" src tests` returns definition only |
| `src/constants/runner.ts:63` | `ATS_PROVIDER_EXECUTION_ORDER` | Declared but not consumed by orchestrators | only declaration match in `src/` |

### 7.1 Duplicate / Parallel Orchestration Logic Present
- Lock lifecycle duplicated in two orchestration roots:
- `src/orchestration/runner.ts` and `src/orchestration/ats/atsOrchestrator.ts` each implement ownerId generation + acquire/release lock flow.
- Provider runner wrappers duplicated by structure:
- `src/orchestration/ats/leverRunner.ts` and `src/orchestration/ats/greenhouseRunner.ts` are near-symmetric adapters around provider pipelines.
- Directory extraction logic duplicated in two styles:
- Catalonia performs local listing extraction loop (`src/companySources/catalonia/cataloniaSource.ts`), while shared extractor exists in `src/companySources/shared/listingExtraction.ts` and is used by Lanzadera.

## 8. Structural Reality Summary

### 8.1 Intended ATS Pipeline vs Actual Wiring
Intended chain: `Directory -> ATS Discovery -> ATS Ingestion -> Scoring/Metrics -> DB -> Google Sheets -> Feedback Apply`.

Actual wiring status:
- Fully wired end-to-end ATS runtime chain: **None**.
- Exists but not wired to production runtime entrypoints:
- Directory ingestion (`src/companySources/ingestDirectorySources.ts`)
- ATS discovery (`src/atsDiscovery/runAtsDiscoveryBatch.ts`)
- ATS orchestrator and ATS runners (`src/orchestration/ats/*`)
- ATS ingestion provider pipelines (`src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`)
- Partially wired:
- ATS ingestion internals (client fetch -> persistence -> scoring -> aggregation -> DB) are implemented and callable, but only from tests/manual paths.
- Sheets + feedback loop is implemented and wired only through InfoJobs batch wrapper (`runOfferBatchIngestion`), not ATS pipelines.
- Missing entirely (as runtime architecture path):
- No production entrypoint invokes the ATS sequence (directory/discovery/ATS providers).
- No ATS runtime wrapper composes ATS ingestion with Sheets sync + feedback apply.

### 8.2 Effective Current Production Entrypoint Behavior
- `src/main.ts` performs no pipeline stages.
- `src/runnerMain.ts` currently exits before query execution because `runOnce()` calls `runMigrations()` which closes DB before lock acquisition (`src/db/migrate.ts:95`), resulting in `DB_NOT_OPEN` lock failure.
- Therefore, in current runtime behavior, **none of the intended pipeline stages are executed via production entrypoints**.
