# Audit Overview

**Architecture Summary**
- Fact: Runtime entrypoint is `src/main.ts` and `package.json` runs it via `ts-node` in `npm run dev` and `dist/main.js` in `npm start`. (`src/main.ts`, `package.json`)
- Fact: `src/main.ts` only initializes `InfoJobsClient` and logs; it does not call any ingestion pipeline yet. (`src/main.ts`)
- Fact: The InfoJobs pipeline entrypoint is `runInfojobsPipeline` in `src/ingestion/pipelines/infojobs.ts`, which fetches offers via `InfoJobsClient` and passes them to `runOfferBatchIngestion`. (`src/ingestion/pipelines/infojobs.ts`, `src/ingestion/runOfferBatch.ts`)
- Fact: Ingestion orchestration layers are in `src/ingestion/` and call DB repos, signal matching/scoring, and optional Sheets sync. (`src/ingestion/*.ts`, `src/sheets/*.ts`)
- Fact: Signal detection (matcher/scorer/aggregation/repost) lives under `src/signal/` and depends on catalog runtime types, constants, and utils. (`src/signal/*`, `src/catalog/loader.ts`, `src/constants/*`, `src/utils/*`)
- Fact: Catalog load/validation/compile is in `src/catalog/loader.ts` and reads the JSON path defined in `src/constants/catalog.ts` (`data/catalog.json`). (`src/catalog/loader.ts`, `src/constants/catalog.ts`)
- Fact: DB layer uses SQLite with migrations and thin repos under `src/db/`, referenced by ingestion and aggregation. (`src/db/*`, `src/db/repos/*`, `migrations/*`)
- Fact: Google Sheets integration is implemented via `GoogleSheetsClient` and sheets orchestration under `src/sheets/`. (`src/clients/googleSheets/*`, `src/sheets/*`)
- Fact: Test layers are organized into unit, integration, and e2e suites with fixtures/helpers, aligned to the documented testing strategy. (`tests/unit/*`, `tests/integration/*`, `tests/e2e/*`, `tests/fixtures/*`, `tests/helpers/*`, `docs/testing_strategy.md`, `vitest.config.ts`)
- Assumption: The intended production run path is to invoke `runInfojobsPipeline` from `src/main.ts`, but that wiring is not present yet. (`src/main.ts`, `src/ingestion/pipelines/infojobs.ts`)

**Module Map**
- `src/main.ts`: CLI/runtime entrypoint; loads env and constructs `InfoJobsClient`. (`src/main.ts`)
- `src/clients/`: External integrations and HTTP primitives.
- `src/clients/infojobs/`: InfoJobs API client and mappers. (`src/clients/infojobs/*`)
- `src/clients/googleSheets/`: Google Sheets API client and auth/retry logic. (`src/clients/googleSheets/*`)
- `src/clients/http/`: Generic HTTP request wrapper and error type. (`src/clients/http/*`)
- `src/ingestion/`: Run lifecycle, offer ingestion, batch orchestration, pipelines. (`src/ingestion/*`)
- `src/signal/`: Keyword matcher, scorer, repost detection, and company aggregation. (`src/signal/*`)
- `src/catalog/`: Catalog loader and runtime compilation. (`src/catalog/*`)
- `src/db/`: SQLite connection, migrations runner, and repos. (`src/db/*`, `src/db/repos/*`, `migrations/*`)
- `src/sheets/`: Sheet reading/mapping, append/update, sync orchestration. (`src/sheets/*`)
- `src/utils/`: Normalization, identity, catalog validation, sheets parsing/helpers. (`src/utils/*`)
- `src/constants/`: Config and tunables for clients, scoring, sheets, negation, etc. (`src/constants/*`)
- `src/types/`: Canonical domain types and client-normalized types. (`src/types/*`)
- `src/interfaces/`: Behavioral contracts such as `JobOffersClient`. (`src/interfaces/*`)
- `src/logger/`: Logger implementation and barrel. (`src/logger/*`)
- `tests/unit/`: Pure logic tests for matcher/scorer/normalization/sheets parsing. (`tests/unit/*`)
- `tests/integration/`: Real DB tests for repos/ingestion idempotency. (`tests/integration/*`)
- `tests/e2e/`: Offline pipeline tests with mocked HTTP + real DB. (`tests/e2e/*`, `tests/fixtures/*`)

