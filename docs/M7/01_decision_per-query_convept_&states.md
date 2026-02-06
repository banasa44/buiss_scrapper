# [DECISION] Per-Query Concept, State Schema, and State Machine

This document defines the operational model for Milestone M7: how queries are represented, executed, and tracked in a reliable, hands-off way.

The goal is to make daily ingestion stable, sequential, and resilient with minimal manual intervention.

---

## 1) What is a “Query”

**Definition**

A _query_ is the fundamental unit of input to the system.

- Each query represents a single external data source search request (e.g., an InfoJobs search with filters).
- Queries are defined per client (InfoJobs, Indeed, etc.).
- All clients normalize their results into the same internal tables: `companies` and `offers`.

**Key properties**

- Queries belong to a specific client.
- Each client can have multiple queries.
- In v1, we expect a small number of recurring queries (≈ 5).

**Query identity**

- Each query must have a **stable unique identifier**.
- Decision: use a deterministic `queryKey` derived from:
  - client name + normalized query parameters.

If query parameters change, it is treated as a **new query** with a new state (clean history).

---

## 2) Incremental Ingestion Model

### Historical seeding

- On first run, the system may ingest historical data by moving backward in time.
- The state must allow tracking **which day we have reached historically**.

### Daily operation

- After historical seeding, ingestion becomes daily and incremental.
- Filtering will be primarily **by temporal windows**, not by page cursors.

### Stop conditions for a query run

A query execution stops when any of the following happens:

- Temporal window exhausted (no more recent data)
- Client rate limit reached
- Maximum pages or offers reached (safety fallback)

---

## 3) Resilience and Idempotency

- Exact resume from the middle of a failed run is **not required**.
- Re-runs must be safe and idempotent.
- Existing logic for offer upserts and duplicate detection is assumed to be already implemented and correct.

Principle:

> If a run fails, the next run may simply start again; the system must remain correct.

---

## 4) What State Must Answer

The per-query state must allow answering at least:

- When was this query last executed?
- Was the last execution successful?
- Which temporal point has already been processed historically?
- Is this query currently running?

Fine-grained analytics (e.g., “how many offers today”) are not critical at query-state level.

---

## 5) State Machine (Minimal)

We keep a simple model:

**States**

- `IDLE` – not running
- `RUNNING` – currently executing
- `SUCCESS` – last run finished successfully
- `ERROR` – last run finished with error

No additional states such as PAUSED or DEGRADED are required in v1.

---

## 6) Error Handling Philosophy

- The system should **almost never crash entirely**.
- Small ingestion errors should be logged and skipped.
- Only fatal configuration or authentication errors are allowed to stop execution.

**Retries**

- Transient errors: up to **3 retries**.
- After retries are exhausted → mark query as ERROR and continue with next work.
- Sheets sync errors are considered important and should trigger alarms after retries.

---

## 7) Persistence Model

### Storage

- All operational state is stored in **SQLite**.

### Existing structures

- The project already has tables for:
  - ingestion runs
  - (likely) some form of query tracking

We will extend or reuse them rather than invent new parallel systems.

### Required tables (conceptually)

At minimum we need:

- `query_state`
  - queryKey
  - client
  - status
  - lastRunAt
  - lastSuccessAt
  - lastErrorAt
  - lastProcessedDate (for historical seeding)
  - consecutiveFailures
  - metadata (optional JSON)

- `ingestion_runs` (already existing)
  - one record per execution with counters and timestamps

---

## 8) Concurrency and Locking

- Execution must be **strictly sequential**.
- Only one pipeline run at a time.
- No parallel processing of queries.

Decision:

- Implement a global run lock (DB or filesystem based, whichever is more reliable for SQLite).

---

## 9) Scheduling Strategy

- The system should run continuously:
  - When one full cycle finishes, the next begins immediately.
- Special case: Google Sheets reads/writes should be scheduled at night.
- When a client hits rate limits:
  - pause that client for ~6 hours
  - continue with other clients (future-proof for multi-client support)

---

## 10) Manual Operations

- Manual intervention should be avoided.
- No CLI commands or manual resets are required in v1.

---

## 11) Boundaries

- M7 is primarily **wiring and orchestration**.
- Core ingestion logic, duplicate handling, and offer persistence are assumed to already exist and must not be reimplemented.

---

## Summary of Core Decisions

- Query = external search request (client-specific)
- State stored in SQLite
- Simple 4-state machine
- Temporal filtering, not cursors
- Sequential execution only
- 3 retries for transient errors
- Re-runs are idempotent
- Minimal manual tooling

This document should guide the implementation and be validated against the existing codebase before any new components are written.

---

## Related audit

**1. Inventory of Existing Components**

