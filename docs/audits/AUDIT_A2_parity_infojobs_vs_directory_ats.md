# AUDIT A2 — Parity: InfoJobs route vs Directory→ATS route (DB/scoring/dedupe)

Mandatory pre-step completed: `docs/project-layout.md` was re-opened and followed (`docs/project-layout.md:1-187`).

## 1) Canonical contract

### 1.1 What fields are required to persist an offer?

1. Ingestion accepts canonical offers as `JobOfferSummary | JobOfferDetail` (`src/types/ingestion.ts:58-60`, `src/types/ingestion.ts:81-84`).
2. `persistOffer()` maps canonical offer data to `OfferInput` (`src/ingestion/offerPersistence.ts:81-108`).
3. DB-required `offers` fields are: `provider`, `provider_offer_id`, `company_id`, `title` (all `NOT NULL`) plus unique `(provider, provider_offer_id)` (`migrations/0002_company_sources_and_global_companies.sql:100-121`).
4. Repo upsert uses that same unique key and overwrites existing row content (`src/db/repos/offersRepo.ts:22-53`).
5. ATS-only rule: non-empty `description` is required for providers in `ATS_PROVIDERS = ["lever", "greenhouse"]`; otherwise offer is skipped as `missing_description` (`src/constants/atsDiscovery.ts:11`, `src/ingestion/offerPersistence.ts:134-151`).
6. Non-ATS (e.g., InfoJobs) does not enforce description presence in `persistOffer` (`src/ingestion/offerPersistence.ts:134-151`).
7. Company binding requirements:
- If `companyId` is provided (ATS route), it is used directly (`src/ingestion/offerPersistence.ts:153-163`).
- Otherwise, company identity must be derivable (`website_domain` or `normalized_name`) through `persistCompanyAndSource`; if not, offer is skipped (`src/ingestion/offerPersistence.ts:165-179`, `src/ingestion/companyPersistence.ts:55-67`, `src/ingestion/companyPersistence.ts:116-127`).

### 1.2 What fields are required to score an offer?

1. Scoring is only attempted in `ingestOffers()` when runtime object has a `description` property key (`"description" in offer`) (`src/ingestion/ingestOffers.ts:88-94`).
2. `matchOffer()` uses `title` and `description` text; description contributes only if present (`src/signal/matcher/matcher.ts:205-225`).
3. `scoreOffer()` consumes `MatchResult`, applies weights/thresholds, and produces `score` + explanations (`src/signal/scorer/scorer.ts:148-202`, `src/constants/scoring.ts:21-77`).
4. Scoring persistence requires `matches.offer_id`, `score`, and `matched_keywords_json` (`src/db/repos/matchesRepo.ts:19-37`, `migrations/0002_company_sources_and_global_companies.sql:153-160`).
5. Unscored offers still participate in aggregation via `LEFT JOIN matches` with `COALESCE(score, 0)` (`src/db/repos/offersRepo.ts:304-321`, `src/db/repos/offersRepo.ts:315`).

## 2) Route comparison table

