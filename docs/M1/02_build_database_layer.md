# [BUILD] Set up database layer

## Objective

Implement the DB infrastructure to apply migrations and run queries safely.

## Must-use inputs

- Use the schema defined in “[DEFINE] Define minimal DB schema”.

## Scope

- Choose and integrate one DB library/ORM/query builder (minimal surface area).
- Implement:
  - connection initialization
  - migrations runner (CLI/script)
  - repository/query layer boundary (minimal)

## Constraints

- No mocks unless requested.
- No unused abstractions.
- Avoid heavy DI frameworks unless already used.

## Deliverables

1. DB connection module (single entrypoint used by the app)
2. Migration tooling:
   - `npm run db:migrate` (or repo convention)
   - `npm run db:status` (optional)
3. Minimal repository scaffolding:
   - `CompaniesRepo`
   - `OffersRepo`
   - (optional) `RunsRepo` if you included runs tables
4. Configuration:
   - connection string / file path from env vars
   - safe defaults for local dev

## Acceptance criteria

- `npm run db:migrate` creates the schema from scratch on an empty DB.
- App can start and perform a trivial query (e.g., SELECT 1) without crashing.
- No business logic in repos (only data access).
