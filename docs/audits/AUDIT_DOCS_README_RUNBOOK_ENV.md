# AUDIT: README + RUNBOOK + ENV vs Current Runtime

## Scope and Evidence
This audit is based on direct code/doc inspection only.

Primary doc sources:
- `README.md`
- `docs/RUNBOOK.md`
- `.env.example`
- `docs/project-layout.md`

Primary runtime/config sources:
- `src/main.ts`
- `src/runnerMain.ts`
- `src/orchestration/runner.ts`
- `src/tasks/index.ts`
- `src/tasks/directoryIngestionTask.ts`
- `src/tasks/atsDiscoveryTask.ts`
- `src/tasks/leverIngestionTask.ts`
- `src/tasks/greenhouseIngestionTask.ts`
- `src/tasks/sheetsSyncTask.ts`
- `src/tasks/feedbackApplyTask.ts`
- `src/sheets/feedbackWindow.ts`
- `src/queries/index.ts`
- `src/queries/infojobs.ts`
- `src/clients/infojobs/infojobsClient.ts`
- `src/clients/googleSheets/googleSheetsClient.ts`
- `src/db/connection.ts`
- `src/db/repos/runLockRepo.ts`
- `src/db/repos/clientPauseRepo.ts`
- `src/constants/runner.ts`
- `src/constants/runLock.ts`
- `src/constants/sheets.ts`
- `package.json`

---

## 1) Canonical Runtime Model (Current Code)

### Entrypoints and run modes
- Canonical pipeline entrypoint is `src/runnerMain.ts` (`main()` dispatches `runOnce()` or `runForever()` from `src/orchestration/runner.ts` by `RUN_MODE`).
- `RUN_MODE` parsing in `src/runnerMain.ts`:
- `once` (default): execute one cycle then `process.exit(0|1)` based on failures count.
- `forever`: infinite loop via `runForever()` with cycle sleep jitter between `CYCLE_SLEEP_MIN_MS` and `CYCLE_SLEEP_MAX_MS` from `src/constants/runner.ts`.
- Legacy entrypoint `src/main.ts` is not the pipeline; it only instantiates `InfoJobsClient` and logs.
- npm script wiring in `package.json`:
- `dev` -> `src/main.ts` (legacy/non-pipeline path).
- `start` -> `dist/main.js` (legacy/non-pipeline path).
- No dedicated npm script exists for `dist/runnerMain.js`; docs instruct raw `node dist/runnerMain.js`.

### One full `runOnce()` cycle behavior
In `src/orchestration/runner.ts` `runOnce()`:
1. Open DB and run migrations (`openDb()`, `runMigrations()`).
2. Acquire global lock via `acquireRunLock(ownerId)`.
3. Start lock heartbeat using `refreshRunLock()` every `RUN_LOCK_REFRESH_INTERVAL_MS`.
4. Ensure `query_state` rows exist for all `ALL_QUERIES` (`ensureQueryStateRows()`).
5. Execute all tasks in `ALL_TASKS` sequentially (task order from `src/tasks/index.ts`).
6. Execute all queries in `ALL_QUERIES` sequentially (query registry in `src/queries/index.ts`).
7. Release lock and close DB in `finally` blocks.

### Current canonical task order (actual array order)
From `src/tasks/index.ts` `ALL_TASKS`:
1. `DirectoryIngestionTask` (`taskKey: directory:ingest`)
2. `AtsDiscoveryTask` (`taskKey: ats:discover`)
3. `LeverIngestionTask` (`taskKey: ats:lever:ingest`)
4. `GreenhouseIngestionTask` (`taskKey: ats:greenhouse:ingest`)
5. `SheetsSyncTask` (`taskKey: sheets:sync`)
6. `FeedbackApplyTask` (`taskKey: sheets:feedback:apply`)

### Important runtime reality
- The runtime is mixed: tasks run first, then InfoJobs queries run.
- Query phase is active because `ALL_QUERIES` is non-empty (`src/queries/infojobs.ts` defines two InfoJobs queries).
- Therefore, InfoJobs credentials are still operationally required for a successful runner cycle.