- `src/types/clients/job_offers.ts`: Defines provider-agnostic `SearchOffersQuery` (`text`, `updatedSince`, `maxPages`, `maxOffers`) and search metadata.
- `src/ingestion/pipelines/infojobs.ts`: Builds a `SearchOffersQuery` from input and runs the InfoJobs pipeline sequentially (`searchOffers` → `runOfferBatchIngestion`).
- `src/ingestion/runOfferBatch.ts`: Main ingestion orchestration for a single provider run. Wraps ingestion with run lifecycle, aggregation, Sheets sync, feedback processing, and emits a single run summary log.
- `src/ingestion/runLifecycle.ts`: `startRun` / `finishRun` / `withRun` helpers; creates `ingestion_runs` rows and finalizes them. `query_fingerprint` is always `NULL`.
- `src/db/repos/runsRepo.ts`: CRUD for `ingestion_runs` (supports `status`, `pages_fetched`, `offers_fetched`, `requests_count`, `http_429_count`, `errors_count`, `companies_aggregated`, `companies_failed`).
- `migrations/0001_init.sql` and `migrations/0005_add_run_aggregation_counters.sql`: `ingestion_runs` schema (no `query_state` table).
- `src/db/connection.ts`: SQLite connection lifecycle (`openDb`, `getDb`, `closeDb`), `DB_PATH` env.
- `src/clients/infojobs/infojobsClient.ts`: Implements query execution, pagination caps, `updatedSince` → InfoJobs `sinceDate` mapping, stop conditions (`maxPages`, `maxOffers`, errors).
- `src/constants/clients/infojobs.ts`: Default pagination caps (`INFOJOBS_DEFAULT_MAX_PAGES`, `INFOJOBS_DEFAULT_MAX_OFFERS`).
- `src/clients/http/httpClient.ts` + `src/constants/clients/http.ts`: HTTP retry/backoff (GET/HEAD only, default 3 attempts, retryable status codes include 429/5xx).
- `src/clients/googleSheets/googleSheetsClient.ts` + `src/constants/clients/googleSheets.ts`: Sheets API client with retry/backoff (default 3 attempts) and env-driven auth.
- `src/sheets/feedbackWindow.ts` + `src/constants/sheets.ts`: Nightly feedback gate (03:00–06:00 Europe/Madrid).
- `src/ingestion/aggregateCompanies.ts`: Sequential aggregation with per-company retries.
- `src/logger/logger.ts`: Structured log output with `LOG_LEVEL`.

---

**2. Mapping to M7 Requirements**

**1) Query Concept**

- ❌ No persisted query list or `queryKey` concept; pipeline accepts ad-hoc input per call (`src/ingestion/pipelines/infojobs.ts`, `src/types/clients/job_offers.ts`).
- 🟡 `ingestion_runs.query_fingerprint` exists but is unused and always `NULL` (`src/ingestion/runLifecycle.ts`, `migrations/0001_init.sql`).

**2) Incremental Ingestion Model**

- 🟡 `updatedSince` exists on `SearchOffersQuery` and maps to InfoJobs `sinceDate` buckets; pagination caps enforce max pages/offers (`src/types/clients/job_offers.ts`, `src/clients/infojobs/infojobsClient.ts`, `src/constants/clients/infojobs.ts`).
- ❌ No persisted watermark (`lastProcessedDate`) or historical seeding logic; no per-query temporal window tracking.

**3) Resilience and Idempotency**

- ✅ Offer/company upserts and repost dedupe are idempotent at persistence layer (`src/ingestion/offerPersistence.ts`, `src/ingestion/ingestOffers.ts`).
- ✅ No resume-from-mid-run logic exists, which aligns with “resume not required.”
- 🟡 System-level resiliency is partial: per-offer failures are logged and skipped, but fatal auth/config errors throw and terminate the pipeline (`src/ingestion/ingestOffers.ts`, `src/clients/infojobs/infojobsClient.ts`).

**4) What State Must Answer**

- ❌ No per-query state exists to answer last run/success/error/processed date or “currently running.” `ingestion_runs` is per-provider run only and has no query identity (`src/db/repos/runsRepo.ts`, `migrations/0001_init.sql`).

**5) State Machine (Minimal)**

- 🟡 Run status is `success` / `failure` only, stored at run completion; no explicit `RUNNING`, `IDLE`, or `ERROR` states for queries (`src/ingestion/runLifecycle.ts`, `src/types/db.ts`).

**6) Error Handling Philosophy**

