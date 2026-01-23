# [BUILD] Implement ingestion and dedupe

## Objective

Implement the write path that takes normalized offers and persists them idempotently.

## Must-use inputs

- Use DB schema + company identity rules from previous DEFINE tasks.
- Use normalized types: `JobOfferSummary`, `JobOfferDetail`.

## Scope

- Implement ingestion functions that:
  - Upsert company (based on identity rules)
  - Upsert offer (based on provider + providerOfferId unique constraint)
  - Optionally record run metadata if schema includes runs

## Key behaviors

- Idempotent re-run:
  - Re-ingesting the same offers must not create duplicates.
  - Updated fields should be updated (updatedAt changes).
- External data unreliable:
  - One bad record => log + skip, continue ingestion.
- Separate responsibilities:
  - Client fetches data
  - Ingestor persists data via repos
  - Mapping already done upstream

## Suggested API surface (example)

- `ingestOffers(offers: JobOfferSummary[], provider: Provider, runId?: string): IngestionResult`
- If detail fetching is part of ingestion:
  - keep it explicit and bounded (but MVP can ingest summaries first)

## Acceptance criteria

- Ingesting N offers twice results in:
  - same row counts after both runs
  - updated rows reflect new data when changes exist
- Logs show counts: inserted/updated/skipped + reasons
- No “half-done” code paths.
