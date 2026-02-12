# AUDIT A3 — Architecture & Boundaries

Date: 2026-02-11  
Scope: `src/companySources/**`, `src/interfaces/**`, `src/clients/**`, `src/atsDiscovery/**`, `src/ingestion/**`, `src/orchestration/**`, `src/types/**`, `src/constants/**`  
Pre-step: reviewed `docs/project-layout.md` (notably rules at `docs/project-layout.md:30-33`, `docs/project-layout.md:40-43`, `docs/project-layout.md:74-86`, `docs/project-layout.md:128-133`).

## 1) Boundary map

### Source modules (`src/companySources/**`)
- Intended responsibility: fetch/parse external directories into canonical `CompanyInput`.
  - Contract is defined in `src/interfaces/companySources/companyDirectorySource.ts:16-35`.
  - Source implementations are fetch/parse mappers:
    - `src/companySources/catalonia/cataloniaSource.ts:41-145`
    - `src/companySources/madrimasd/madrimasdSource.ts:43-55`
    - `src/companySources/lanzadera/lanzaderaSource.ts:81-132`
- Boundary break observed:
  - `src/companySources/ingestDirectorySources.ts` performs DB access/writes (`getDb`, `upsertCompany`) at `src/companySources/ingestDirectorySources.ts:11`, `src/companySources/ingestDirectorySources.ts:58`, `src/companySources/ingestDirectorySources.ts:122`.

### Client modules (`src/clients/{infojobs,lever,greenhouse}/**`)
- Responsibility mostly aligned with policy (auth + HTTP + payload mapping).
  - InfoJobs client: `src/clients/infojobs/infojobsClient.ts:65-486`
  - Lever client: `src/clients/lever/leverAtsJobOffersClient.ts:43-219`
  - Greenhouse client: `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:44-248`
  - Mappers are provider-specific and isolated under provider folders:
    - `src/clients/infojobs/mappers.ts:97-226`
    - `src/clients/lever/mappers.ts:62-120`
    - `src/clients/greenhouse/mappers.ts:47-112`
- DB leakage check in clients:
  - `rg -n "@/db" src/clients` returned no matches.

### ATS discovery (`src/atsDiscovery/**`)
- Pure detection pieces exist and are clean:
  - Discovery service: `src/atsDiscovery/atsDiscoveryService.ts:36-178`
  - Fetch+detect helper: `src/atsDiscovery/fetchAndDetect.ts:24-98`
  - Link extraction and URL utils:
    - `src/atsDiscovery/htmlLinkExtractor.ts:27-108`
    - `src/atsDiscovery/urlUtils.ts:22-98`
  - Detectors:
    - `src/atsDiscovery/detectors/leverDetector.ts:20-36`
    - `src/atsDiscovery/detectors/greenhouseDetector.ts:20-38`
- Boundary break observed:
  - DB selection and persistence live inside the same module area:
    - `src/atsDiscovery/runAtsDiscoveryBatch.ts:8`, `src/atsDiscovery/runAtsDiscoveryBatch.ts:54`, `src/atsDiscovery/runAtsDiscoveryBatch.ts:73`
    - `src/atsDiscovery/persistDiscoveryResult.ts:9`, `src/atsDiscovery/persistDiscoveryResult.ts:34-41`

### Ingestion (`src/ingestion/**`)
- Canonical persistence + dedupe + scoring hooks are centralized here:
  - Company persistence: `src/ingestion/companyPersistence.ts:108-152`
  - Offer persistence + repost dedupe: `src/ingestion/offerPersistence.ts:131-353`
  - Scoring hook after persistence: `src/ingestion/ingestOffers.ts:88-101`
  - Run lifecycle: `src/ingestion/runLifecycle.ts:25-121`
  - Aggregation orchestration: `src/ingestion/aggregateCompanies.ts:112-152`
- Boundary drift inside ingestion:
  - `src/ingestion/runOfferBatch.ts` directly runs Sheets sync + feedback apply (`src/ingestion/runOfferBatch.ts:21-27`, `src/ingestion/runOfferBatch.ts:84-223`), mixing ingestion with feedback/export orchestration.

### Orchestration (`src/orchestration/**`)
- Sequencing responsibilities are present:
  - Main query runner with lock/pause/retries: `src/orchestration/runner.ts:331-531`
  - ATS orchestrator sequence: `src/orchestration/ats/atsOrchestrator.ts:47-132`
  - Provider-specific ATS runners:
    - `src/orchestration/ats/leverRunner.ts:37-114`
    - `src/orchestration/ats/greenhouseRunner.ts:37-114`
