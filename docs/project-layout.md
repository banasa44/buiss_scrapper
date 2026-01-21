# Project Layout Decision (MVP) — Single Package Modular

## Decision

We will use a **single-package Node.js + TypeScript** repository (one `package.json`) with a **modular `src/` layout**.
No monorepo tooling for MVP.

## Why

- One executable pipeline (InfoJobs → DB → scoring → Sheets) is easiest to maintain as a single package.
- Clear separation of concerns is achieved via directories, without monorepo overhead.
- If the project ever grows into multiple executables, we can later split into a monorepo with minimal refactor.

## Import/Export Conventions

- **Path alias:** `@/` points to `src/` (clean imports).
  - **Configured in `tsconfig.json`** via `baseUrl`/`paths`.
  - **Runtime (dev/prod for MVP):** execute with `ts-node` + `tsconfig-paths/register` so Node resolves `@/...` imports.
- **Barrel exports:** each directory can expose a public surface via `index.ts` (no deep imports unless needed).

## Types / Contracts

- Centralized shared types live in: `src/types/`
- Module-specific types may live inside the module if they are not shared.

## Minimal folder layout (no empty folders unless used)

src/
index.ts # entrypoint (runner)
types/ # shared types/contracts
config/ # runtime config loader
connectors/ # InfoJobs and future sources
infojobs/
index.ts
db/ # SQLite + migrations + repos
index.ts
core/ # matching + scoring + aggregation logic
index.ts
exporters/ # Google Sheets exporter
sheets/
index.ts

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

## Notes

- DB is the system of record; Sheets is an export/view.
- Prefer small modules with clear responsibility boundaries over premature framework decisions.
