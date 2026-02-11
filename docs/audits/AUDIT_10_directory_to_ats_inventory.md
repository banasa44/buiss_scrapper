# AUDIT_10: Inventory + Dataflow (Directory discovery -> persist companies -> ATS fetch offers -> persist offers)

## Scope and baseline
- Baseline reopened and used for compliance judgments: `docs/project-layout.md` (notably `Entrypoint` and import rules at `docs/project-layout.md:20`, `docs/project-layout.md:30`, `docs/project-layout.md:31`).
- Audited modules: `src/companySources/**`, `src/atsDiscovery/**`, `src/clients/{lever,greenhouse,infojobs,http}/**`, `src/ingestion/**`, `src/db/**`, `src/interfaces/**`, `src/types/**`, `src/runnerMain.ts`, `src/orchestration/runner.ts`.

## 1) Module inventory: stage entrypoints (1-4)

### Stage 1. Directory company discovery
| Symbol | File | Role |
|---|---|---|
| `fetchCataloniaCompanies` | `src/companySources/catalonia/cataloniaSource.ts` | Discover companies from Catalonia directory and emit `CompanyInput[]`. |
| `fetchMadrimasdCompanies` | `src/companySources/madrimasd/madrimasdSource.ts` | Discover companies via listing->detail pipeline and emit `CompanyInput[]`. |
| `fetchLanzaderaCompanies` | `src/companySources/lanzadera/lanzaderaSource.ts` | Discover companies from Lanzadera (direct links or detail-page fallback) and emit `CompanyInput[]`. |
| `fetchCompaniesViaDetailPages` | `src/companySources/shared/directoryPipeline.ts` | Shared multi-step extractor producing `CompanyInput[]`. |
| `extractCompaniesFromListing` | `src/companySources/shared/listingExtraction.ts` | Shared single-page extractor producing `CompanyInput[]`. |
| `CompanyDirectorySource` | `src/interfaces/companySources/companyDirectorySource.ts` | Contract for directory discovery sources (`fetchCompanies(): Promise<CompanyInput[]>`). |

### Stage 2. Persist companies
| Symbol | File | Role |
|---|---|---|
| `ingestDirectorySources` | `src/companySources/ingestDirectorySources.ts` | Orchestrates source fetch and persistence; validates identity and calls canonical repo. |
| `upsertCompany` | `src/db/repos/companiesRepo.ts` | Canonical insert/update into `companies` table using `website_domain`/`normalized_name` identity logic. |

### Stage 3. ATS discovery + ATS offers fetch
| Symbol | File | Role |
|---|---|---|
| `runAtsDiscoveryBatch` | `src/atsDiscovery/runAtsDiscoveryBatch.ts` | Batch ATS discovery for companies missing ATS sources. |
| `listCompaniesNeedingAtsDiscovery` | `src/db/repos/companiesRepo.ts` | Selects companies with `website_url` and without `lever/greenhouse` rows in `company_sources`. |
| `discoverAts` | `src/atsDiscovery/atsDiscoveryService.ts` | Detects ATS tenant (`lever`/`greenhouse`) from website HTML. |
| `persistDiscoveryResult` | `src/atsDiscovery/persistDiscoveryResult.ts` | Persists successful discovery as `company_sources` row. |
| `upsertCompanySourceByCompanyProvider` | `src/db/repos/companiesRepo.ts` | Upsert keyed by `(company_id, provider)` for ATS discovery persistence. |
| `runLeverPipeline` | `src/ingestion/pipelines/lever.ts` | ATS offers pipeline for `provider='lever'`. |
| `runGreenhousePipeline` | `src/ingestion/pipelines/greenhouse.ts` | ATS offers pipeline for `provider='greenhouse'`. |
| `listCompanySourcesByProvider` | `src/db/repos/companiesRepo.ts` | Reads ATS tenants from `company_sources` for ingestion. |
| `LeverAtsJobOffersClient.listOffersForTenant` / `hydrateOfferDetails` | `src/clients/lever/leverAtsJobOffersClient.ts` | Fetch + hydrate Lever offers in canonical shape. |
| `GreenhouseAtsJobOffersClient.listOffersForTenant` / `hydrateOfferDetails` | `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts` | Fetch + hydrate Greenhouse offers in canonical shape. |
| `AtsJobOffersClient` | `src/interfaces/clients/atsJobOffersClient.ts` | Provider-agnostic ATS client contract. |

