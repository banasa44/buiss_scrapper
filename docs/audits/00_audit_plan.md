# Audit Plan

**Phased Plan (Prioritized)**

**Phase 0 — Alignment And Conventions**
- Goal: Confirm current runtime wiring, architectural rules, and doc/code drift before deep review.
- Focus files/folders: `src/main.ts`, `src/ingestion/pipelines/*`, `docs/project-layout.md`, `README.md`, `tsconfig.json`, `vitest.config.ts`, `src/logger/*`, `src/constants/*`.
- Key checks: entrypoint wiring, import/alias conventions, logging usage, config constants location.

**Phase 1 — Data Integrity Core (DB + Persistence)**
- Goal: Validate schema, migrations, and idempotent upsert semantics that underpin ingestion reliability.
- Focus files/folders: `migrations/*`, `src/db/*`, `src/db/repos/*`, `src/ingestion/companyPersistence.ts`, `src/ingestion/offerPersistence.ts`, `src/ingestion/runLifecycle.ts`, `tests/integration/*`.
- Key checks: DB connection lifecycle, repo invariants, run tracking counters, migration coverage, idempotency tests.

**Phase 2 — Signal Correctness (Catalog, Matcher, Scorer, Repost)**
- Goal: Verify matching/scoring logic, catalog compilation, negation handling, and repost detection.
- Focus files/folders: `src/catalog/*`, `src/signal/*`, `src/constants/scoring.ts`, `src/constants/negation.ts`, `src/constants/repost.ts`, `src/utils/textNormalization.ts`, `tests/unit/*` (matcher/scorer/negation/repost).
- Key checks: tokenization boundaries, category caps, phrase boosts, negation gating, repost fingerprinting.

**Phase 3 — Orchestration & Aggregation Flow**
- Goal: Ensure end-to-end ingestion orchestration, aggregation, and counters behave as expected.
- Focus files/folders: `src/ingestion/ingestOffers.ts`, `src/ingestion/runOfferBatch.ts`, `src/ingestion/aggregateCompanies.ts`, `src/signal/aggregation/*`, `tests/e2e/*`.
- Key checks: error handling, accumulator counters, aggregation idempotency, performance limits.

**Phase 4 — External Integrations (InfoJobs + Sheets)**
- Goal: Review external client correctness, mapping, retry logic, and data contracts.
- Focus files/folders: `src/clients/infojobs/*`, `src/clients/http/*`, `src/constants/clients/*`, `src/clients/googleSheets/*`, `src/sheets/*`, `tests/e2e/*`, `tests/fixtures/*`.
- Key checks: request auth, pagination limits, mapper completeness, HTTP error handling, Sheets batch sizing.

**Phase 5 — Test Coverage & Gaps**
- Goal: Compare actual tests to testing strategy and identify missing high-risk cases.
- Focus files/folders: `docs/testing_strategy.md`, `tests/unit/*`, `tests/integration/*`, `tests/e2e/*`, `tests/helpers/*`, `tests/fixtures/*`.
- Key checks: coverage of failure modes, idempotency regression tests, fixture realism, pipeline wiring tests.

**Deliverables Per Phase**
- Summary of findings ranked by risk.
- Concrete follow-up tasks with file references.
- Noted assumption gaps or missing documentation.
