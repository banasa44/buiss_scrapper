# AUDIT A4 — Dead Code, Duplications, Inconsistencies

Date: 2026-02-11  
Scope: read-only hygiene audit across `src/**` and `tests/**`  
Pre-step completed: re-opened `docs/project-layout.md` and used it as the audit baseline.

## 1) Dead code candidates

### 1.1 `src/orchestration/ats/index.ts` (unused barrel)
- File: `src/orchestration/ats/index.ts:1-7`
- Evidence (search): no imports found.
```bash
rg -n "from \"@/orchestration/ats\"|from \"@/orchestration/ats/\"" src tests
# (no output)
```

### 1.2 `runAtsOrchestratorOnce` has no caller
- File: `src/orchestration/ats/atsOrchestrator.ts:47`
- Evidence (search): symbol appears only in its defining file.
```bash
rg -n "runAtsOrchestratorOnce" src tests
src/orchestration/ats/atsOrchestrator.ts:47:export async function runAtsOrchestratorOnce(
```

### 1.3 ATS runner modules are only referenced from the unused orchestrator
- Files:
  - `src/orchestration/ats/leverRunner.ts`
  - `src/orchestration/ats/greenhouseRunner.ts`
- Evidence (search): references are definition + calls inside `atsOrchestrator`.
```bash
rg -n "runLeverRunnerOnce|runGreenhouseRunnerOnce" src tests
src/orchestration/ats/greenhouseRunner.ts:37:export async function runGreenhouseRunnerOnce(
src/orchestration/ats/leverRunner.ts:37:export async function runLeverRunnerOnce(
src/orchestration/ats/atsOrchestrator.ts:18:import { runLeverRunnerOnce } from "./leverRunner";
src/orchestration/ats/atsOrchestrator.ts:19:import { runGreenhouseRunnerOnce } from "./greenhouseRunner";
src/orchestration/ats/atsOrchestrator.ts:92:    const leverResult = await runLeverRunnerOnce({ limit: leverLimit });
src/orchestration/ats/atsOrchestrator.ts:101:    const greenhouseResult = await runGreenhouseRunnerOnce({
```

### 1.4 `src/companySources/index.ts` is not imported by runtime code
- File: `src/companySources/index.ts:16-19`
- Evidence (search): no imports in `src/**`; imports exist only in tests.
```bash
rg -n "from \"@/companySources\"|from \"@/companySources/\"" src
# (no output)

rg -n "from \"@/companySources\"|from \"@/companySources/\"" tests
tests/integration/live/flows/directory_to_ats.live.test.ts:21:import { ingestDirectorySources } from "@/companySources";
tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts:21:import { ingestDirectorySources } from "@/companySources";
tests/integration/flows/directory_to_ats.offline.test.ts:2:import { ingestDirectorySources } from "@/companySources";
...
```

### 1.5 ATS discovery batch path is runtime-unreachable from current entrypoints
- Files:
  - `src/atsDiscovery/runAtsDiscoveryBatch.ts:37`
  - `src/orchestration/ats/atsOrchestrator.ts:17,79`
- Evidence (search): `runAtsDiscoveryBatch` is imported in `src` only by ATS orchestrator; entrypoints do not reference ATS modules.
```bash
rg -n "runAtsDiscoveryBatch" src
src/atsDiscovery/index.ts:11:export * from "./runAtsDiscoveryBatch";
src/atsDiscovery/runAtsDiscoveryBatch.ts:37:export async function runAtsDiscoveryBatch(options?: {
src/orchestration/ats/atsOrchestrator.ts:17:import { runAtsDiscoveryBatch } from "@/atsDiscovery";
src/orchestration/ats/atsOrchestrator.ts:79:    const discoveryResult = await runAtsDiscoveryBatch({

rg -n "companySources|atsDiscovery|orchestration/ats|runLeverPipeline|runGreenhousePipeline|runAtsOrchestratorOnce|ingestDirectorySources|runAtsDiscoveryBatch" src/main.ts src/runnerMain.ts src/orchestration/runner.ts
# (no output)
```

### 1.6 `src/ingestion/pipelines/index.ts` ATS exports are test-only consumers today
- File: `src/ingestion/pipelines/index.ts:5-7`
- Evidence (search): no `src/**` imports of `@/ingestion/pipelines` barrel.
```bash
rg -n "from \"@/ingestion/pipelines\"" src
# (no output)

rg -n "from \"@/ingestion/pipelines\"" tests
tests/integration/flows/directory_to_ats.offline.test.ts:9:import { runLeverPipeline, runGreenhousePipeline } from "@/ingestion/pipelines";
tests/integration/live/flows/directory_to_ats.live.test.ts:23:import { runLeverPipeline } from "@/ingestion/pipelines";
tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts:23:import { runGreenhousePipeline } from "@/ingestion/pipelines";
```