### Stage 4. Persist offers
| Symbol | File | Role |
|---|---|---|
| `ingestOffers` | `src/ingestion/ingestOffers.ts` | Batch orchestration per provider: persist offers, score/match, track counters. |
| `persistOffer` | `src/ingestion/offerPersistence.ts` | Per-offer persistence and dedupe/repost logic. |
| `buildOfferInput` | `src/ingestion/offerPersistence.ts` | Maps canonical offer to DB `OfferInput`. |
| `upsertOffer` | `src/db/repos/offersRepo.ts` | Insert/update into `offers` table. |
| `upsertMatch` | `src/db/repos/matchesRepo.ts` | Insert/update into `matches` table. |
| `aggregateCompaniesAndPersist` | `src/ingestion/aggregateCompanies.ts` | End-of-batch company aggregation orchestration. |
| `aggregateCompanyAndPersist` -> `updateCompanyAggregation` | `src/signal/aggregation/aggregateCompanyAndPersist.ts`, `src/db/repos/companiesRepo.ts` | Updates company aggregate fields in `companies`. |
| `withRun` -> `createRun`/`finishRun` | `src/ingestion/runLifecycle.ts`, `src/db/repos/runsRepo.ts` | Writes run lifecycle data into `ingestion_runs`. |

## 2) Actual call graph and wiring status

### Implemented dataflows (code exists)
1. Directory discovery -> companies persistence
   - `fetchCataloniaCompanies` / `fetchMadrimasdCompanies` / `fetchLanzaderaCompanies`
   - -> `ingestDirectorySources` (`source.fetchCompanies()` loop)
   - -> `upsertCompany`
   - -> writes `companies`.

2. Companies -> ATS discovery persistence
   - `runAtsDiscoveryBatch`
   - -> `listCompaniesNeedingAtsDiscovery`
   - -> `discoverAts`
   - -> `persistDiscoveryResult`
   - -> `upsertCompanySourceByCompanyProvider`
   - -> writes `company_sources`.

3. ATS tenants -> ATS offer fetch -> offer persistence
   - `runLeverPipeline` / `runGreenhousePipeline`
   - -> `listCompanySourcesByProvider("lever"|"greenhouse")`
   - -> ATS client `listOffersForTenant` + `hydrateOfferDetails`
   - -> `ingestOffers({ companyId })`
   - -> `persistOffer` (uses provided `companyId` path)
   - -> `upsertOffer` (+ `upsertMatch` when detail contains description)
   - -> `aggregateCompaniesAndPersist` -> `updateCompanyAggregation`.

### Runtime wiring status (what is actually connected by runner)
- Current runner path is InfoJobs-only:
  - `ALL_QUERIES` is built from `INFOJOBS_QUERIES` only (`src/queries/index.ts`, `src/queries/infojobs.ts`).
  - `executeQuery` in runner only handles `query.client === "infojobs"` and otherwise throws `Unsupported client` (`src/orchestration/runner.ts`).
  - Runner imports and calls only `runInfojobsPipeline` (`src/orchestration/runner.ts`).
- Therefore this 1->4 chain is **not wired end-to-end** in runtime orchestration:
  - `ingestDirectorySources` is exported but not called by runner.
  - `runAtsDiscoveryBatch` is exported but not called by runner.
  - `runLeverPipeline` / `runGreenhousePipeline` exist but are not called by runner.

## 3) Canonical models and mapping points

### Company model
- Canonical persistence input: `CompanyInput` in `src/types/db.ts`.
- Directory mapping to `CompanyInput` happens in:
  - `src/companySources/catalonia/cataloniaSource.ts` (`companies.push({...})`)
  - `src/companySources/shared/listingExtraction.ts` (`companies.push({...})`)
  - `src/companySources/shared/directoryPipeline.ts` (`companies.push({...})`).
- Persistence to DB happens in `upsertCompany` (`src/db/repos/companiesRepo.ts`).