- 🟡 Transient HTTP retry exists for GET/HEAD (3 attempts). Google Sheets retries exist (3 attempts). Aggregation retries exist per company (`src/clients/http/httpClient.ts`, `src/constants/clients/http.ts`, `src/clients/googleSheets/googleSheetsClient.ts`, `src/ingestion/aggregateCompanies.ts`).
- ❌ No query-level error classification, no per-query retry budget, and no transition to query `ERROR` state.

**7) Persistence Model**

- 🟡 SQLite is used (`src/db/connection.ts`). `ingestion_runs` exists for run-level audit (`migrations/0001_init.sql`).
- ❌ No `query_state` table or query-level fields like `lastRunAt`, `lastSuccessAt`, `lastErrorAt`, `lastProcessedDate`, `consecutiveFailures`.

**8) Concurrency and Locking**

- ❌ No global run lock or concurrency guard. Nothing prevents parallel pipeline runs.

**9) Scheduling Strategy**

- ❌ No scheduler/continuous loop. `src/main.ts` only initializes the client and does not run ingestion (`src/main.ts`).
- 🟡 A nightly gate exists only for feedback processing, not for general Sheets read/write or pipeline execution (`src/sheets/feedbackWindow.ts`, `src/ingestion/runOfferBatch.ts`).

**10) Manual Operations**

- 🟡 No manual “reset” operations in code, but execution is manual because no orchestrator or daemon exists.

**11) Boundaries**

- ✅ Core ingestion, persistence, dedupe, and signal logic already exist and can be reused as-is (`src/ingestion/*`, `src/signal/*`, `src/db/*`).

---

**3. Conflicts Identified**

- Decision requires a per-query `queryKey` and persistent query state; current code only has run-level `ingestion_runs` with `query_fingerprint = NULL` and no query list or state table (`src/ingestion/runLifecycle.ts`, `migrations/0001_init.sql`).
- Decision requires a 4-state query machine (`IDLE/RUNNING/SUCCESS/ERROR`); current implementation stores only `success/failure` at run completion with no explicit `RUNNING` and no query-level state (`src/ingestion/runLifecycle.ts`, `src/types/db.ts`).
- Decision requires sequential execution with a global run lock; no lock exists and no orchestrator enforces single-run execution (`src/main.ts`, `src/db/connection.ts`).
- Decision expects Sheets reads/writes to be scheduled at night; current code performs Sheets sync on every run when `GOOGLE_SHEETS_SPREADSHEET_ID` is set and only gates feedback processing (`src/ingestion/runOfferBatch.ts`, `src/sheets/feedbackWindow.ts`).
- Decision requires transient retries then marking query `ERROR` and continuing; current retries are local to HTTP and Sheets calls, with no query-level failure tracking or pause logic (e.g., 6-hour rate-limit pause).

Recommendation: adapt code to the decision doc rather than changing the decision doc, because existing implementation has no competing architecture for query state or orchestration.

---

**4. Minimal Implementation Plan**

- Introduce a query registry and deterministic `queryKey` derivation. Use a small config module (e.g., `src/queries/*.ts`) that defines per-client queries and normalizes parameters; compute `queryKey` from provider + normalized params.
- Add `query_state` persistence in SQLite via migration and repo. Implement fields exactly as in the decision doc and store `queryKey`, `client`, `status`, timestamps, `lastProcessedDate`, `consecutiveFailures`, and optional metadata.
- Update run lifecycle to attach `query_fingerprint` (or `queryKey`) in `ingestion_runs` and keep reusing existing run logging (`src/ingestion/runLifecycle.ts`, `src/db/repos/runsRepo.ts`).
- Build a minimal orchestrator loop that:
  - Opens the DB (`openDb`) and acquires a global lock.
  - Iterates queries sequentially, sets query state `RUNNING`, executes provider pipeline (`runInfojobsPipeline`) with computed `updatedSince`, and updates state to `SUCCESS` or `ERROR`.
  - Applies retry policy (3 attempts for transient errors) and increments `consecutiveFailures`.
  - Releases lock and continues immediately after a full cycle.
- Add a global run lock (DB table or filesystem lock) to prevent concurrent runs.
- Gate Sheets sync and feedback processing by time window if the decision requires nightly operation (reuse `feedbackWindow` or add a dedicated “sheets window” gate).
- Keep ingestion/dedupe/aggregation as-is; no changes required except wiring and state persistence.

---

**Next Steps**

1. Define the canonical list of per-client queries and the exact normalization rules for `queryKey`.
2. Draft the `query_state` migration and repo interface (read/update, upsert, and state transitions).
3. Design the orchestrator control flow (single-process loop + global lock + DB lifecycle).
4. Decide how to map `updatedSince` and `lastProcessedDate` for historical seeding vs daily incremental mode.
5. Decide if Sheets sync should be gated to the same nightly window as feedback or a different window.
