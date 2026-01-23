# [ITEST] Add DB migration smoke test

## Objective

Add a minimal integration test that verifies migrations can run on a fresh DB.

## Test behavior (offline)

- Create a temporary DB instance (file-based SQLite or test Postgres schema, depending on chosen DB).
- Run migrations.
- Assert:
  - expected tables exist
  - a trivial query succeeds

## Constraints

- No network calls to InfoJobs.
- Keep runtime fast.
- Clean up temp DB after test.

## Acceptance criteria

- Test passes locally and in CI (if CI exists).
- Fails clearly if migrations break.