| Requirement | InfoJobs route | Directory→ATS route | Status |
|---|---|---|---|
| Canonical model input type | `runInfojobsPipeline` passes `searchResult.offers` into `runOfferBatchIngestion` (`src/ingestion/pipelines/infojobs.ts:66-71`). `searchOffers()` returns `SearchOffersResult.offers: JobOfferSummary[]` (`src/types/clients/job_offers.ts:178-180`, `src/clients/infojobs/infojobsClient.ts:247-425`). | Lever/Greenhouse pipelines pass hydrated detail offers into `ingestOffers` (`src/ingestion/pipelines/lever.ts:90-111`, `src/ingestion/pipelines/greenhouse.ts:90-111`). | `OK` (both canonical), but different richness. |
| Offer DB shape / unique key | Uses `persistOffer` → `upsertOffer` with unique `(provider, provider_offer_id)` (`src/ingestion/ingestOffers.ts:54`, `src/db/repos/offersRepo.ts:22-53`). | Same path: `persistOffer` → `upsertOffer` (`src/ingestion/pipelines/lever.ts:105-111`, `src/ingestion/pipelines/greenhouse.ts:105-111`, `src/db/repos/offersRepo.ts:22-53`). | `OK` |
| Description required | Not required for `infojobs` (ATS-only gate does not apply) (`src/ingestion/offerPersistence.ts:134-151`). InfoJobs list mapper does not include `description` field (`src/clients/infojobs/mappers.ts:114-138`). | Required for ATS providers (`lever`, `greenhouse`) and missing descriptions are skipped (`src/constants/atsDiscovery.ts:11`, `src/ingestion/offerPersistence.ts:134-151`). | `Mismatch` (provider-specific policy). |
| Repost dedupe logic | Uses same repost flow in `persistOffer`: existing-id short-circuit + fingerprint + fallback similarity dedupe (`src/ingestion/offerPersistence.ts:204-344`). But fingerprint needs title+description (`src/signal/repost/offerFingerprint.ts:56-68`), and similarity fallback needs description (`src/signal/repost/repostDetection.ts:101-108`). | Same repost flow with same functions; ATS offers generally include description so full dedupe paths are available (`src/ingestion/offerPersistence.ts:231-344`, `src/clients/lever/mappers.ts:113-119`, `src/clients/greenhouse/mappers.ts:105-112`). | `Mismatch` in practical dedupe strength (same code, different inputs). |
| Idempotent re-run (offers row count stability) | Upsert semantics by unique provider-offer key (`src/db/repos/offersRepo.ts:22-53`). | Same upsert semantics; offline flow test explicitly asserts second-run row count unchanged (`tests/integration/flows/directory_to_ats.offline.test.ts:241-245`). | `OK` |
| Company identity resolution | Marketplace path: derive identity from offer company (`persistCompanyAndSource`), requiring domain or normalized name (`src/ingestion/offerPersistence.ts:165-179`, `src/ingestion/companyPersistence.ts:55-67`). | Directory step first upserts `companies` directly (`src/companySources/ingestDirectorySources.ts:120-123`), then ATS ingestion uses known `companyId` from `company_sources` (`src/ingestion/pipelines/lever.ts:66-68`, `src/ingestion/offerPersistence.ts:156-163`). | `OK` (different mechanism, same target tables). |
| Offer→company association | Offer-level discovery: company created/linked during offer persistence (`src/ingestion/offerPersistence.ts:165-182`, `src/ingestion/companyPersistence.ts:129-141`). | Pre-linked by ATS discovery + `company_sources`; offer persistence uses provided `companyId` (`src/atsDiscovery/persistDiscoveryResult.ts:34-41`, `src/ingestion/pipelines/lever.ts:66-68`, `src/ingestion/offerPersistence.ts:156-163`). | `OK` |
| Scoring trigger executed | Current path passes summaries from list endpoint; scoring gate in `ingestOffers` requires `description` property key, so summary objects skip scoring branch (`src/clients/infojobs/mappers.ts:114-138`, `src/ingestion/ingestOffers.ts:88-94`). | ATS pipelines hydrate to `JobOfferDetail` then ingest; scoring branch executes for persisted offers (`src/ingestion/pipelines/lever.ts:89-111`, `src/ingestion/pipelines/greenhouse.ts:89-111`, `src/ingestion/ingestOffers.ts:88-101`). | `Mismatch` |
| Match persistence (`matches` table) | In current implementation, likely sparse/absent for InfoJobs list-only ingestion because scoring branch is skipped (`src/ingestion/ingestOffers.ts:88-101`, `src/clients/infojobs/mappers.ts:114-138`). | `upsertMatch` is executed for scored ATS offers (`src/ingestion/ingestOffers.ts:96-101`, `src/db/repos/matchesRepo.ts:19-37`). | `Mismatch` |
| Company aggregation invocation | `runOfferBatchIngestion` always calls `aggregateCompaniesAndPersist` after ingestion (`src/ingestion/runOfferBatch.ts:75-78`). | Lever/Greenhouse pipelines call `aggregateCompaniesAndPersist` at end (`src/ingestion/pipelines/lever.ts:139-143`, `src/ingestion/pipelines/greenhouse.ts:139-143`). | `OK` |
| Directory seed writes | N/A | Directory ingestion writes only `companies` and explicitly does **not** write `company_sources` (`src/companySources/ingestDirectorySources.ts:4-8`, `src/companySources/ingestDirectorySources.ts:120-123`). `company_sources` for ATS are written by discovery (`src/atsDiscovery/persistDiscoveryResult.ts:34-41`). | `OK` (staged flow). |
| Production route wiring | InfoJobs operational runner exists via `runnerMain` (`src/runnerMain.ts:31-43`), but package scripts default to `main.ts` which does not run pipeline (`package.json:7-9`, `src/main.ts:5-13`). | Directory→ATS sequence appears in tests and ATS modules, but `ingestDirectorySources` is not called from `src/**` orchestration entrypoints (`rg -n "ingestDirectorySources\(" src tests`; `src/companySources/ingestDirectorySources.ts:49`). | `Mismatch`/wiring gap |

## 3) Downstream scoring trigger

### InfoJobs route (legacy)