- Extensibility bottleneck:
  - Explicit provider branches/imports are hardcoded in orchestration:
    - `src/orchestration/runner.ts:178-190` (only `"infojobs"` supported)
    - `src/orchestration/ats/atsOrchestrator.ts:18-19`, `src/orchestration/ats/atsOrchestrator.ts:90-108` (hardwired Lever/Greenhouse sequence)

## 2) Placement compliance

### Exported types not in logic files
Status: **Non-compliant**

- Exported types/interfaces in logic files (outside `src/types/**`):
  - `src/ingestion/aggregateCompanies.ts:25` (`AggregateCompaniesResult`)
  - `src/orchestration/ats/atsOrchestrator.ts:25` (`RunAtsOrchestratorOnceOptions`)
  - `src/orchestration/ats/leverRunner.ts:17` (`RunLeverRunnerOnceOptions`)
  - `src/orchestration/ats/greenhouseRunner.ts:17` (`RunGreenhouseRunnerOnceOptions`)
  - `src/clients/infojobs/infojobsClient.ts:45` (`InfoJobsClientConfig`)
  - `src/clients/lever/leverAtsJobOffersClient.ts:32` (`LeverAtsJobOffersClientConfig`)
  - `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:33` (`GreenhouseAtsJobOffersClientConfig`)

### Magic numbers in constants
Status: **Partially compliant**

- Good: many tunables in constants:
  - ATS discovery constants: `src/constants/atsDiscovery.ts:11-138`
  - Runner constants: `src/constants/runner.ts:11-63`
  - Directory discovery constants: `src/constants/directoryDiscovery.ts:11-88`
- Violations (hardcoded values in logic):
  - `src/ingestion/aggregateCompanies.ts:18-20` (`CHUNK_SIZE=50`, `MAX_RETRIES=2`, `RETRY_DELAY_MS=100`)
  - `src/orchestration/runner.ts:119` (500-char truncation)
  - `src/orchestration/runner.ts:255` (2000ms retry sleep)
  - `src/orchestration/runner.ts:510` (120000ms fallback sleep)
  - `src/orchestration/ats/atsOrchestrator.ts:50-52` (default limits hardcoded to `1`)

### No provider strings scattered
Status: **Partially compliant**

- Central provider constants exist (`src/constants/atsDiscovery.ts:11`, `src/constants/runner.ts:63`), but provider-specific literals are still distributed across execution paths:
  - `src/orchestration/runner.ts:178-190`
  - `src/orchestration/ats/leverRunner.ts:42-56`
  - `src/orchestration/ats/greenhouseRunner.ts:42-56`
  - `src/ingestion/pipelines/lever.ts:46-51`
  - `src/ingestion/pipelines/greenhouse.ts:46-51`
- `ATS_PROVIDER_EXECUTION_ORDER` is defined but unused (`src/constants/runner.ts:63`; no usages via `rg -n "ATS_PROVIDER_EXECUTION_ORDER" src`).

## 3) Agnosticism checks

### Adding a new directory source: what is needed now
- Implement `CompanyDirectorySource` contract (`src/interfaces/companySources/companyDirectorySource.ts:16-35`).
- Add source module under `src/companySources/<source>/...` and export from `src/companySources/index.ts:16-19`.
- If using shared pipeline, pass source-specific config (`src/types/companySources.ts:29-73`, `src/companySources/shared/directoryPipeline.ts:50-61`).
- Add seed/config constants in `src/constants/directoryDiscovery.ts:12-17` / tunables as needed.
- Wire source invocation manually where `ingestDirectorySources(...)` is called (runtime scan: `rg -n "ingestDirectorySources\\(" src/main.ts src/runnerMain.ts src/orchestration/runner.ts` -> no matches; usage appears in tests/docs).

### Adding a new ATS provider: what is needed now
- Extend ATS provider constants/types:
  - `src/constants/atsDiscovery.ts:11`
  - `src/types/atsDiscovery.ts:13`
- Add detector and register exports:
  - `src/atsDiscovery/detectors/index.ts:5-6`
  - detection call sites in `src/atsDiscovery/fetchAndDetect.ts:44-62` and `src/atsDiscovery/atsDiscoveryService.ts:80-112`
- Add provider client + mappers under `src/clients/<provider>/...`.
- Add pipeline and runner:
  - pattern in `src/ingestion/pipelines/lever.ts:28-180` / `src/ingestion/pipelines/greenhouse.ts:28-180`
  - pattern in `src/orchestration/ats/leverRunner.ts:37-114` / `src/orchestration/ats/greenhouseRunner.ts:37-114`
- Update ATS orchestrator imports/steps (`src/orchestration/ats/atsOrchestrator.ts:18-19`, `src/orchestration/ats/atsOrchestrator.ts:90-108`).