---

## 2) Current Required Env Vars (Code-Derived)

### DB / Core runtime
Must-have for execution:
- None strictly required by constructor checks for default path.

Optional with defaults:
- `DB_PATH` (default: `<cwd>/data/app.db`) from `src/db/connection.ts`.
- `LOG_LEVEL` (default: `info`) from `src/logger/logger.ts`.
- `RUN_MODE` (default: `once`) from `src/runnerMain.ts`.

### InfoJobs (currently required for successful cycle)
Required in practice due active query execution (`ALL_QUERIES` + `executeQuery()`):
- `IJ_CLIENT_ID`
- `IJ_CLIENT_SECRET`

Enforcement point:
- `InfoJobsClient` constructor throws if either missing (`src/clients/infojobs/infojobsClient.ts`).

### Google Sheets (conditional feature gate)
Gate variable:
- `GOOGLE_SHEETS_SPREADSHEET_ID`

If gate is set, these become required:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Optional with gate:
- `GOOGLE_PROJECT_ID`

Enforcement points:
- `SheetsSyncTask` and `FeedbackApplyTask` skip entirely if spreadsheet ID absent.
- `GoogleSheetsClient` throws on missing auth fields when instantiated and/or `assertAuthReady()` runs.

### Test-only / non-runtime for pipeline
- `LIVE_SHEETS_TEST` appears in `.env.example` for tests, not runner orchestration behavior.

---

## 3) Operational Behaviors (Code Truth)

### Global lock + heartbeat
- Lock name: `global` (`RUN_LOCK_NAME`).
- TTL: `3600s` (`RUN_LOCK_TTL_SECONDS`).
- Heartbeat refresh interval: `(TTL/4)` = `900000ms` (`RUN_LOCK_REFRESH_INTERVAL_MS`).
- Acquire semantics: lock takeover allowed only if expired (`acquireRunLock()` SQL `WHERE datetime('now') >= expires_at`).
- If lock acquisition fails, `runOnce()` returns `{ total: 0, success: 0, failed: 0, skipped: 0 }` (not a thrown error).

### Batches / limits / pacing
- Query retries: `MAX_RETRIES_PER_QUERY = 3`.
- Rate-limit pause duration: `CLIENT_PAUSE_DURATION_SECONDS = 21600` (6h).
- Query jitter between queries: `10s-60s`.
- Forever-mode cycle sleep: `5m-15m`.
- ATS stage limits:
- discovery: `ATS_DISCOVERY_BATCH_LIMIT = 100`
- lever: `LEVER_INGESTION_DEFAULT_LIMIT = 50`
- greenhouse: `GREENHOUSE_INGESTION_DEFAULT_LIMIT = 50`

### Sheets gating behavior
- `SheetsSyncTask`: hard-skip when `GOOGLE_SHEETS_SPREADSHEET_ID` missing.
- `FeedbackApplyTask`: hard-skip when spreadsheet ID missing.
- Feedback processing window gate is active in `processSheetsFeedback()` via `shouldRunFeedbackIngestion()`.
- Window constants: `03:00 <= hour < 06:00`, timezone `Europe/Madrid` (`src/constants/sheets.ts`, `src/sheets/feedbackWindow.ts`).

### Failure semantics
- Task failures are logged and do not abort cycle; loop continues to next task.
- Query failures are retried/classified (`RATE_LIMIT`, `TRANSIENT`, `FATAL`) and then continue to next query.
- `runnerMain` exits code `1` in once mode when aggregate `failed > 0` (tasks and queries both contribute).

---

## 4) Mismatches and Missing Sections

### README mismatches
1. Runtime model is stale/incomplete.
- README frames runner as "run all queries once" and InfoJobs-centric flow.
- Code runs task pipeline first, then query pipeline.

2. Entrypoint conflict not resolved clearly.
- README says `src/main.ts` is legacy, but npm `dev` and `start` still use legacy entrypoint.
- Canonical runtime should be explicitly `runnerMain` path and script guidance should match this.

