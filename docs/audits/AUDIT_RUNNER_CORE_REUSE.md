# AUDIT_RUNNER_CORE_REUSE

Scope: runner/orchestration core reuse audit for conversion to one canonical task-based runtime engine.
Method: static call-graph inspection + targeted runtime probes (`runOnce`, `runAtsOrchestratorOnce`) without code changes.

## 1) Runner Core Inventory (What it does today)

### 1.1 Public exports (`src/orchestration/runner.ts`)
- `runOnce()` (`src/orchestration/runner.ts:331`): single-cycle orchestrator over `ALL_QUERIES`.
- `runForever()` (`src/orchestration/runner.ts:461`): infinite loop around `runOnce()` with cycle sleep + signal shutdown.

### 1.2 Internal helpers and control-flow blocks
- Error classification/persistence helpers:
  - `classifyError` (`src/orchestration/runner.ts:64`)
  - `getErrorCode` (`src/orchestration/runner.ts:107`)
  - `getErrorMessage` (`src/orchestration/runner.ts:117`)
- Timing helpers:
  - `sleepJitter` (`src/orchestration/runner.ts:128`)
- Pause helper:
  - `pauseClient` (`src/orchestration/runner.ts:142`) -> `setClientPause` (`src/db/repos/clientPauseRepo.ts:35`)
- Query executor:
  - `executeQuery` (`src/orchestration/runner.ts:158`)
- Query-state bootstrap:
  - `ensureQueryStateRows` (`src/orchestration/runner.ts:296`)

### 1.3 Function-level execution graph

```
runnerMain.main()                                   (src/runnerMain.ts:31)
  -> runOnce() | runForever()                       (src/runnerMain.ts:37,42)

runForever()                                        (src/orchestration/runner.ts:461)
  -> loop:
     -> runOnce()                                   (src/orchestration/runner.ts:489)
     -> sleep random cycle interval                 (src/orchestration/runner.ts:519-527)

runOnce()                                           (src/orchestration/runner.ts:331)
  -> openDb()                                       (src/orchestration/runner.ts:342)
  -> runMigrations()                                (src/orchestration/runner.ts:343)
     -> openDb()                                    (src/db/migrate.ts:74)
     -> closeDb()                                   (src/db/migrate.ts:96)
  -> acquireRunLock(ownerId)                        (src/orchestration/runner.ts:350)
  -> if lock acquired:
     -> ensureQueryStateRows()                      (src/orchestration/runner.ts:363)
        -> getQueryState/upsertQueryState           (src/orchestration/runner.ts:302-309)
     -> for query in ALL_QUERIES order              (src/orchestration/runner.ts:370-371)
        -> isClientPaused(query.client)             (src/orchestration/runner.ts:374)
        -> executeQuery(query)                      (src/orchestration/runner.ts:389)
           -> markQueryRunning                       (src/orchestration/runner.ts:168)
           -> retry loop (MAX_RETRIES_PER_QUERY)    (src/orchestration/runner.ts:173)
           -> if query.client === "infojobs":
              -> new InfoJobsClient()               (src/orchestration/runner.ts:179)
              -> runInfojobsPipeline(...)           (src/orchestration/runner.ts:180)
                 -> runOfferBatchIngestion(...)     (src/ingestion/pipelines/infojobs.ts:67)
                    -> withRun(...)                 (src/ingestion/runOfferBatch.ts:55)
                       -> createRun                 (src/ingestion/runLifecycle.ts:109,30)
                       -> ingestOffers              (src/ingestion/runOfferBatch.ts:68)
                       -> aggregateCompanies...     (src/ingestion/runOfferBatch.ts:76)
                       -> optional Sheets sync      (src/ingestion/runOfferBatch.ts:84-127)
                       -> optional feedback apply   (src/ingestion/runOfferBatch.ts:129-218)
                       -> finishRun                 (src/ingestion/runLifecycle.ts:119)
           -> else throw Unsupported client         (src/orchestration/runner.ts:188-190)
           -> markQuerySuccess/markQueryError       (src/orchestration/runner.ts:193,262)
           -> getLatestRunByQueryKey (logging)      (src/orchestration/runner.ts:197,269)
           -> RATE_LIMIT => setClientPause          (src/orchestration/runner.ts:242-244)
        -> per-query jitter sleep                   (src/orchestration/runner.ts:397-399)
     -> listClientPauses + listQueryStates summary  (src/orchestration/runner.ts:404-432)
  -> releaseRunLock(ownerId)                        (src/orchestration/runner.ts:443)
```

