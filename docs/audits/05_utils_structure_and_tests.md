# Phase 5 Audit — Utils, Structure, Tests

**Utils audit (per file)**
- `src/utils/catalogValidation.ts`: Purpose is catalog JSON validation and invariant enforcement; exports `validateCatalogRaw` and `CatalogValidationError`; cohesion is high but catalog-specific rather than general-purpose. (`src/utils/catalogValidation.ts:validateCatalogRaw`)
- `src/utils/textNormalization.ts`: Purpose is normalization/tokenization for matching/repost; exports `normalizeToTokens`; cohesion is high and used across catalog/matcher/repost. (`src/utils/textNormalization.ts:normalizeToTokens`)
- `src/utils/companyIdentity.ts`: Purpose is company identity normalization and URL/domain handling; exports `normalizeCompanyName`, `extractWebsiteDomain`, `pickCompanyWebsiteUrl`; cohesion is medium because `pickCompanyWebsiteUrl` encodes InfoJobs-specific precedence. (`src/utils/companyIdentity.ts:normalizeCompanyName`, `src/utils/companyIdentity.ts:extractWebsiteDomain`, `src/utils/companyIdentity.ts:pickCompanyWebsiteUrl`)
- `src/utils/sheetsHelpers.ts`: Purpose is A1 range utilities for Sheets; exports `colIndexToLetter`, `extractMetricSlice`, `buildMetricUpdateRange`; cohesion is high but strictly Sheets-specific. (`src/utils/sheetsHelpers.ts:colIndexToLetter`, `src/utils/sheetsHelpers.ts:extractMetricSlice`, `src/utils/sheetsHelpers.ts:buildMetricUpdateRange`)
- `src/utils/sheetsParsing.ts`: Purpose is parsing/validation of sheet cell values; exports `parseCompanyId`, `parseResolution`; cohesion is high and Sheets-specific. (`src/utils/sheetsParsing.ts:parseCompanyId`, `src/utils/sheetsParsing.ts:parseResolution`)
- `src/utils/index.ts`: Barrel exports all utils, which makes domain-specific helpers globally available and less discoverable by feature. (`src/utils/index.ts`)

**Cross-domain overlaps and duplication**
- Diacritics stripping exists in both `normalizeCompanyName` and `normalizeToTokens`; they use similar NFD + diacritic removal logic but live in separate files with no shared helper. (`src/utils/companyIdentity.ts:normalizeCompanyName`, `src/utils/textNormalization.ts:normalizeToTokens`)
- Timestamp priority policies differ across domains: `computeEffectiveSeenAt` uses updatedAt > publishedAt > now, aggregation uses publishedAt > updatedAt, and repost detection uses lastSeenAt > publishedAt > updatedAt. These differences are intentional but easy to confuse without a shared policy note. (`src/ingestion/offerPersistence.ts:computeEffectiveSeenAt`, `src/signal/aggregation/aggregateCompany.ts:getOfferTimestamp`, `src/signal/repost/repostDetection.ts:getMostRecentTimestamp`)
- Sheets helpers/parsers are feature-specific yet live in global utils; this matches earlier Phase 4 note about separating pure mapping from IO. (`src/utils/sheetsHelpers.ts`, `src/utils/sheetsParsing.ts`, `docs/audits/04_integrations_infojobs_and_sheets.md`)

**Utils organization recommendation**
- Recommend Option A: minimal subdirectories inside `src/utils` to group domain-specific helpers without moving them into feature folders. This preserves the current structure while improving discoverability and ownership boundaries. (`src/utils/index.ts`)

**High-value subdirectory additions (up to 5)**
1. `src/utils/sheets/`: What goes there: `sheetsHelpers.ts`, `sheetsParsing.ts`. Why it helps: keeps Sheets-specific logic together and reduces global utils noise. Why not over-engineering: only two files, directly aligned to one feature. (`src/utils/sheetsHelpers.ts`, `src/utils/sheetsParsing.ts`)
2. `src/utils/text/`: What goes there: `textNormalization.ts` and any future normalization primitives. Why it helps: groups tokenization and string normalization used by matcher/repost/catalog. Why not over-engineering: currently one file with clear future growth. (`src/utils/textNormalization.ts`)
3. `src/utils/identity/`: What goes there: `companyIdentity.ts`. Why it helps: makes identity resolution helpers discoverable and separates them from generic text processing. Why not over-engineering: a single, cohesive domain with stable APIs. (`src/utils/companyIdentity.ts`)
4. `src/catalog/validation/`: What goes there: `catalogValidation.ts`. Why it helps: co-locates catalog-specific validation with catalog loading/compilation. Why not over-engineering: catalog already has its own module; this keeps catalog-specific rules out of global utils. (`src/utils/catalogValidation.ts`, `src/catalog/loader.ts`)
5. `src/sheets/plans/`: What goes there: `exportPlanner.ts` and any future "update plan" builders. Why it helps: separates pure planning/mapping from IO in sheets flows (aligns with Phase 4 maintainability note). Why not over-engineering: only one existing planner and one likely counterpart. (`src/sheets/exportPlanner.ts`, `docs/audits/04_integrations_infojobs_and_sheets.md`)