## 2) Duplications

### 2.1 Two orchestrators with overlapping responsibilities
- `src/orchestration/runner.ts:331-449` and `src/orchestration/ats/atsOrchestrator.ts:60-131` both:
  - acquire/release run lock
  - perform sequential orchestration
  - emit run summaries

### 2.2 Duplicate provider-list concept in two constants
- `src/constants/atsDiscovery.ts:11` -> `ATS_PROVIDERS = ["lever","greenhouse"]`
- `src/constants/runner.ts:63` -> `ATS_PROVIDER_EXECUTION_ORDER = ["lever","greenhouse"]`
- Same conceptual set appears in two places.

### 2.3 Near-duplicate ATS pipeline implementations
- `src/ingestion/pipelines/lever.ts` and `src/ingestion/pipelines/greenhouse.ts` share nearly identical control flow and counters.
- Evidence:
```bash
rg -n "sourcesChecked|persistedOffersTotal|skippedOffersTotal|failedOffersTotal|affectedCompanyIds|listCompanySourcesByProvider\\(" src/ingestion/pipelines/lever.ts src/ingestion/pipelines/greenhouse.ts
# same counter names and same orchestration shape in both files
```

### 2.4 Duplicate run-result wrapper types
- `src/types/ingestion.ts:111-115` (`RunOfferBatchResult`)
- `src/types/ingestion.ts:144-150` (`RunInfojobsPipelineResult`)
- Both carry `runId + counters + IngestOffersResult` (field name differs: `result` vs `ingestResult`).

### 2.5 Repeated identical options types for ATS runners
- `src/orchestration/ats/leverRunner.ts:17-20` and `src/orchestration/ats/greenhouseRunner.ts:17-20` both define a single `limit: number` option type.

## 3) Inconsistencies

### 3.1 Entrypoint policy vs runtime behavior
- Policy says entrypoint is `src/main.ts` (`docs/project-layout.md:20`).
- `package.json` runs `src/main.ts` / `dist/main.js` (`package.json:7-9`).
- But `src/main.ts` only initializes `InfoJobsClient` and ends with TODO (`src/main.ts:9-13`), while actual orchestration lives in `src/runnerMain.ts:31-76` and `src/orchestration/runner.ts:331-531`.

### 3.2 ATS orchestrator default limits conflict with runner constants
- Constants:
  - `ATS_DISCOVERY_BATCH_LIMIT=100` (`src/constants/runner.ts:45`)
  - `LEVER_INGESTION_DEFAULT_LIMIT=50` (`src/constants/runner.ts:51`)
  - `GREENHOUSE_INGESTION_DEFAULT_LIMIT=50` (`src/constants/runner.ts:57`)
- ATS orchestrator defaults all to `1` (`src/orchestration/ats/atsOrchestrator.ts:50-52`) and does not read those constants.

### 3.3 `ALLOW_EXTERNAL_DOMAINS` exists but is not implemented in logic
- Constant declared: `src/constants/atsDiscovery.ts:117`.
- Search shows no code usage:
```bash
rg -n "ALLOW_EXTERNAL_DOMAINS" src --glob '!src/constants/atsDiscovery.ts'
src/atsDiscovery/htmlLinkExtractor.ts:18: * - Same domain (unless ALLOW_EXTERNAL_DOMAINS is true)
```
- `htmlLinkExtractor` enforces `same-domain OR known ATS host` regardless of that flag (`src/atsDiscovery/htmlLinkExtractor.ts:67-75`).

### 3.4 Declared run counters vs runtime updates are out of sync
- Types include `requests_count` and `http_429_count` (`src/types/db.ts:219-220`).
- `finishRun` only persists `pages_fetched`, `offers_fetched`, `errors_count` (`src/ingestion/runLifecycle.ts:51-59`).
- Search shows no accumulator writes for those two fields:
```bash
rg -n "acc\\.counters\\.(requests_count|http_429_count)" src tests
# (no output)
```

### 3.5 Type-level provider extensibility vs runtime support
- Generic provider type: `src/types/clients/job_offers.ts:12`
- Query type uses generic provider: `src/types/queries/registry.ts:18`
- Runtime runner only supports `"infojobs"` and throws for others (`src/orchestration/runner.ts:178-190`).