### 1.4 Runtime probe result (current behavior)
- Probe command executed:
  - `npx ts-node -r tsconfig-paths/register -e "import { runOnce } from './src/orchestration/runner'; ..."`
- Observed output:
  - `Failed to acquire run lock ... {"reason":"DB_NOT_OPEN"}`
  - Returned `{ total: 0, success: 0, failed: 0, skipped: 0 }`
- Evidence chain for failure:
  - `runOnce` calls `openDb()` then `runMigrations()` (`src/orchestration/runner.ts:342-343`)
  - `runMigrations()` unconditionally `closeDb()` in `finally` (`src/db/migrate.ts:95-97`)
  - `acquireRunLock()` depends on `getDb()` and returns `DB_NOT_OPEN` on not-open error (`src/db/repos/runLockRepo.ts:24-27,64-66`)

### 1.5 Responsibilities currently handled by `runner.ts`
- DB init attempt + migration invocation
- Global lock acquire/release
- Query-state bootstrap/update
- Sequential query dispatch
- Per-query retry/backoff/error classification
- Provider pause enforcement and pause writes
- Run telemetry pull (latest run by query key) for logs
- Cycle-level summary + continuous loop mode

## 2) Coupling & Leakage Analysis (What makes it query-based)

### 2.1 Coupling classification matrix

| Coupling | Evidence | Classification |
|---|---|---|
| Registry is `ALL_QUERIES` and query-typed | `src/orchestration/runner.ts:24`, `src/queries/index.ts:14` | ADAPT (Engine concern expressed in query shape) |
| Query identity is `query.queryKey` everywhere | `src/orchestration/runner.ts:162,168,193,262`; `src/types/queries/registry.ts:16-27` | ADAPT |
| Query-state table semantics (`query_state`) embedded in engine loop | `src/orchestration/runner.ts:27-33,296-316,405-430` | ADAPT |
| Provider execution hardcoded to InfoJobs branch | `src/orchestration/runner.ts:178-190` | REMOVE (Legacy coupling) |
| Direct InfoJobs client construction in engine | `src/orchestration/runner.ts:43,179` | REMOVE |
| Unsupported non-InfoJobs providers throw from engine | `src/orchestration/runner.ts:188-190` | REMOVE |
| Query ordering comes from array order in registry | `src/orchestration/runner.ts:370-371`; `src/queries/index.ts:14` | ADAPT |
| Retry/jitter/pause semantics independent of provider internals | `src/orchestration/runner.ts:173-257,397-399`; `src/constants/runner.ts:11-39` | KEEP (Engine concern) |
| Global lock semantics independent of query/provider | `src/orchestration/runner.ts:350,443`; `src/db/repos/runLockRepo.ts:24-70,112-129` | KEEP |
| Runner reads latest run only by query key for logging | `src/orchestration/runner.ts:197,269`; `src/db/repos/runsRepo.ts:109-123` | ADAPT |

### 2.2 Where `query_state` is read/written and why
- Read:
  - `getQueryState(queryKey)` during bootstrap to decide insert (`src/orchestration/runner.ts:302`)
  - `listQueryStates()` for cycle summary/top failures (`src/orchestration/runner.ts:405-430`)