**Coverage matrix (domain → tests → missing)**
| Domain area | Tests | Missing |
| --- | --- | --- |
| Catalog validation/loader | None | Unit tests for validation errors and compile-time failures (see Phase 2 gap). (`src/utils/catalogValidation.ts`, `src/catalog/loader.ts`, `docs/audits/02_signal_correctness.md`) |
| Text normalization | `tests/unit/textNormalization.test.ts` | None obvious in current scope. |
| Company identity helpers | `tests/unit/companyIdentity.test.ts` | None obvious in current scope. |
| Sheets helpers/parsers | `tests/unit/sheets.updateMetrics.test.ts`, `tests/unit/sheets.sheetReaderParsing.test.ts` | No tests for IO flows or plan + IO interactions (see Phase 3/4 gaps). (`src/sheets/*`, `docs/audits/03_orchestration_and_aggregation.md`, `docs/audits/04_integrations_infojobs_and_sheets.md`) |
| Sheets row mapping | `tests/unit/sheets.companyRowMapper.test.ts` | No tests for `exportPlanner` planning output. (`src/sheets/exportPlanner.ts`) |
| Matcher/Scorer/Negation | `tests/unit/matcher.keywords.test.ts`, `tests/unit/matcher.phrases.test.ts`, `tests/unit/scorer.test.ts`, `tests/unit/negation.test.ts` | Phrase tier weighting remains untested (see Phase 2). (`docs/audits/02_signal_correctness.md`) |
| Repost detection/fingerprint | `tests/unit/repostDetection.test.ts`, `tests/unit/offerFingerprint.test.ts`, `tests/integration/db/fingerprint_repost_detection.test.ts`, `tests/e2e/repost_detection_real.e2e.test.ts` | No tests for repost detection when match persistence fails (see Phase 3). (`docs/audits/03_orchestration_and_aggregation.md`) |
| Aggregation (pure + persistence) | `tests/unit/aggregateCompany.test.ts`, `tests/integration/db/aggregateCompanyAndPersist.test.ts`, `tests/e2e/ingestion_to_aggregation.e2e.test.ts` | No tests for aggregation retry path (see Phase 3). (`docs/audits/03_orchestration_and_aggregation.md`) |
| Ingestion flow | `tests/integration/db/offer_ingestion_idempotency.test.ts`, `tests/e2e/bad_record_skipped.e2e.test.ts`, `tests/e2e/ingestion_to_aggregation.e2e.test.ts` | No tests for run counter persistence (see Phase 1). (`docs/audits/01_db_and_persistence.md`) |
| InfoJobs mapping/client | `tests/unit/infojobs.mappers.test.ts`, `tests/e2e/infojobs_offline.test.ts`, `tests/e2e/infojobs_pipeline_offline_db.test.ts` | No tests for pagination truncation/error paths (see Phase 4). (`docs/audits/04_integrations_infojobs_and_sheets.md`) |
| HTTP client | None | Retry/timeout behavior tests (see Phase 4). (`docs/audits/04_integrations_infojobs_and_sheets.md`) |
| Google Sheets client/sync | None | E2E or unit tests for Sheets read/append/update and sync error aggregation (see Phase 3/4). (`docs/audits/03_orchestration_and_aggregation.md`, `docs/audits/04_integrations_infojobs_and_sheets.md`) |

**Highest ROI missing tests (recommendations)**
- `tests/unit/catalogValidation.test.ts`: validate duplicate IDs, invalid tiers, and missing category references in `validateCatalogRaw`; also verify compile-time errors for empty alias/phrase tokens. (`src/utils/catalogValidation.ts:validateCatalogRaw`, `src/catalog/loader.ts:compileCatalog`, see Phase 2 gap)
- `tests/unit/httpClient.retry.test.ts`: simulate retryable status codes and `Retry-After` headers to assert backoff, attempt counts, and final error behavior. (`src/clients/http/httpClient.ts:httpRequest`, `src/constants/clients/http.ts`)
- `tests/unit/googleSheetsClient.retry.test.ts`: stub fetch to return 429/5xx and assert retry attempts and error details propagation. (`src/clients/googleSheets/googleSheetsClient.ts:apiRequest`, `src/constants/clients/googleSheets.ts`)
- `tests/unit/sheets.syncCompaniesToSheet.test.ts`: use a fake `GoogleSheetsClient` to assert append+update error aggregation and `ok` semantics without hitting external APIs. (`src/sheets/syncCompaniesToSheet.ts:syncCompaniesToSheet`)
- `tests/unit/exportPlanner.test.ts`: ensure `buildExportPlan` returns mapped rows and skips invalid company mappings without throwing. (`src/sheets/exportPlanner.ts:buildExportPlan`)
- `tests/integration/db/runLifecycleCounters.test.ts`: ensure run counters are persisted (or explicitly not) when `runOfferBatchIngestion` completes, per Phase 1 finding. (`src/ingestion/runOfferBatch.ts:runOfferBatchIngestion`, `src/ingestion/runLifecycle.ts:withRun`, `docs/audits/01_db_and_persistence.md`)
