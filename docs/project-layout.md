# Project Layout Decision (MVP) — Single Package Modular

## Decision

We will use a **single-package Node.js + TypeScript** repository (one `package.json`) with a **modular `src/` layout**.
No monorepo tooling for MVP.

## Why

- One executable pipeline (InfoJobs → DB → scoring → Sheets) is easiest to maintain as a single package.
- Clear separation of concerns is achieved via directories, without monorepo overhead.
- If the project ever grows into multiple executables, we can later split into a monorepo with minimal refactor.

## Entrypoint Convention

- **Entrypoint:** `src/main.ts`
- **Rule:** `index.ts` files are **barrel exports only** (`export * from ...`), never executable entrypoints.

## Import/Export Conventions

- **Path alias:** `@/` points to `src/` (clean imports).
  - **Configured in `tsconfig.json`** via `baseUrl`/`paths`.
  - **Runtime (dev/prod for MVP):** execute with `ts-node` + `tsconfig-paths/register` so Node resolves `@/...` imports.
- **Barrel exports:** each directory can expose a public surface via `index.ts` (no deep imports unless needed).

## Types and Constants

- **Types** live under `src/types/` and are aggregated via `src/types/index.ts` (barrel exports only).  
  Rule: logic files should not start with large type blocks; prefer importing types from `@/types`.

- **Constants** (tables/mappings/tunable values we may want to adjust later) live under `src/constants/` and are aggregated via `src/constants/index.ts` (barrel exports only).  
  Rule: avoid large constant tables and “magic mapping” objects inside logic files; import them from `@/constants` instead.

- Small inline literals are fine, but anything that is a named mapping/config table should be placed in `src/constants/` for discoverability and consistency.

## Minimal Folder Layout (no empty folders unless used)

```
src/
  main.ts          # entrypoint (runner)
  types/           # shared types/contracts
  constants/       # tunable constants
  config/          # runtime config loader
  clients/         # external data sources (InfoJobs, etc.)
    infojobs/
      index.ts
  db/              # SQLite + migrations + repos
    index.ts
  core/            # matching + scoring + aggregation logic
    index.ts
  exporters/       # Google Sheets exporter
    sheets/
      index.ts
```

## Data flow (conceptual)

Config + Catalog
|
v
Runner -> InfoJobs Connector -> DB (offers/companies)
| |
v v
Matcher/Scorer -> DB (matches)
|
v
Aggregator -> DB (company aggregates)
|
v
Sheets Exporter -> Google Sheets (view)

## Clients / Connectors Convention

External data sources are implemented under `src/clients/`.

Each client is responsible **only** for:
- Authentication
- HTTP calls
- Pagination / rate-limit awareness
- Mapping raw payloads into normalized types

**Clients do not:**
- Write to DB
- Contain business logic

## Data Handling Rules (External APIs)

**No-throw policy for external data:**

For data coming from external APIs (e.g. InfoJobs payloads), the system must **never throw** due to a single malformed or incomplete record.

**Behavior:** log + skip item + continue.

`throw` is reserved **only** for:
- Missing/invalid configuration
- Authentication failures
- Fatal initialization errors

## Config & Tunables

Any tunable operational value (timeouts, retry counts, page caps, backoff delays, thresholds) must live in:
- `src/config/` or
- `src/constants/`

Avoid hardcoded "magic numbers" inside logic.

## No Placeholders / No Dead Code

Do not create empty folders, stubs, or placeholder implementations "for later".

**Implement code only when it is actually used.**

If intent must be recorded, use a `TODO:` comment instead of a stub file.

## Logs

We use a **micro-logger wrapper** (no external logging library for MVP). The wrapper standardizes log levels, allows basic filtering, and makes debugging easier without framework overhead.

- Implement a small logger module that wraps `console.*` and exposes:
  - `debug`, `info`, `warn`, `error`
- Support `LOG_LEVEL` (e.g. `debug | info | warn | error`) to filter output.

## Notes

- DB is the system of record; Sheets is an export/view.
- Prefer small modules with clear responsibility boundaries over premature framework decisions.