- Write:
  - `upsertQueryState` for missing rows (`src/orchestration/runner.ts:304-309`)
  - `markQueryRunning` pre-execution (`src/orchestration/runner.ts:168`)
  - `markQuerySuccess` on success (`src/orchestration/runner.ts:193`)
  - `markQueryError` on terminal failure (`src/orchestration/runner.ts:262-265`)
- Not used for scheduling decisions:
  - No filter by `status`, `consecutive_failures`, or `last_*` before selection; iteration is always full `ALL_QUERIES` (`src/orchestration/runner.ts:370-400`).

### 2.3 Where `ingestion_runs` is read/written and why
- Written (indirectly):
  - `runInfojobsPipeline` -> `runOfferBatchIngestion` -> `withRun` -> `createRun`/`finishRun` (`src/ingestion/pipelines/infojobs.ts:67`; `src/ingestion/runOfferBatch.ts:55`; `src/ingestion/runLifecycle.ts:109,119`; `src/db/repos/runsRepo.ts:18,36`)
- Read by runner:
  - `getLatestRunByQueryKey` for post-query logging only (`src/orchestration/runner.ts:197,269`)
- Engine does not use run rows for scheduling/retry selection/resume control.

## 3) Reuse Candidate Catalog

### 3.1 KEEP (engine-grade, provider-agnostic)
- `src/db/repos/runLockRepo.ts`
  - `acquireRunLock`, `releaseRunLock`, `refreshRunLock` semantics are engine-level lock primitives (`src/db/repos/runLockRepo.ts:24,112,82`).
- `src/db/repos/clientPauseRepo.ts`
  - Persistent pause state (`get/set/is/list/clear`) is engine-level pause control (`src/db/repos/clientPauseRepo.ts:17,35,61,71,86`).
- Retry/sleep scaffolding in runner
  - Retry loop and transient/fatal/rate-limit branching (`src/orchestration/runner.ts:173-257`)
  - Jitter helpers (`src/orchestration/runner.ts:128-132`) and cycle sleep (`src/orchestration/runner.ts:519-527`).
- Structured summary logging block
  - Cycle metrics + top failures + paused clients (`src/orchestration/runner.ts:411-432`).

### 3.2 ADAPT (engine-grade but query-shaped)

| Current symbol(s) | Why query-shaped | Generalized shape (high-level) |
|---|---|---|
| `ALL_QUERIES`, `RegisteredQuery` (`src/queries/index.ts:14`; `src/types/queries/registry.ts:16-27`) | Selection unit is query, not generic task | Task registry of ordered task descriptors |
| `query.queryKey` usages (`src/orchestration/runner.ts:162,168,193,262`) | Identity model bound to query key hash | Stable task key identity |
| `query_state` repo + types (`src/db/repos/queryStateRepo.ts`; `src/types/queryState.ts`) | Field names and semantics are query-centric (`query_key`, `last_processed_date`) | Mutable task-state with task-oriented checkpoint/status fields |
| `getLatestRunByQueryKey` + `query_fingerprint` (`src/db/repos/runsRepo.ts:109-123`; `src/types/db.ts:184`) | Run linkage keyed by query nomenclature | Run linkage keyed by task identity |
| `runLifecycle` parameter `queryKey` (`src/ingestion/runLifecycle.ts:22,28,100,107`) | Lifecycle API still query-terminology | Lifecycle keyed by task context |

### 3.3 REMOVE (dead/duplicate/InfoJobs-only)

