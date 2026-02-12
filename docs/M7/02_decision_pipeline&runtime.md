# ATS Pipeline – Runtime & Orchestration Design (v1)

## 1. Scope & Goals

This document defines the canonical runtime architecture for the ATS-only pipeline:

Directory → ATS Discovery → ATS Ingestion → Scoring/Metrics → DB → Google Sheets → Feedback Apply

InfoJobs is explicitly out of scope.

The goal is:

- A clean, deterministic, idempotent pipeline
- A single canonical entrypoint (`main`)
- Clear runner boundaries
- DB as source of truth
- Google Sheets as a view/control layer
- Safe resumability via DB checkpoints
- No overengineering, but future-proof for splitting loops later

---

## 2. High-Level Architecture

### 2.1 Execution Model (Phase 1 – Single Cascading Loop)

We implement a single orchestrated flow executed in order:

1. DirectoryRunner
2. AtsDiscoveryRunner
3. AtsIngestionRunner
4. SheetsSyncRunner
5. FeedbackRunner

All coordinated by `main`.

This is designed for:

- Nightly execution
- Manual run-once
- Optional loop mode (future)

This structure must allow future separation into independent loops without major refactor.

---

## 3. Canonical Entrypoint

### 3.1 `main` Responsibilities

`main` is the only official runtime entrypoint.

It is responsible for:

- Open DB
- Run migrations
- Acquire run lock
- Execute runners in order
- Handle structured logging
- Handle fatal vs best-effort errors
- Release run lock
- Close DB

No business logic lives in `main`.

---

## 4. Runners Design

Each runner:

- Exposes `runOnce(): Promise<void>`
- Is idempotent
- Uses DB as state source
- Has isolated rate limits
- Has no side effects outside its responsibility

### 4.1 DirectoryRunner

Responsibility:

- Ingest company lists (3 sources)
- Persist:
  - name
  - website
  - source
  - timestamps

Properties:

- Can process full lists in a single run
- Designed to later support incremental refresh

No dependency on ATS or Sheets.

---

### 4.2 AtsDiscoveryRunner

Responsibility:

- Select companies without resolved ATS source
- Detect ATS (Lever / Greenhouse)
- Persist `company_sources`

Properties:

- Idempotent per company
- Safe to rerun
- Must not duplicate sources

Checkpointing:

- Based on DB state (`company_sources` existence / status fields)

---

### 4.3 AtsIngestionRunner

Responsibility:

- Select ATS sources requiring ingestion
- Fetch job offers
- Persist:
  - raw descriptions
  - normalized data
- Trigger scoring
- Persist:
  - matches
  - metrics
  - company signals

This is the most critical runner.

Checkpoint strategy:

- Pagination cursor (if supported)
  OR
- `last_updated_at` watermark
  OR
- Hybrid

State must live in DB.

This runner must be resumable without duplicating work.

---

### 4.4 SheetsSyncRunner

Responsibility:

- Read DB projection (company + metrics + status)
- Upsert rows into Google Sheets

Characteristics:

- DB is source of truth
- Sheets is a projection
- Idempotent upsert
- Best-effort (failure does not block ingestion)

Feature-gated:

- Only runs if `GOOGLE_SHEETS_SPREADSHEET_ID` is configured

---

### 4.5 FeedbackRunner

Responsibility:

- Read feedback column from Google Sheets
- Apply changes to DB
- Mark processed rows if needed

Design decision:

- Runs after SheetsSync
- Designed to run at night to avoid race conditions with manual edits

Failure behavior:

- Best-effort
- Must not corrupt DB on partial read

---

## 5. Rate Limiting Strategy

Rate limiting is isolated per provider:

- Directory providers
- Lever
- Greenhouse
- Google Sheets

Rules:

- No global rate limiter
- Each provider encapsulates:
  - Token bucket or simple limiter
  - Backoff on 429 / 5xx
  - Optional DB-based pause if blocked

Rate limits must not leak across runners.

---

## 6. Resumability & Checkpointing

Resumability is DB-driven.

We use:

- `lastIngestedAt`
- `nextCursor`
- `lastErrorAt`
- `retryAfter`
- `isPausedUntil`

Pagination fields may be added to DB schema if required.

The `runs` table should be reviewed and adapted to:

- Track runner-level runs
- Track status (started, completed, failed)
- Store summary counters
- Enable debugging and auditing

Resumption logic must never rely on in-memory state.

---

## 7. DB as Source of Truth

The DB represents:

- Companies
- ATS sources
- Offers
- Scoring results
- Company metrics
- Run state
- Processing checkpoints

Sheets is not authoritative.

All reconciliation flows from DB outward.

---

## 8. Error Handling Strategy

We define two categories:

### Fatal Errors

- DB cannot open
- Migration failure
- Run lock failure
- Invalid configuration

These stop the entire run.

### Best-Effort Errors

- Sheets sync failure
- Feedback read failure
- Single provider temporary failure

These:

- Are logged
- Do not abort entire ingestion pipeline

---

## 9. Future Evolution (Phase 2 – Split Loops)

Architecture must allow splitting into:

Loop A:

- Directory
- ATS Discovery
- ATS Ingestion

Loop B:

- Sheets Sync
- Feedback Apply

This will require:

- Watermark definition
- Clear "what changed" semantics
- Independent run locks

No code should assume single-loop forever.

---

## 10. Immediate Implementation Plan

1. Audit existing code:
   - Identify current runner-like modules
   - Identify state fields in DB
   - Identify unused or duplicate entrypoints

2. Implement canonical `main` orchestrator

3. Refactor or wrap existing logic into:
   - DirectoryRunner
   - AtsDiscoveryRunner
   - AtsIngestionRunner
   - SheetsSyncRunner
   - FeedbackRunner

4. Ensure:
   - No dead entrypoints
   - No duplicated flow paths
   - Clear DB checkpoint usage

5. Only after this:
   - Validate Google Sheets auth
   - Write unit tests
   - Write integration tests
   - Write E2E tests

---

## 11. Open Questions (To Be Resolved Iteratively)

- Pagination vs watermark for ATS ingestion
- Exact shape of runs table (extend or redesign?)
- Whether to process feedback row-by-row or batch-based
- Whether SheetsSync should be full projection or delta-based
- How to mark "processed feedback" safely

These will be decided section by section as we implement.

---

End of document.
