# AUDIT 3 — Integration DB tests (schema realism + FK integrity)

Goal: confirm integration tests run with FK ON, apply migrations, and validate real persistence behavior.

## Findings

### 1) DB test helper (`tests/helpers/testDb.ts`)
- DB mode: **temp file on disk**, not `:memory:`. Uses `tmpdir()` + unique filename (`test-<timestamp>-<random>.db`).
- Migrations: **applied in sorted filename order**. `runMigrationsOnDb()` ensures `schema_migrations`, reads `migrations/*.sql`, and applies pending files inside a transaction per migration (`applyMigration`).
- Foreign keys: **explicitly enabled** via `db.pragma("foreign_keys = ON")` in both `createTestDb` and `createTestDbSync` before migrations.
- Cleanup: reliable; clears singleton (`setDbForTesting(null)`), closes DB, removes db file + `-wal`/`-shm` with `rmSync(..., { force: true })` and ignores errors.

### 2) Integration tests under `tests/integration/db`
- `tests/integration/db/harness.test.ts`
  - Verifies temp DB exists, migrations applied (`schema_migrations` has entries), repos work via singleton injection, and cleanup removes DB file.
  - No shortcuts observed; uses real migrations and real repos.
- `tests/integration/db/offer_ingestion_idempotency.test.ts`
  - Uses `createTestDbSync()` (FK ON + migrations applied). Exercises real ingestion pipeline against SQLite; asserts persisted state and idempotency via repo + direct SQL counts.
  - Validates overwrite semantics including nulling a field; checks counters in result.
- `tests/integration/db/aggregateCompanyAndPersist.test.ts`
  - Uses `createTestDbSync()` and explicitly re-enables `foreign_keys` (redundant but OK).
  - Seeds companies/offers/matches with explicit IDs, consistent FK ordering: companies → offers → matches.
  - Validates aggregated results and persistence to `companies`, idempotency, and handling of duplicate offers.
  - No disabled constraints; no FK bypass detected.

### 3) Migration 0002 fix check
- `migrations/0002_company_sources_and_global_companies.sql` includes **Step 7b** that renames `matches` to `matches_old`, recreates `matches` with FK to new `offers`, copies data, and drops old table. This explicitly addresses the FK reference problem after `offers` rename. (Lines 145–168)

## Confidence assessment
- **High** on DB realism: temp-file SQLite, real migrations, FK enabled at connection start, and test assertions check persisted state and idempotency using real repos/SQL.

## Schema/test risks
- **No negative FK enforcement tests**: there’s no test that attempts an invalid FK insert and asserts failure, so FK integrity is assumed rather than proven.
- **FK enforcement only on injected connection**: tests rely on `setDbForTesting` with a single connection that has FK ON. If any code path creates a new connection without PRAGMA, it would not be covered here.
- **No cascade behavior checks**: tests do not verify delete cascades (e.g., deleting offers removes matches), which could regress without detection.
