# M1.4-B — Implement run lifecycle helpers

## Goal

Track one SQLite `ingestion_runs` record per provider execution, and always finalize it.

## Definition: what is a "run"?

**One run = one end-to-end execution for a single provider**, including:

- `searchOffers(...)` (pagination inside the client)
- optional per-offer detail fetch (`getOfferById(...)`)
- DB upserts for companies/offers
- summary counters

Not one run per offer.

## API to implement

Create `src/ingestion/runLifecycle.ts` (or repo convention) with:

- `startRun(provider: Provider, query?: SearchOffersQuery): number`
  - inserts into `ingestion_runs`
  - `query_fingerprint` = `NULL` for now
  - returns `runId`

- `finishRun(runId: number, status: "success" | "failure", patch?: Partial<RunCounters>): void`
  - sets `finished_at = now`
  - sets `status`
  - updates counters (only fields present in `patch`)

- `withRun<T>(provider: Provider, query: SearchOffersQuery | undefined, fn: (runId: number) => Promise<T>): Promise<T>`
  - `runId = startRun(...)`
  - `try { result = await fn(runId); finishRun(runId,"success",...); return result }`
  - `catch (e) { finishRun(runId,"failure",...); throw e }`
  - must finalize in `finally`/equivalent

## Counter semantics (minimal for now)

- `pages_fetched`: from client `SearchOffersResult.meta.pagesFetched`
- `offers_fetched`: number of offers attempted for ingestion (or successfully upserted; pick ONE and document)
- `errors_count`: **only fatal errors** (DB unavailable, invalid schema/migrations, auth misconfig, etc.)
- `requests_count`, `http_429_count`: leave `NULL` (future instrumentation)
- `notes`: `NULL` (optional)

## Status semantics

- `success`: process ran and produced useful work (even if some offers were skipped)
- `failure`: process could not proceed (DB down, auth failure, etc.)

## Acceptance

- Any execution creates exactly 1 run row per provider.
- `finished_at` is always set.
- On thrown errors, status becomes `failure` and the error is rethrown.
- No ingestion logic in this task (only lifecycle helpers).
