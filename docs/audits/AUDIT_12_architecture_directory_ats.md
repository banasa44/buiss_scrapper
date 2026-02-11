# AUDIT_12: Architecture & Separation of Concerns (Directory + ATS)

## Scope and baseline
- Mandatory baseline reopened: `docs/project-layout.md`.
- Hard baseline reused (module map, wiring status): `docs/audits/AUDIT_10_directory_to_ats_inventory.md`.
- This audit focuses on architecture quality and boundaries, not re-inventory.

## 1) Boundary map + responsibilities

| Boundary | Responsibilities in code | Evidence | Architecture verdict |
|---|---|---|---|
| Directory source contract | Provider-agnostic company discovery contract returning canonical `CompanyInput[]` | `src/interfaces/companySources/companyDirectorySource.ts` (`CompanyDirectorySource.fetchCompanies`) | Good separation: behavior contract is explicit and data model is canonical. |
| Directory implementations | Fetch/parse only; no DB writes in source implementations | `src/companySources/catalonia/cataloniaSource.ts` (`fetchCataloniaCompanies`), `src/companySources/madrimasd/madrimasdSource.ts` (`fetchMadrimasdCompanies`), `src/companySources/lanzadera/lanzaderaSource.ts` (`fetchLanzaderaCompanies`) | Good isolation at source layer. |
| Directory ingestion/persistence bridge | Orchestrates sources and persists via canonical repo | `src/companySources/ingestDirectorySources.ts` (`ingestDirectorySources` -> `upsertCompany`) | Layering is correct (source -> ingestion -> repo). |
| ATS discovery service | Website normalization, candidate generation, HTML fetch/detect, one-hop link follow | `src/atsDiscovery/atsDiscoveryService.ts` (`discoverAts`) + helpers in `src/atsDiscovery/*` | Good functional decomposition; heuristic-heavy (see Section 4). |
| ATS discovery persistence | Maps `AtsDiscoveryResult` to `company_sources` upsert | `src/atsDiscovery/persistDiscoveryResult.ts` (`persistDiscoveryResult` -> `upsertCompanySourceByCompanyProvider`) | Correct DB write boundary via repo. |
| ATS offers client contract | Provider-agnostic tenant-scoped fetching + hydration | `src/interfaces/clients/atsJobOffersClient.ts` (`AtsJobOffersClient`) | Good contract, but implementations duplicate hydration strategy. |
| ATS provider clients | HTTP + payload mapping to canonical offers | `src/clients/lever/leverAtsJobOffersClient.ts`, `src/clients/lever/mappers.ts`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts`, `src/clients/greenhouse/mappers.ts` | Correct SoC: no DB writes in clients. |
| Ingestion orchestration | Run lifecycle, offer persistence, scoring/matching, aggregation | `src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`, `src/ingestion/ingestOffers.ts`, `src/ingestion/offerPersistence.ts`, `src/ingestion/runLifecycle.ts` | Layering is mostly consistent with repo patterns. |
| DB layer | Thin SQL repos for `companies`, `company_sources`, `offers`, `matches`, `ingestion_runs` | `src/db/repos/companiesRepo.ts`, `src/db/repos/offersRepo.ts`, `src/db/repos/matchesRepo.ts`, `src/db/repos/runsRepo.ts` | Mostly thin and provider-agnostic; identity constraints rely on mixed app+DB invariants. |

### Cross-boundary integration status (from AUDIT_10 baseline)
- The directory -> ATS -> offers chain exists in modules but is not runtime-wired by runner orchestration yet (`docs/audits/AUDIT_10_directory_to_ats_inventory.md:79`, `docs/audits/AUDIT_10_directory_to_ats_inventory.md:83`).

## 2) Where policy decisions live (constants vs logic)

### Policy centralized in constants (good)
- Directory tunables and seed URLs are centralized in `src/constants/directoryDiscovery.ts` (`DIRECTORY_DISCOVERY`).
- ATS detection tunables are centralized in `src/constants/atsDiscovery.ts` (`CANDIDATE_PATHS`, detector regex patterns, `LINK_FOLLOW`, `LIMITS`, `HTTP`).
- ATS client HTTP/base URL tunables are centralized in `src/constants/clients/lever.ts` and `src/constants/clients/greenhouse.ts`.

### Policy embedded in logic (architecture drift)
1. Custom Lanzadera detail URL policy is hardcoded in logic:
   - `src/companySources/lanzadera/lanzaderaSource.ts` (`isLanzaderaDetailPage`).
2. Company discovery User-Agent policy is duplicated as string literals in logic files:
   - `src/companySources/catalonia/cataloniaSource.ts`
   - `src/companySources/shared/directoryPipeline.ts`
   - `src/companySources/lanzadera/lanzaderaSource.ts`
3. ATS provider set is duplicated between constants and SQL:
   - constants source of truth: `src/constants/atsDiscovery.ts` (`ATS_PROVIDERS`)
   - hardcoded SQL filter: `src/db/repos/companiesRepo.ts` (`listCompaniesNeedingAtsDiscovery`, `cs.provider IN ('lever', 'greenhouse')`).

### Declared-but-not-applied policy (high drift signal)
1. `ALLOW_INTERNAL_DETAIL_FETCH` is declared but not read by discovery flow:
   - declared in `src/constants/directoryDiscovery.ts` (`DIRECTORY_DISCOVERY.TUNABLES.DETAIL_FETCH.ALLOW_INTERNAL_DETAIL_FETCH`).
2. `MAX_PAGES_PER_SOURCE` is declared but not used by source implementations:
   - declared in `src/constants/directoryDiscovery.ts` and absent in `src/companySources/*` execution paths.
3. `LINK_FOLLOW.ALLOW_EXTERNAL_DOMAINS` is declared but not applied in link filtering logic:
   - declared in `src/constants/atsDiscovery.ts`
   - extraction logic in `src/atsDiscovery/htmlLinkExtractor.ts` enforces same-domain or known ATS host without checking that flag.

## 3) Coupling smells / duplication forks

1. `Catalonia` re-implements shared listing extraction logic.
- Evidence: `src/companySources/catalonia/cataloniaSource.ts` duplicates extraction/dedupe loop that already exists in `src/companySources/shared/listingExtraction.ts` (`extractCompaniesFromListing`).
- Risk: behavioral drift in filters/dedupe across sources.

2. Lever and Greenhouse pipelines are near-clones.
- Evidence: `src/ingestion/pipelines/lever.ts` and `src/ingestion/pipelines/greenhouse.ts` share the same orchestration skeleton (load sources -> list offers -> hydrate -> ingest -> aggregate).
- Risk: fixes/features diverge across providers.

3. ATS client hydration logic is duplicated and partially dead.
- Evidence: both clients re-fetch tenant jobs in `hydrateOfferDetails`:
  - `src/clients/lever/leverAtsJobOffersClient.ts`
  - `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts`
- Evidence of dead intermediate variable in both files: `requestedIds` created but never used.
- Risk: extra fetch cost + maintenance divergence.

4. Ingestion path fork creates behavior divergence vs standard batch runner.
- Evidence:
  - InfoJobs path uses shared `runOfferBatchIngestion` (`src/ingestion/runOfferBatch.ts`) that includes Sheets sync/feedback.
  - ATS pipelines bypass it and call `withRun` + `ingestOffers` directly (`src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`).
- Risk: provider-dependent side effects and telemetry semantics.

5. Application-level uniqueness policy not enforced at DB level for `(company_id, provider)`.
- Evidence:
  - app-level upsert key in `src/db/repos/companiesRepo.ts` (`upsertCompanySourceByCompanyProvider`).
  - migration only enforces unique `(provider, provider_company_id)` in `migrations/0002_company_sources_and_global_companies.sql`.
- Risk: concurrent writers could still create logical duplicates per company/provider.

## 4) Hallucination indicators (magic heuristics, inconsistent invariants)

1. Regex HTML parsing as core extractor.
- `src/companySources/shared/htmlAnchors.ts` (`extractAnchors`) and `src/atsDiscovery/htmlLinkExtractor.ts` rely on regex anchor parsing with documented limitations.
- Indicator: extraction completeness depends on HTML shape, not DOM semantics.

2. First-match detector semantics can mask ambiguity.
- `src/atsDiscovery/detectors/leverDetector.ts` and `src/atsDiscovery/detectors/greenhouseDetector.ts` return first regex match in pattern order.
- `src/atsDiscovery/atsDiscoveryService.ts` checks Lever first, then Greenhouse, returning immediately.
- Indicator: pages containing multiple ATS hints resolve by order, not confidence.

3. Silent error flattening to `null` / empty arrays.
- `src/atsDiscovery/fetchAndDetect.ts` catches and returns `null`.
- ATS clients return empty results on fetch/hydration errors:
  - `src/clients/lever/leverAtsJobOffersClient.ts`
  - `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts`.
- Indicator: hard to distinguish "true no data" from "transport/parser failure".

4. Identity invariants can conflict between app logic and DB uniqueness.
- `src/db/repos/companiesRepo.ts` (`upsertCompany`) domain-first branch inserts with `normalized_name` when domain not found.
- DB also enforces unique `normalized_name` (`migrations/0002_company_sources_and_global_companies.sql`), so cross-domain same-name cases surface as runtime DB errors handled at caller level.
- Indicator: deterministic, but failure mode is indirect and spread across layers.

5. Telemetry invariants differ by pipeline path.
- `src/ingestion/runOfferBatch.ts` sets `acc.counters.offers_fetched`.
- ATS pipelines (`src/ingestion/pipelines/lever.ts`, `src/ingestion/pipelines/greenhouse.ts`) do not set `offers_fetched` in accumulator even though they fetch offers.
- Indicator: same metric has route-dependent meaning.

## 5) Five small refactor suggestions

1. Reuse shared listing extractor in Catalonia source.
- Change `fetchCataloniaCompanies` to delegate to `extractCompaniesFromListing` (`src/companySources/shared/listingExtraction.ts`) after HTML fetch.
- Benefit: removes duplicated extraction policy and keeps source behavior aligned.

2. Introduce a shared ATS pipeline runner skeleton.
- Factor common orchestration from `src/ingestion/pipelines/lever.ts` and `src/ingestion/pipelines/greenhouse.ts` into one generic helper parameterized by provider/client constructor.
- Benefit: one place for counters, error policy, and aggregation semantics.

3. Remove or wire currently unused tunables.
- Either apply or delete:
  - `DIRECTORY_DISCOVERY.TUNABLES.MAX_PAGES_PER_SOURCE`
  - `DIRECTORY_DISCOVERY.TUNABLES.DETAIL_FETCH.ALLOW_INTERNAL_DETAIL_FETCH`
  - `LINK_FOLLOW.ALLOW_EXTERNAL_DOMAINS`
- Benefit: reduces configuration hallucination and false operator expectations.

4. Align ATS pipeline counters with shared run semantics.
- In `runLeverPipeline` and `runGreenhousePipeline`, increment `acc.counters.offers_fetched` from fetched/hydrated totals (same convention as `runOfferBatchIngestion`).
- Benefit: consistent observability across ingestion routes.

5. Hardening: move `(company_id, provider)` uniqueness into schema.
- Add DB unique index for `company_sources(company_id, provider)` and keep repo upsert logic as deterministic adapter.
- Benefit: removes race window from app-level uniqueness assumptions.

## Compliance notes vs `docs/project-layout.md`

- Positive:
  - Canonical offer model boundary is respected (`src/types/clients/job_offers.ts` + provider mappers).
  - Clients do not write DB; repos are used by ingestion/orchestration layers.
- Violations relevant to this block:
  - No-relative-import rule is still violated in scoped non-barrel modules (`docs/project-layout.md:30`; examples in `src/companySources/catalonia/cataloniaSource.ts`, `src/companySources/lanzadera/lanzaderaSource.ts`, `src/atsDiscovery/atsDiscoveryService.ts`, `src/ingestion/ingestOffers.ts`, `src/ingestion/offerPersistence.ts`, `src/clients/lever/leverAtsJobOffersClient.ts`, `src/clients/greenhouse/greenhouseAtsJobOffersClient.ts`).
  - "No logic-file types" rule is violated in scoped logic files (e.g., `src/atsDiscovery/runAtsDiscoveryBatch.ts` defines `type BatchCounters`; ATS client files define local `type`/`interface` configs), conflicting with `docs/project-layout.md:41`.

## Optional compile check
- Not run for this audit (`npx tsc --noEmit --project tsconfig.json` was optional).