### 3.6 Logging rule inconsistency
- `docs/project-layout.md:141` forbids direct `console.*`.
- Runtime entrypoint still uses `console.error` (`src/runnerMain.ts:71`).

### 3.7 Unused constants in directory discovery config
- Defined but unused in `src/**`:
  - `MAX_PAGES_PER_SOURCE` (`src/constants/directoryDiscovery.ts:28`)
  - `ALLOW_INTERNAL_DETAIL_FETCH` (`src/constants/directoryDiscovery.ts:79`)
- Evidence:
```bash
rg -n "MAX_PAGES_PER_SOURCE|ALLOW_INTERNAL_DETAIL_FETCH" src --glob '!src/constants/directoryDiscovery.ts'
# (no output)
```

### 3.8 Unused ATS execution-order constant
- Declared: `src/constants/runner.ts:63`
- No usage in `src/**`:
```bash
rg -n "ATS_PROVIDER_EXECUTION_ORDER" src --glob '!src/constants/runner.ts'
# (no output)
```

## 4) Test contract mismatches

### 4.1 Integration tests exercise a flow not wired by runtime entrypoints
- Tests call:
  - `ingestDirectorySources` (`tests/integration/flows/directory_to_ats.offline.test.ts:164`)
  - `runAtsDiscoveryBatch` (`tests/integration/flows/directory_to_ats.offline.test.ts:175`)
  - `runLeverPipeline` / `runGreenhousePipeline` (`tests/integration/flows/directory_to_ats.offline.test.ts:188-189`)
- Runtime entrypoints (`src/main.ts`, `src/runnerMain.ts`, `src/orchestration/runner.ts`) have no references to these modules (search shown in 1.5).

### 4.2 HTTP mock helper hides query-string contract
- Test helper strips query parameters in route matching (`tests/helpers/mockHttp.ts:121-123`).
- Production InfoJobs client sends query params (`src/clients/infojobs/infojobsClient.ts:278-288`).
- Result: tests that register only base URL routes can pass without validating query composition.

### 4.3 Directory fixtures are adjusted to parser limitations
- Tests inject extra single-line anchors specifically to satisfy current regex parser:
  - `tests/integration/companySources/directory_sources.offline.test.ts:74-77`
  - `tests/integration/companySources/directory_sources.offline.test.ts:103-107`
- Parser limitation is explicit in production (`src/companySources/shared/htmlAnchors.ts:13-15`).

### 4.4 Live test mutates readonly production constant
- Live greenhouse test casts and mutates `GREENHOUSE_LIMITS`:
  - import: `tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts:31`
  - mutable cast + writes: `tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts:42-43`, `tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts:62`, `tests/integration/live/flows/directory_to_ats_greenhouse.live.test.ts:72`
- Production constant is `as const` (`src/constants/clients/greenhouse.ts:37-49`).

### 4.5 Stale/unused mocked endpoints in tests
- Explicit comments identify unused routes:
  - `tests/integration/flows/directory_to_ats.offline.test.ts:125`
  - `tests/integration/flows/directory_to_ats.offline.test.ts:157`

## 5) Recommendations (no implementation)

1. Decide a single production entrypoint (`main` vs `runnerMain`) and wire scripts accordingly.
2. Either wire `runAtsOrchestratorOnce` into a real entrypoint/scheduler or remove the ATS orchestrator subtree.
3. Remove or implement unused constants: `ATS_PROVIDER_EXECUTION_ORDER`, `MAX_PAGES_PER_SOURCE`, `ALLOW_INTERNAL_DETAIL_FETCH`.
4. Align ATS orchestrator defaults with `src/constants/runner.ts` (or remove one source of defaults).
5. Eliminate provider-list duplication by deriving ATS execution order from one canonical constant.
6. Consolidate duplicated Lever/Greenhouse pipeline scaffolding into one provider-parameterized runner.
7. Normalize run-result types (`RunOfferBatchResult` vs `RunInfojobsPipelineResult`) into one shape.
8. Update test HTTP mock to optionally enforce query matching (or add assertions for critical query params).
9. Stop mutating production constants in tests; pass test limits through function options/env.
10. Remove stale/unused mocked endpoints and keep fixtures tied to actually called routes.

## Completion checklist
- Dead-code claims include grep/search evidence for each candidate.
- No production code, tests, deletions, or refactors were performed.