| Item | Evidence | Classification reason |
|---|---|---|
| InfoJobs dispatch inside engine (`executeQuery` branch) | `src/orchestration/runner.ts:178-190` | Provider-specific logic inside generic orchestrator core |
| Direct `InfoJobsClient` instantiation in engine | `src/orchestration/runner.ts:43,179` | Legacy provider coupling in runner core |
| `runAtsOrchestratorOnce` as separate orchestration engine | Definition-only in source graph: `src/orchestration/ats/atsOrchestrator.ts:47`; no callers in `src`/`tests` (`rg -n "runAtsOrchestratorOnce" src tests`) | Duplicate orchestration surface if one canonical engine owns sequencing |
| `runLeverRunnerOnce` and `runGreenhouseRunnerOnce` wrappers (as runner layer) | Only consumed by `atsOrchestrator` (`src/orchestration/ats/atsOrchestrator.ts:18-19,92,101`) | Redundant orchestration wrapper layer above pipelines |
| `ATS_PROVIDER_EXECUTION_ORDER` constant | Declared `src/constants/runner.ts:63`; no references in `src`/`tests` | Dead orchestration config artifact |
| `setQueryStatus`, `resetConsecutiveFailures` | Exported in `src/db/repos/queryStateRepo.ts:301,321`; no references in `src`/`tests` | Unused state mutation surface |

## 4) State Tables & Fit-for-Purpose

### 4.1 Active usage by `runner.ts` today

#### Static call-graph usage (if lock path succeeds)
- `runLockRepo`: acquire/release (`src/orchestration/runner.ts:350,443`)
- `queryStateRepo`: get/upsert/mark/list (`src/orchestration/runner.ts:302-309,168,193,262,405`)
- `clientPauseRepo`: is/get/set/list (`src/orchestration/runner.ts:374-375,144,404`)
- `runsRepo`: latest run lookup (`src/orchestration/runner.ts:197,269`)

#### Observed runtime usage now
- `runOnce` currently exits before query loop on `DB_NOT_OPEN` lock failure (probe output), so downstream query-state/run-state updates are not reached.

### 4.2 Scaffolding/unused repo surfaces
- `runLockRepo.refreshRunLock` and `runLockRepo.getRunLock` have no runtime callers in `src`; only DB smoke tests call them (`tests/integration/db/m7_run_lock_smoke.test.ts:43,52,60,68,76,85`).
- `queryStateRepo.setQueryStatus` and `resetConsecutiveFailures` have no callers in `src` or `tests` (definition-only).
- No direct tests for orchestration modules (`rg -n "orchestration/runner|atsOrchestrator|leverRunner|greenhouseRunner" tests` -> no matches).

### 4.3 Fields never populated by live code (runtime src path)

#### `query_state`
- `last_processed_date` exists in schema (`migrations/0007_add_query_state.sql:12`) and write API (`src/db/repos/queryStateRepo.ts:221,235`), but runner calls `markQuerySuccess(queryKey)` without `lastProcessedDate` (`src/orchestration/runner.ts:193`).
- Result: field remains null in live runner path unless set externally/tests.

#### `ingestion_runs`
Schema fields: `requests_count`, `http_429_count`, `notes` (`migrations/0001_init.sql:62-65`) plus `companies_aggregated`, `companies_failed` (`migrations/0005_add_run_aggregation_counters.sql:4-5`).

Live write path:
- `withRun` finalization calls lifecycle `finishRun(runId, status, acc.counters)` (`src/ingestion/runLifecycle.ts:119`).
- Lifecycle `finishRun` only forwards `pages_fetched`, `offers_fetched`, `errors_count` (`src/ingestion/runLifecycle.ts:51-59`).

Consequences:
- `requests_count`, `http_429_count`, `notes`, `companies_aggregated`, `companies_failed` are never persisted by live pipeline finalization.
- Even though pipelines set counters like `companies_aggregated` in-memory (`src/ingestion/pipelines/lever.ts:145-146`, `src/ingestion/pipelines/greenhouse.ts:145-146`, `src/ingestion/runOfferBatch.ts:81-82`), those fields are dropped before DB write.
- `pages_fetched`/`errors_count` are initialized to 0 (`src/ingestion/runLifecycle.ts:71-74`) and never incremented in live ingestion code (`rg` shows no `acc.counters.pages_fetched` / `acc.counters.errors_count` mutations).
- `offers_fetched` is set in InfoJobs batch path (`src/ingestion/runOfferBatch.ts:62`) but not in Lever/Greenhouse pipelines; ATS runs keep default 0.
- `query_fingerprint` is null for ATS pipelines because `withRun` is called without 4th `queryKey` arg (`src/ingestion/pipelines/lever.ts:46`, `src/ingestion/pipelines/greenhouse.ts:46`; `withRun` signature `src/ingestion/runLifecycle.ts:103-108`).

