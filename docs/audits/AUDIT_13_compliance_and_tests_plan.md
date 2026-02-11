# AUDIT_13: Compliance + Test Readiness (Directory -> ATS -> Offers)

## Scope and baseline
- Mandatory baseline reopened: `docs/project-layout.md`.
- Hard baseline reused (module map and current wiring): `docs/audits/AUDIT_10_directory_to_ats_inventory.md`.
- This audit focuses on compliance and test readiness, not module re-inventory.

## 1) Compliance checklist results

| Rule (`docs/project-layout.md`) | Result | Evidence | Notes |
|---|---|---|---|
| Entrypoint is `src/main.ts` | Partial | `src/main.ts`, `package.json` (`dev`, `start`) | Entrypoint file exists and is wired in scripts, but current runtime chain for directory->ATS is not wired in runner flow per `docs/audits/AUDIT_10_directory_to_ats_inventory.md:79`. |
| `index.ts` are barrel-only | Pass | `src/companySources/index.ts`, `src/atsDiscovery/index.ts`, `src/ingestion/index.ts`, `src/types/index.ts`, `src/constants/index.ts` | Audited `index.ts` files contain exports only (plus comments). |
| No relative imports (`./`, `../`) | Fail | `src/companySources/catalonia/cataloniaSource.ts`, `src/companySources/lanzadera/lanzaderaSource.ts`, `src/atsDiscovery/atsDiscoveryService.ts`, `src/ingestion/ingestOffers.ts`, `src/ingestion/offerPersistence.ts`, `src/clients/lever/leverAtsJobOffersClient.ts`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts` | Rule at `docs/project-layout.md:30` is violated broadly in scoped modules. |
| Provider-specific code must not be imported outside provider folders | Fail | `src/ingestion/pipelines/lever.ts` imports `@/clients/lever`; `src/ingestion/pipelines/greenhouse.ts` imports `@/clients/greenhouse` | Rule at `docs/project-layout.md:32` is not satisfied by current pipeline wiring approach. |
| `src/types/**` must import via `@/types/...` | Fail | `src/types/db.ts` (`./sheets`), `src/types/queries/registry.ts` (`../clients/job_offers`) | Violates rule at `docs/project-layout.md:31`. |
| No `type`/`interface` declarations in logic files outside `src/types/**` | Fail | `src/atsDiscovery/runAtsDiscoveryBatch.ts` (`type BatchCounters`), `src/ingestion/aggregateCompanies.ts` (`export type AggregateCompaniesResult`), `src/clients/lever/leverAtsJobOffersClient.ts` (`type`, `export interface`), `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts` (`type`, `export interface`), `src/constants/sheets.ts` (`export type CompanySheetColumnId`) | Violates rule at `docs/project-layout.md:41`. |
| Canonical client-agnostic offer model used | Pass | `src/types/clients/job_offers.ts`, `src/clients/lever/mappers.ts`, `src/clients/greenhouse/mappers.ts`, `src/ingestion/offerPersistence.ts` | Provider payloads are mapped to canonical types before ingestion. |
| Provider-specific types are not re-exported from global `types` barrel | Pass | `src/types/index.ts` | Global barrel exports `job_offers`/generic types; provider payload types are imported directly where needed. |
| Clients must not write DB | Pass | `src/clients/lever/leverAtsJobOffersClient.ts`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts` | DB writes occur in ingestion/repos, not client modules. |
| No magic numbers in logic files | Partial | `src/ingestion/aggregateCompanies.ts` (`CHUNK_SIZE=50`, `MAX_RETRIES=2`, `RETRY_DELAY_MS=100`) | Tunables exist but are local constants, not centralized under `src/constants/` per `docs/project-layout.md:132`. |
| Logging via project logger, no `console.*` in pipeline modules | Pass (scoped modules) | `src/companySources/**`, `src/atsDiscovery/**`, `src/clients/{lever,greenhouse}/**`, `src/ingestion/**` | Uses `@/logger`. (Console usage exists in scripts/live tests and DB tooling, but outside this pipeline scope.) |

## 2) Hygiene issues (dead code, scripts, exports, types-in-logic, magic numbers)

### Dead code / dormant config
1. Unused directory tunables:
- `MAX_PAGES_PER_SOURCE` appears only in `src/constants/directoryDiscovery.ts`.
- `ALLOW_INTERNAL_DETAIL_FETCH` appears only in `src/constants/directoryDiscovery.ts`.
2. Unapplied ATS toggle:
- `ALLOW_EXTERNAL_DOMAINS` is declared in `src/constants/atsDiscovery.ts` but not used by `src/atsDiscovery/htmlLinkExtractor.ts` logic (only referenced in comment).
3. Unused local variables:
- `requestedIds` is created and not used in both hydrators: `src/clients/lever/leverAtsJobOffersClient.ts`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts`.

### Scripts hygiene
1. Ad-hoc debug scripts are not integrated into package scripts and are not typechecked by current tsconfig include set (`tsconfig.json` excludes `scripts/**` implicitly by not including it).
- Examples: `scripts/debug-madrimasd-anchors.ts`, `scripts/debug-madrimasd-external.ts`, `scripts/test-madrimasd.ts`.
2. Script/API drift indicator:
- `scripts/check-companies.ts`, `scripts/debug-offers.ts`, `scripts/smoke-aggregate-company.ts` call `openDb("data/buiss.db")`, while `openDb` signature is parameterless in `src/db/connection.ts`.

### Exports / wiring hygiene
1. ATS pipelines are exported in `src/ingestion/pipelines/index.ts`, but ingestion root barrel exports only `runInfojobsPipeline` in `src/ingestion/index.ts`.
2. From baseline (`AUDIT_10`), directory/ATS chain entrypoints exist but remain non-orchestrated in runtime (`docs/audits/AUDIT_10_directory_to_ats_inventory.md:83`).

### Types-in-logic hygiene
- Violations already listed in checklist: `src/atsDiscovery/runAtsDiscoveryBatch.ts`, `src/ingestion/aggregateCompanies.ts`, ATS client files, and `src/constants/sheets.ts`.

### Magic-number hygiene
- `src/ingestion/aggregateCompanies.ts` keeps runtime tunables in logic file (`50`, `2`, `100`) instead of `src/constants/**`.

## 3) Concrete test plan (unit / integration / live) + fixtures strategy

### A. Unit tests (pure logic, no DB/network)
Goal: lock deterministic behavior in shared extraction/detection/mapping functions.

Add unit suites for:
1. Directory extraction helpers:
- `src/companySources/shared/htmlAnchors.ts`
- `src/companySources/shared/urlFilters.ts`
- `src/companySources/shared/listingExtraction.ts`
- `src/companySources/lanzadera/lanzaderaSource.ts` (`isLanzaderaDetailPage` behavior via public-path tests through source behavior)
2. ATS discovery pure helpers:
- `src/atsDiscovery/urlUtils.ts`
- `src/atsDiscovery/detectors/leverDetector.ts`
- `src/atsDiscovery/detectors/greenhouseDetector.ts`
- `src/atsDiscovery/htmlLinkExtractor.ts`
3. ATS mapper correctness:
- `src/clients/lever/mappers.ts`
- `src/clients/greenhouse/mappers.ts`

Style alignment:
- Follow existing unit style from `tests/unit/companyIdentity.test.ts` and `tests/unit/sheets/provisionCompaniesSheet.test.ts`.
- Use `vitest` + direct function calls + `vi.spyOn` only when unavoidable.

### B. Integration tests (offline: real DB + mocked HTTP)
Goal: verify each stage and full dataflow side effects in SQLite.

Use existing harness:
- DB: `tests/helpers/testDb.ts` (`createTestDb`/`createTestDbSync`) with real migrations.
- HTTP mocking:
  - DI path for ATS clients via constructor `httpRequest` config (same pattern as `tests/e2e/infojobs_offline.test.ts` and `tests/helpers/mockHttp.ts`).
  - For discovery modules that call `httpRequest` directly, use `vi.spyOn` on `@/clients/http` export (aligned with `vi.spyOn` usage pattern in `tests/unit/sheets/provisionCompaniesSheet.test.ts`).

Planned integration suites:
1. Directory -> companies persistence:
- Invoke source fetchers + `ingestDirectorySources`.
- Assert `companies` inserts/updates and identity skip behavior.
2. Companies -> ATS discovery persistence:
- Seed `companies` with `website_url`.
- Run `runAtsDiscoveryBatch` with mocked HTML responses for found/not_found/error/conflict cases.
- Assert `company_sources` rows and counters (`persisted`, `notFound`, `persistConflict`).
3. ATS fetch -> offers persistence:
- Seed `company_sources` for `lever` and `greenhouse`.
- Run `runLeverPipeline` / `runGreenhousePipeline` with mocked ATS API JSON.
- Assert `offers`, `matches`, `companies` aggregation fields, and `ingestion_runs` writes.
4. Full-chain integration surrogate (current architecture reality):
- Execute sequentially in one test: directory ingest -> ATS discovery batch -> ATS pipelines.
- Assert end-state across `companies`, `company_sources`, `offers`, `matches`, `ingestion_runs`.
- This is required because runner orchestration is still InfoJobs-only per baseline (`AUDIT_10`).

### C. Live tests (gated, bounded)
Goal: smoke-check production-like behavior without making CI brittle.

Pattern (aligned with `tests/integration/live/*.live.test.ts`):
1. Add env-gated suites (e.g., `LIVE_DIRECTORY_ATS_TEST=1`) using `describeIf` guard.
2. Keep strict bounds (`limit=1` or minimal fixed tenants/domains).
3. Assert coarse invariants only (no exact counts):
- non-crash
- status/counter shapes
- DB writes occur where expected
4. Keep independent sentinel data to avoid cross-test pollution (same principle as `tests/integration/live/sheets_feedback_apply.live.test.ts`).

### Fixtures strategy (aligned with current repo style)
1. Keep provider/scenario folders under `tests/fixtures/` (same pattern as `tests/fixtures/infojobs/`).
2. Add minimal deterministic fixture sets:
- `tests/fixtures/directory/catalonia/*.html`
- `tests/fixtures/directory/madrimasd/{listing.html,detail_*.html}`
- `tests/fixtures/directory/lanzadera/{listing_option_a.html,listing_option_b.html,detail_*.html}`
- `tests/fixtures/ats/discovery/*.html` (home/careers/linked pages)
- `tests/fixtures/ats/lever/*.json`
- `tests/fixtures/ats/greenhouse/*.json`
3. Include positive and negative fixtures for every stage:
- success
- malformed/noisy HTML
- no-match
- duplicate/conflict
- partial provider failures

## 4) Five small testing tasks (ordered)
1. Create fixture skeletons for directory HTML + ATS HTML/API payloads under `tests/fixtures/directory/**` and `tests/fixtures/ats/**`.
2. Add unit tests for pure extraction/detection/mapping helpers (`companySources/shared`, `atsDiscovery/*`, ATS mappers).
3. Add offline integration test for `ingestDirectorySources` using real DB harness + mocked directory HTTP responses.
4. Add offline integration test for `runAtsDiscoveryBatch` covering found/not_found/persist-conflict paths and `company_sources` assertions.
5. Add offline full-chain surrogate test: directory ingest -> ATS discovery -> `runLeverPipeline`/`runGreenhousePipeline`, asserting final DB state across `companies`, `company_sources`, `offers`, `matches`, `ingestion_runs`.

## Optional compile check
- Not run for this audit (`npx tsc --noEmit --project tsconfig.json` was optional).