Current chain:
1. `runInfojobsPipeline()` fetches list offers and calls `runOfferBatchIngestion(provider, offers)` (`src/ingestion/pipelines/infojobs.ts:56-71`).
2. `runOfferBatchIngestion()` calls `ingestOffers()` (`src/ingestion/runOfferBatch.ts:67-73`).
3. `ingestOffers()` only scores when `"description" in offer` (`src/ingestion/ingestOffers.ts:88-94`).
4. InfoJobs list mapper returns `JobOfferSummary` without `description` (`src/clients/infojobs/mappers.ts:114-138`).

Result: scoring path (`matchOffer`/`scoreOffer`/`upsertMatch`) is not triggered for current InfoJobs list-only ingestion.

### Directory→ATS route

Observed/inferred chain from modules and integration flow:
1. Directory companies ingested into `companies` (`src/companySources/ingestDirectorySources.ts:120-123`, `tests/integration/flows/directory_to_ats.offline.test.ts:164-173`).
2. ATS discovery finds tenants and persists `company_sources` (`src/atsDiscovery/runAtsDiscoveryBatch.ts:66-74`, `src/atsDiscovery/persistDiscoveryResult.ts:34-41`, `tests/integration/flows/directory_to_ats.offline.test.ts:175-186`).
3. Lever/Greenhouse pipelines hydrate to detail offers and call `ingestOffers` (`src/ingestion/pipelines/lever.ts:89-111`, `src/ingestion/pipelines/greenhouse.ts:89-111`).
4. `ingestOffers` triggers scoring + `upsertMatch` for these offers (`src/ingestion/ingestOffers.ts:88-101`).
5. Aggregation runs and persists company signals (`src/ingestion/pipelines/lever.ts:139-146`, `src/ingestion/pipelines/greenhouse.ts:139-146`, `src/signal/aggregation/aggregateCompanyAndPersist.ts:37-63`).

Result: scoring and aggregation are actively exercised for ATS offers.

## 4) Findings

1. **Likely bug/parity break:** InfoJobs route currently does not trigger scoring/match persistence because it ingests list summaries only.
- Evidence: summary-only mapping (`src/clients/infojobs/mappers.ts:114-138`), scoring gate (`src/ingestion/ingestOffers.ts:88-94`), list-only pipeline fetch (`src/ingestion/pipelines/infojobs.ts:56-59`).

2. **Likely intended but consequential difference:** ATS route enforces non-empty description, InfoJobs route does not.
- Evidence: ATS-only check in `persistOffer` (`src/ingestion/offerPersistence.ts:134-151`), ATS providers constant (`src/constants/atsDiscovery.ts:11`).
- Effect: quality floor differs by provider.

3. **Practical dedupe quality mismatch:** same repost code, but InfoJobs often lacks description, reducing fingerprint/similarity dedupe opportunities.
- Evidence: fingerprint requires title+description (`src/signal/repost/offerFingerprint.ts:56-68`), similarity path requires incoming description (`src/signal/repost/repostDetection.ts:101-108`).

4. **Route-level orchestration gap:** full Directory→ATS sequence is demonstrated in tests but not wired through a production entrypoint.
- Evidence: sequence test (`tests/integration/flows/directory_to_ats.offline.test.ts:164-189`); no `ingestDirectorySources` calls in `src/**` orchestration (`rg -n "ingestDirectorySources\(" src tests`).

5. **Secondary parity gap:** InfoJobs path runs via `runOfferBatchIngestion` (includes Sheets sync/feedback branch), ATS pipelines use direct `withRun + ingestOffers + aggregate` and skip that wrapper.
- Evidence: InfoJobs path (`src/ingestion/pipelines/infojobs.ts:66-71`, `src/ingestion/runOfferBatch.ts:84-224`), ATS pipelines (`src/ingestion/pipelines/lever.ts:46-173`, `src/ingestion/pipelines/greenhouse.ts:46-173`).

## 5) Actionable recommendations (no implementation)

1. **Hydrate InfoJobs offers to detail before ingestion** (or add a detail-enrichment step in `runInfojobsPipeline`) so `ingestOffers` scoring path and match persistence run consistently.
2. **Unify provider pipelines behind one post-fetch ingestion wrapper** (or equivalent shared function) so Sheets/feedback and counters behavior is intentionally consistent across providers.
3. **Make scoring eligibility explicit and metricized** (e.g., count offers skipped from scoring due to missing description/property) to surface parity regressions early.
4. **Decide and document description policy across providers**: either enforce for all routes or explicitly keep provider-specific behavior with rationale.
5. **Add/enable a production orchestration path for Directory→ATS** (including DB init + lock + sequencing), since current sequence appears test-driven rather than entrypoint-driven.

---

Completion checklist:
- Report table is filled with evidence-backed references.
- No production code/tests were modified; only this audit markdown file was created.
