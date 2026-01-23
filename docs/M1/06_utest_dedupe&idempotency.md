# [UTEST] Add dedupe/idempotency tests

## Objective

Prove that ingestion is idempotent and respects identity rules.

## Must-use inputs

- Use ingestion functions from “[BUILD] Implement ingestion and dedupe”.
- Use a local test DB or an in-memory variant supported by your DB tooling.

## Tests to include (minimum)

1. Offer idempotency

- Given the same offer (same provider + providerOfferId) ingested twice:
  - expect only one offer row
  - expect second ingestion reports “updated” or “skipped” deterministically

2. Offer update

- Ingest offer v1, then offer v2 with updated fields:
  - expect row updated (e.g., updatedAt/title/metadata changes applied)

3. Company identity

- With company.id present:
  - offers attach to same company row
- Without company.id, same normalized company.name:
  - attaches to same company row (per identity rules)

4. Bad record isolation

- One malformed offer in batch:
  - ingestion continues for the rest
  - skipped count increments

## Acceptance criteria

- Tests do not call external APIs.
- Tests are deterministic.
- Clear assertions on inserted/updated/skipped outcomes.
