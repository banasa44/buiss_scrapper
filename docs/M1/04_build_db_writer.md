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

# M1.4 — [BUILD] Implement ingestion and dedupe (safe reruns)

## Subtasks (execution order)

### M1.4-A — Define ingestion contract + run counters

Define the ingestion entrypoint signature(s), input shapes (normalized offers + optional details), and the exact counter semantics for `ingestion_runs` (what increments requests_count, http_429_count, errors_count, pages_fetched, offers_fetched).

### M1.4-B — Implement run lifecycle helpers

Implement `startRun()` / `finishRun()` / `incrementRunCounters()` using `runsRepo`, ensuring runs are always finalized (success/partial/failure) without crashing the whole process.

### M1.4-C — Implement company persistence (global) + provider source link

Given `JobOfferCompany` + provider context, upsert into `companies` (global identity via website_domain → normalized_name) and upsert into `company_sources` (provider-specific id/url/hidden/raw_json). Log+skip when identity evidence is insufficient.

### M1.4-D — Implement offer upsert (idempotent)

Upsert into `offers` by `(provider, provider_offer_id)` and update mutable fields safely (no magic numbers, no throws on single bad record). Ensure the offer references the resolved `company_id`.

### M1.4-E — **DEFERRED:** Store raw_json under a flag

**Status:** Deferred to future milestone.  
**M1 behavior:** `raw_json` must remain `null` for all ingestion operations.

### M1.4-F — Add idempotency + “bad record” tests

Add minimal tests to prove: (1) ingest same batch twice → no duplicates, (2) updated fields are updated, (3) one malformed record → logged + skipped, run completes.

## Non-goals (explicit)

- No matcher/scorer and no match-based gating here (belongs to M2).
- No pruning/cleanup policies here (can be added later once scoring exists).
- **No raw_json retention in M1:** All ingestion operations must use `raw_json = null`. Raw payload storage is deferred to future milestones.