**Dependency Sketch (Major Edges)**
- `src/main.ts` → `src/clients/infojobs/*` → `src/clients/http/*`, `src/constants/clients/*`, `src/types/*`, `src/logger/*`. (`src/main.ts`, `src/clients/infojobs/infojobsClient.ts`)
- `src/ingestion/pipelines/infojobs.ts` → `src/clients/infojobs/*`, `src/ingestion/runOfferBatch.ts`, `src/constants/clients/infojobs.ts`. (`src/ingestion/pipelines/infojobs.ts`)
- `src/ingestion/runOfferBatch.ts` → `src/ingestion/ingestOffers.ts`, `src/ingestion/aggregateCompanies.ts`, `src/sheets/*`, `src/clients/googleSheets/*`, `src/catalog/loader.ts`, `src/constants/clients/googleSheets.ts`. (`src/ingestion/runOfferBatch.ts`)
- `src/ingestion/ingestOffers.ts` → `src/ingestion/offerPersistence.ts`, `src/db/*`, `src/catalog/loader.ts`, `src/signal/matcher/*`, `src/signal/scorer/*`. (`src/ingestion/ingestOffers.ts`)
- `src/signal/aggregation/*` → `src/db/repos/*`, `src/signal/aggregation/*` pure logic. (`src/signal/aggregation/aggregateCompanyAndPersist.ts`)
- `src/sheets/*` → `src/clients/googleSheets/*`, `src/db/*`, `src/utils/*`, `src/constants/sheets.ts`. (`src/sheets/*`)
- `src/catalog/loader.ts` → `src/utils/catalogValidation.ts`, `src/utils/textNormalization.ts`, `src/constants/catalog.ts`. (`src/catalog/loader.ts`)

**Likely Hot Spots**
- `src/signal/`: Core matching/scoring logic with nested loops and scoring weights; high risk for subtle correctness regressions. (`src/signal/matcher/matcher.ts`, `src/signal/scorer/scorer.ts`)
- `src/ingestion/aggregateCompanies.ts`: Inline retry/size constants (`CHUNK_SIZE`, `MAX_RETRIES`, `RETRY_DELAY_MS`) may be candidates for centralized tunables. (`src/ingestion/aggregateCompanies.ts`)
- `src/sheets/`: Parsing/mapping/update logic spans multiple files and touches external data; likely to accumulate edge-case logic. (`src/sheets/*`, `src/utils/sheetsParsing.ts`, `src/utils/sheetsHelpers.ts`)
- `src/utils/`: Multiple domains (normalization, identity, sheets parsing); risk of overgrowth and duplication. (`src/utils/*`)
- `src/clients/googleSheets/`: Custom retry/backoff/auth logic can be complex and brittle. (`src/clients/googleSheets/googleSheetsClient.ts`)

**Audit Scope Boundaries**
- In scope: `src/**`, `tests/**`, `migrations/**`, `docs/**` (for design/testing rules), and project configs (`package.json`, `tsconfig*.json`, `vitest.config.ts`).
- Out of scope (unless explicitly requested): build artifacts and runtime data (`dist/**`, `data/**`), third-party code (`node_modules/**`), editor configs (`.vscode/**`).

**Potential Doc/Convention Gaps (Observed)**
- Fact: `docs/project-layout.md` mandates no relative imports, but multiple modules use relative imports (for example `src/ingestion/ingestOffers.ts` and `src/sheets/index.ts`). (`docs/project-layout.md`, `src/ingestion/ingestOffers.ts`, `src/sheets/index.ts`)
- Fact: `README.md` lists future folders (`config/`, `core/`, `exporters/`) that do not exist under `src/` today. (`README.md`, `src/`)
- Fact: No ESLint/Prettier configuration or dependencies are declared in `package.json`. (`package.json`)