### Hardcoded branches that reduce agnosticism
- Legacy runner only handles InfoJobs (`src/orchestration/runner.ts:178-190`).
- ATS orchestrator sequence is compile-time hardwired to Lever then Greenhouse (`src/orchestration/ats/atsOrchestrator.ts:90-108`), instead of consuming `ATS_PROVIDER_EXECUTION_ORDER` (`src/constants/runner.ts:63`).

## 4) Violations list

1. **BLOCKER** — Source-layer DB leakage (directory source ingestion module writes DB)
   - Evidence: `src/companySources/ingestDirectorySources.ts:11`, `src/companySources/ingestDirectorySources.ts:122`.
   - Why this violates SoC: company source modules are expected to be fetch/extract adapters; DB writes belong to ingestion/repo layers.

2. **BLOCKER** — ATS discovery module mixes detection with DB read/write orchestration
   - Evidence: `src/atsDiscovery/runAtsDiscoveryBatch.ts:8`, `src/atsDiscovery/runAtsDiscoveryBatch.ts:54`, `src/atsDiscovery/runAtsDiscoveryBatch.ts:73`, `src/atsDiscovery/persistDiscoveryResult.ts:9`, `src/atsDiscovery/persistDiscoveryResult.ts:34-41`.
   - Why this violates SoC: discovery logic and persistence orchestration are coupled in the same module area, making reuse/testing harder.

3. **SHOULD** — Import policy non-compliance (`docs/project-layout.md:30-33`)
   - Evidence: 103 relative-import/export occurrences in scoped folders (`rg ... | wc -l` -> `103`), e.g.:
     - `src/ingestion/offerPersistence.ts:40`
     - `src/atsDiscovery/atsDiscoveryService.ts:14-17`
     - `src/companySources/shared/listingExtraction.ts:14-15`
     - `src/types/queries/registry.ts:8`
     - `src/types/db.ts:8`
   - Why this violates SoC: breaks repository-wide import convention and weakens module boundary consistency.

4. **SHOULD** — Type/interface placement violations (`docs/project-layout.md:40-43`)
   - Evidence:
     - `src/ingestion/aggregateCompanies.ts:25`
     - `src/orchestration/ats/atsOrchestrator.ts:25`
     - `src/orchestration/ats/leverRunner.ts:17`
     - `src/orchestration/ats/greenhouseRunner.ts:17`
     - `src/clients/infojobs/infojobsClient.ts:45`
     - `src/clients/lever/leverAtsJobOffersClient.ts:32`
     - `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts:33`
   - Why this violates SoC: data-contract declarations are split between `src/types/**` and runtime modules.

5. **SHOULD** — Magic numbers remain in logic despite constants policy (`docs/project-layout.md:128-133`)
   - Evidence:
     - `src/ingestion/aggregateCompanies.ts:18-20`
     - `src/orchestration/runner.ts:119`
     - `src/orchestration/runner.ts:255`
     - `src/orchestration/runner.ts:510`
     - `src/orchestration/ats/atsOrchestrator.ts:50-52`
   - Why this violates SoC: runtime tuning is fragmented and harder to reason/configure.

6. **SHOULD** — ATS orchestration is not provider-agnostic despite existing order constant
   - Evidence:
     - Hardcoded imports/steps: `src/orchestration/ats/atsOrchestrator.ts:18-19`, `src/orchestration/ats/atsOrchestrator.ts:90-108`
     - Unused order constant: `src/constants/runner.ts:63`
   - Why this violates SoC: adding providers requires editing orchestrator code instead of extending a registry/order source.

7. **NICE** — Ingestion module includes Sheets feedback side effects
   - Evidence: `src/ingestion/runOfferBatch.ts:21-27`, `src/ingestion/runOfferBatch.ts:84-223`.
   - Why this violates SoC (soft): ingestion/persistence path is coupled to export/feedback integration flow, increasing blast radius.

## 5) Top 5 improvements (recommendations only)

1. Move DB writes out of `src/companySources/ingestDirectorySources.ts` into an ingestion/orchestration adapter; keep companySources strictly fetch/extract.
2. Split ATS discovery into pure discovery services + ingestion/orchestrator persistence adapter; keep `src/atsDiscovery/**` DB-free.
3. Enforce path alias imports (`@/...`) across scoped folders, starting with `src/types/**` first (`src/types/queries/registry.ts`, `src/types/db.ts`).
4. Relocate runtime option/counter types from logic files into `src/types/**`, then import them back into runtime modules.
5. Replace hardcoded ATS runner sequence with an iterable provider registry (consume `ATS_PROVIDER_EXECUTION_ORDER` plus provider-runner map) to reduce edit points for new providers.

## Completion checklist
- No production code/tests were modified; only this audit document was added.
- Findings are evidence-backed with concrete file and line pointers.