### ATS discovery model
- Discovery types: `AtsDiscoveryResult`, `AtsTenant`, `AtsProvider` in `src/types/atsDiscovery.ts`.
- Successful discovery is mapped to `CompanySourceInput` fields in `persistDiscoveryResult` (`provider`, `provider_company_id`, `provider_company_url`) and persisted via `upsertCompanySourceByCompanyProvider`.

### Offer canonical model
- Canonical offer types: `JobOfferSummary`, `JobOfferDetail`, `JobOfferCompany` in `src/types/clients/job_offers.ts`.
- Provider payload -> canonical mapping:
  - InfoJobs: `mapInfoJobsOfferListItemToSummary`, `mapInfoJobsOfferDetailToDetail` in `src/clients/infojobs/mappers.ts`.
  - Lever: `mapLeverPostingToSummary`, `mapLeverPostingToDetail` in `src/clients/lever/mappers.ts`.
  - Greenhouse: `mapGreenhouseJobToSummary`, `mapGreenhouseJobToDetail` in `src/clients/greenhouse/mappers.ts`.
- Canonical -> DB offer row mapping:
  - `buildOfferInput` in `src/ingestion/offerPersistence.ts`
  - target type `OfferInput` in `src/types/db.ts`.
- ATS-specific persistence behavior:
  - `persistOffer` uses provided `companyId` (ATS path) and bypasses `persistCompanyAndSource` when `companyId` is present (`src/ingestion/offerPersistence.ts`).

## 4) Side effects: DB tables written per stage
| Stage | Main writers | Tables written |
|---|---|---|
| 1-2 (directory discovery + persist companies) | `ingestDirectorySources` -> `upsertCompany` | `companies` (INSERT/UPDATE) |
| 3a (ATS discovery persistence) | `runAtsDiscoveryBatch` -> `persistDiscoveryResult` -> `upsertCompanySourceByCompanyProvider` | `company_sources` (INSERT/UPDATE) |
| 3b-4 (ATS offers fetch + persist offers) | `runLeverPipeline`/`runGreenhousePipeline` -> `ingestOffers`/`persistOffer` | `offers` (upsert), `matches` (upsert), `companies` (aggregation updates), `ingestion_runs` (run lifecycle) |

## 5) Gaps and non-integrated pieces

1. End-to-end directory->ATS->offers chain is not orchestrated in runtime.
   - Evidence: `src/orchestration/runner.ts` executes only `runInfojobsPipeline`; no calls to `ingestDirectorySources`, `runAtsDiscoveryBatch`, `runLeverPipeline`, or `runGreenhousePipeline`.

2. Registry currently schedules only InfoJobs queries.
   - Evidence: `ALL_QUERIES` is `[...]INFOJOBS_QUERIES` (`src/queries/index.ts`); there are no Lever/Greenhouse/directory query registrations.

3. Default package entrypoint path does not execute the runner chain.
   - Evidence: `package.json` points `dev/start` to `src/main.ts`/`dist/main.js`; `src/main.ts` only initializes `InfoJobsClient` and contains a TODO, while runner logic lives in `src/runnerMain.ts`.

4. Project-layout import rule violations are present in audited flow code.
   - Rule: no `./` or `../` imports (`docs/project-layout.md:30`).
   - Examples: `src/companySources/catalonia/cataloniaSource.ts`, `src/atsDiscovery/atsDiscoveryService.ts`, `src/ingestion/ingestOffers.ts`, `src/runnerMain.ts`, `src/clients/lever/leverAtsJobOffersClient.ts`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts`.

5. Project-layout type import rule violations exist under `src/types/**`.
   - Rule: types should import via `@/types/...` (`docs/project-layout.md:31`).
   - Violations: `src/types/db.ts` imports `./sheets`; `src/types/queries/registry.ts` imports `../clients/job_offers`.

6. ATS discovery conflict path is handled but unresolved at orchestration level.
   - Evidence: `runAtsDiscoveryBatch` increments `persistConflict` on UNIQUE violations (via `isUniqueConstraintError`) and continues; no reconciliation step is present in runner wiring.

## Optional compile check
- Executed: `npx tsc --noEmit --project tsconfig.json`
- Result: completed successfully (exit code 0).