### 4.4 Overlap between `query_state` and `ingestion_runs`
- Status duplication:
  - `query_state.status` (`migrations/0007_add_query_state.sql:8`) vs `ingestion_runs.status` (`migrations/0001_init.sql:59`)
- Timestamp duplication:
  - `query_state.last_run_at/last_success_at/last_error_at` (`migrations/0007_add_query_state.sql:9-11`) vs `ingestion_runs.started_at/finished_at` (`migrations/0001_init.sql:57-58`)
- Error tracking duplication:
  - `query_state.error_code/error_message/consecutive_failures` (`migrations/0007_add_query_state.sql:13-15`) vs `ingestion_runs.errors_count` (`migrations/0001_init.sql:64`)
- Identity linkage mismatch:
  - `query_state.query_key` vs `ingestion_runs.query_fingerprint`; ATS runs often have null `query_fingerprint`.

### 4.5 Recommended direction (structural, no implementation)
- Direction: keep dual-state model but reinterpret roles:
  - mutable scheduler state (`query_state` semantics -> task state) for execution control,
  - immutable run history (`ingestion_runs`) for audit trail.
- Rationale from observed usage:
  - `ingestion_runs` alone does not encode scheduler control state (pause/failure streak/checkpoint intent).
  - current `query_state` already encodes execution control concepts; naming/identity is query-coupled.
- Minimum state surface required by canonical engine:
  - Global lock state (`run_lock`)
  - Provider/task pause state (`client_pause`)
  - Mutable per-task execution state (status, last success/error, failure streak, checkpoint)
  - Immutable per-run records (start/end/status/counters/task key)

## 5) Duplication with ATS Subtree

Files inspected:
- `src/orchestration/ats/atsOrchestrator.ts`
- `src/orchestration/ats/leverRunner.ts`
- `src/orchestration/ats/greenhouseRunner.ts`

### 5.1 Duplication map

| ATS symbol | Duplicates core symbol | Evidence |
|---|---|---|
| `runAtsOrchestratorOnce` lock acquire/release | `runOnce` lock acquire/release | ATS: `src/orchestration/ats/atsOrchestrator.ts:65,129`; Core: `src/orchestration/runner.ts:350,443` |
| `runLeverRunnerOnce` pause gate | `runOnce` per-query pause gate | ATS: `src/orchestration/ats/leverRunner.ts:45-59`; Core: `src/orchestration/runner.ts:374-386` |
| `runGreenhouseRunnerOnce` pause gate | `runOnce` per-query pause gate | ATS: `src/orchestration/ats/greenhouseRunner.ts:45-59`; Core: `src/orchestration/runner.ts:374-386` |
| ATS result status envelope (`DONE/PAUSED/ERROR`) | Runner counters/status accounting (`success/failed/skipped`) | ATS: `src/orchestration/ats/leverRunner.ts:92-113`, `src/orchestration/ats/greenhouseRunner.ts:92-113`; Core: `src/orchestration/runner.ts:365-439` |
| `runLeverRunnerOnce` and `runGreenhouseRunnerOnce` | Each other (same wrapper pattern) | Same structure: pause check -> pipeline call -> map counters -> DONE/ERROR return |

### 5.2 Infra differences (not duplicated, but divergent)
- Runner core has retry/backoff logic; ATS subtree has none.
  - Core: `src/orchestration/runner.ts:173-257`
  - ATS runners: one-shot pipeline call, catch -> `ERROR` (`src/orchestration/ats/leverRunner.ts:61-113`, `src/orchestration/ats/greenhouseRunner.ts:61-113`)