3. Project structure section is inaccurate.
- Mentions future folders (`config/`, `core/`, `exporters/`) that are not current runtime shape.
- Missing current key modules: `tasks/`, `orchestration/`, `atsDiscovery/`, `companySources/`, `sheets/`.

4. Missing mixed-runtime warning.
- README does not state that InfoJobs queries still run after tasks, making IJ credentials practically required even with ATS path present.

### RUNBOOK mismatches
1. System overview is InfoJobs-only narrative.
- RUNBOOK describes query-centric runner and omits the active 6-task pipeline stages and order.

2. "Per-query" wording is no longer complete.
- Failures/summaries now include task outcomes too.
- `failed` and `skipped` counters in run summary are mixed task+query counts.

3. Client pause description is overly broad.
- Pause logic exists in query path; tasks do not use this pause state for control flow.
- Wording should scope pause behavior to query clients (currently InfoJobs).

4. Missing operations section for task-stage troubleshooting.
- No runbook diagnostics for directory ingestion, ATS discovery, lever ingestion, greenhouse ingestion, sheets sync, feedback apply as separate stages.

### `.env.example` mismatches
1. Mostly aligned with current code.
- Core vars and Sheets conditional vars match constructor checks.

2. Missing explicit note about current mixed runtime.
- It does not state that IJ creds are still required for successful full cycle because InfoJobs query phase remains active after tasks.

3. Test flag documentation gap.
- `LIVE_SHEETS_TEST` exists in `.env.example` but runtime docs do not clearly label it as test-only/non-runner.

---

## 5) Ordered Patch Plan (for D2/D3)

### D2: `.env.example` edits (exact intent)
1. Keep existing vars unchanged in name/value shape.
2. Add comment near `IJ_CLIENT_ID` / `IJ_CLIENT_SECRET`:
- "Required for current runner because InfoJobs queries still execute after task pipeline."
3. Add comment near `LIVE_SHEETS_TEST`:
- "Test-only; not used by `runnerMain` runtime flow."
4. Keep Sheets conditional comments; they are already consistent with code.

### D3: README edits
1. Replace runtime section with canonical model:
- `runnerMain` is primary runtime entrypoint.
- `RUN_MODE=once|forever` behavior.
- Explain mixed execution order: 6 tasks then InfoJobs queries.

2. Add explicit task pipeline order section referencing `src/tasks/index.ts`.

3. Add env section split:
- required-in-practice now (IJ creds)
- optional defaults (DB_PATH, LOG_LEVEL, RUN_MODE)
- conditional Sheets bundle
- test-only flags

4. Correct project structure snapshot to current directories only.

5. Clarify legacy `main.ts`:
- Keep as legacy/dev bootstrap only; not canonical ingestion runtime.

6. Add a short "current transitional architecture" note:
- query registry is still active alongside task pipeline.

### D3: RUNBOOK edits
1. Update Overview to full pipeline reality:
- sequential stages + query tail.

2. Add run-cycle section:
- lock acquire, heartbeat, stage sequence, query sequence, release.

3. Update observability queries and interpretation:
- distinguish task failures (log-only visibility) vs query_state-backed failures.

4. Add troubleshooting by stage:
- directory ingest
- ATS discovery
- Lever ingestion
- Greenhouse ingestion
- Sheets sync
- feedback apply/window skip

5. Scope client pause section to query path behavior.

6. Add safe-ops note:
- lock contention may return zero-work successful run in once mode (no failure exit by itself).

---

## 6) Short Technical Summary
Current runtime truth is a transitional mixed orchestrator: `runnerMain -> runOnce/runForever` executes a 6-stage task pipeline and then executes InfoJobs queries. Locking, heartbeat, retry, pause, and feedback-window controls are implemented in code and mostly stable; docs are behind primarily on runtime model (tasks + queries), entrypoint clarity, and operator guidance by stage. `.env.example` is largely correct but needs clarifying comments for IJ practical requirement and test-only flags.