- Runner core attempts DB init/migrations; ATS orchestrator does not open DB.
  - Core: `src/orchestration/runner.ts:342-343`
  - ATS: immediate lock attempt (`src/orchestration/ats/atsOrchestrator.ts:65`) -> returns on `DB_NOT_OPEN`.

### 5.3 Unique value currently provided by ATS subtree
- Explicit bounded ATS sequence composition:
  - discovery -> lever -> greenhouse (`src/orchestration/ats/atsOrchestrator.ts:77-108`)
- Provider-specific output normalization into `AtsRunnerResult` wrappers.

### 5.4 Runtime reachability of ATS subtree
- `runAtsOrchestratorOnce` has no callers in `src` or `tests` (definition-only reference search).
- Runtime probe (`npx ts-node ... runAtsOrchestratorOnce`) produced immediate lock failure `reason:"DB_NOT_OPEN"` due missing DB init path.

### 5.5 Structural classification for canonical single-engine target
- `atsOrchestrator` layer: REMOVE (duplicate orchestrator layer).
- `leverRunner`/`greenhouseRunner` wrapper layer: REDUCE to task-level execution units (retain pipeline-level behavior, remove parallel orchestration shell role).

## 6) Structural Reality Summary (Decision-Ready)

### 6.1 Runner engine blocks
- KEEP
  - lock repo primitives (`acquire/release/refresh`)
  - pause repo primitives
  - retry/jitter/sleep scaffolding
  - cycle summary/log aggregation block
- ADAPT
  - query registry coupling (`ALL_QUERIES` -> task registry)
  - query identity (`queryKey` -> task key)
  - query state model (`query_state` -> task-state semantics)
  - run linkage (`query_fingerprint`/`getLatestRunByQueryKey` -> task linkage)
- REMOVE
  - InfoJobs-specific dispatch branch in engine
  - separate ATS orchestration shell (`atsOrchestrator` + provider runner wrappers as orchestration layer)
  - dead symbols (`ATS_PROVIDER_EXECUTION_ORDER`, unused query-state mutators)

### 6.2 State layer keep vs deprecate
- Keep
  - `run_lock` table/repo
  - `client_pause` table/repo
  - `ingestion_runs` as immutable run history surface
  - mutable per-unit execution state surface (currently `query_state` shape)
- Deprecate/retire (naming + semantics level)
  - query-specific naming in state linkage (`query_key`, `query_fingerprint`) for engine core
  - unused state mutation APIs with no runtime callers (`setQueryStatus`, `resetConsecutiveFailures`) unless explicit operational need is defined

### 6.3 ATS subtree keep vs delete
- Keep
  - provider pipelines (`runLeverPipeline`, `runGreenhousePipeline`, discovery batch) as executable task modules
- Delete/retire as runtime layer
  - `runAtsOrchestratorOnce` orchestration shell
  - `runLeverRunnerOnce`/`runGreenhouseRunnerOnce` orchestration wrappers

### 6.4 Top 3 architecture risks (evidence-grounded)
1. Runner no-op risk due DB lifecycle ordering
- Evidence: `runOnce` calls `openDb` then `runMigrations`; `runMigrations` closes DB; subsequent lock acquisition returns `DB_NOT_OPEN` (`src/orchestration/runner.ts:342-350`, `src/db/migrate.ts:73-97`, runtime probe output).

2. Engine-core/provider coupling risk
- Evidence: engine dispatch only supports `infojobs` and throws for others (`src/orchestration/runner.ts:178-190`), while ATS providers are orchestrated in separate disconnected subtree.

3. State truth-fragmentation risk
- Evidence: mutable `query_state` and immutable `ingestion_runs` overlap on status/timestamps; run counters columns exist but many are never written by live finalization path (`src/ingestion/runLifecycle.ts:48-60`, `migrations/0001_init.sql:62-65`, `migrations/0005_add_run_aggregation_counters.sql:4-5`).
