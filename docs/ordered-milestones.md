# Step 4 — Iterative Milestones (Same 31 tasks, reordered to avoid premature CLI)

## M0 — InfoJobs spike → usable connector (start here)

Goal: confirm InfoJobs API reality and immediately ship a working connector.

- [RESEARCH] Validate InfoJobs API auth and endpoints
- [RESEARCH] Assess InfoJobs API limits
- [RESEARCH] Review InfoJobs API usage constraints
- [BUILD] Implement InfoJobs connector

## M1 — DB + ingestion/dedupe (make runs safe early)

Goal: persist offers/companies and guarantee idempotent reruns before scoring.

- [DEFINE] Define minimal DB schema
- [BUILD] Set up database layer
- [DEFINE] Specify company identity rules
- [BUILD] Implement ingestion and dedupe
- [ITEST] Add DB migration smoke test
- [UTEST] Add dedupe/idempotency tests
  TODO:
  **Note:** M1.4-E (optional raw_json flag) has been **deferred** to a future milestone. M1 uses `raw_json = null` throughout.

## M2 — Signal definition (DEFINE only)

Goal: define all semantic rules for keyword matching and scoring before implementation.

### M2.1 — Keyword catalog (DEFINE)

- [DEFINE] Define keyword catalog format (categories, tiers, phrases)
- [DEFINE] Define catalog ownership & editability rules (client vs system)

### M2.2 — Text normalization (DEFINE)

- [DEFINE] Define text fields used for matching (title, description, company)
- [DEFINE] Define normalization rules (lowercase, accent removal, stopwords, tokenization)
- [DEFINE] Define language handling (ES/EN)
- [DEFINE] Explicit non-goals (no heavy NLP, no embeddings, no ML)

### M2.3 — Matching rules (DEFINE)

- [DEFINE] Define keyword match types (exact, regex, phrase)
- [DEFINE] Define word boundary requirements
- [DEFINE] Define negation handling (basic scope-based)
- [DEFINE] Define multi-category behavior (1 hit per category per offer)
- [DEFINE] Define synonym/alias semantics

### M2.4 — Scoring model (DEFINE)

- [DEFINE] Define tier-based scoring model (category weights)
- [DEFINE] Define phrase boost behavior
- [DEFINE] Define score scale (0–10) and classification labels (A/B)
- [DEFINE] Define field weighting (title > description > company name)
- [DEFINE] Define explainability contract (what data is exposed)

**Outcome of M2:** Scoring should be manually simulatable on paper.

---

## M3 — Signal implementation (offer-level)

Goal: implement the matching and scoring logic defined in M2, producing explainable offer-level signals.

### M3.1 — Catalog runtime

- [BUILD] Implement catalog loader + schema validation
- [DEFINE] Define safe defaults and failure modes

### M3.2 — Matcher

- [BUILD] Implement Text → MatchResult
- [UTEST] Add unit tests for keyword, phrase, negation, and boundary cases

### M3.3 — Scorer

- [BUILD] Implement MatchResult → ScoreResult
- [UTEST] Add unit tests for tiers, boosts, caps

**Outcome of M3:** `offer → score(0–10) + label + topCategory`

---

## M4 — Company aggregation & relevance

Goal: turn offer signals into a ranked company view that stays relevant.

### M4.1 — Aggregation rules (DEFINE)

- [DEFINE] Define aggregation strategy (max score vs max+count)
- [DEFINE] Specify offer freshness window
- [DEFINE] Define repost detection policy (same offer vs new)

### M4.2 — Aggregation build (BUILD)

- [BUILD] Implement company score computation
- [UTEST] Add unit tests for aggregation edge cases

### M4.3 — Output shaping

- [DEFINE] Define export fields (score, label, company, optional reasons)
- [BUILD] Build export to CSV format

---

## M5 — Sheets export + live gated integration

Goal: export ranked companies to Sheets and validate end-to-end integrations.

- [RESEARCH] Validate Google Sheets API limits
- [DECISION] Choose Sheets export mode
- [BUILD] Implement Sheets exporter:
  1. [BUILD-1] Create Sheets API client wrapper
  2. [BUILD-2] Implement minimal read-only connector
  3. [BUILD-3] Define sheet schema contract
  4. [BUILD-4] Implement company-to-row mapper
  5. [BUILD-5] Implement append-only exporter
  6. [BUILD-6] Implement upsert/update logic
  7. [BUILD-7] Add feedback-column preservation
  8. [BUILD-8] Integrate exporter into pipeline
  9. [BUILD-9] Error handling & retries
  10. [BUILD-10] Operational logging & dry-run mode
- [ITEST] Add gated integration tests

---

## M6 — Sheets Feedback Loop & Company Lifecycle

Goal: allow the client to resolve companies from Google Sheets and propagate those decisions back into the system database safely.

- [DEFINE] Specify feedback semantics and lifecycle rules
- [DECISION] Choose feedback ingestion strategy
- [BUILD] Implement Sheets feedback processor
- [BUILD] Implement company resolution workflow
- [ITEST] Add gated integration tests

---

## M7 — Operationalization (state + scheduling) + runbook

Goal: make the system fully hands-off, sequential, and safe to run continuously.

### Phase 1 – Foundations (concepts and persistence)

- [DECISION] Finalize per-query concept, state schema, and state machine
- [BUILD] Introduce query registry (source of truth for queries)
- [BUILD] Implement `query_state` persistence (migration + repo)

### Phase 2 – Safety and Control

- [BUILD] Implement single-run global lock (no overlap)
- [BUILD] Attach `queryKey` to existing `ingestion_runs` records
- [BUILD] Basic query lifecycle transitions (IDLE → RUNNING → SUCCESS/ERROR)

### Phase 3 – Orchestration Core

- [DECISION] Choose scheduler cadence (+ jitter) and retry policy
- [BUILD] Implement runner core that executes all queries sequentially
  - shared codepath for manual and scheduled execution
- [BUILD] Implement per-query retry handling and rate-limit pauses

### Phase 4 – Scheduling

- [BUILD] Implement scheduling wrapper (cron / loop-based daemon)
- [BUILD] Nightly gating for Google Sheets operations

### Phase 5 – Observability

- [BUILD] Run summary logging enriched with query context
- [BUILD] Persist run statistics aligned with `query_state`

### Phase 6 – Documentation

- [DOC] `.env.example` and README configuration section
- [DOC] Operational runbook + troubleshooting guide

---

# Roadmap — ATS Pipeline Wiring + Operationalization (M8 or extend M7)

This roadmap operationalizes the ATS-only system end-to-end:
Directory → ATS Discovery → ATS Ingestion → Scoring/Metrics → DB → Google Sheets → Feedback Apply

InfoJobs is explicitly out of scope.

---

## Option: M8 — ATS Pipeline Wiring + 24/7 Runtime

### Goal

Make the ATS pipeline fully wired, sequential, resumable, and safe to run continuously (nightly for Sheets/feedback).

---

## Phase 0 — Audit & Alignment (fast, no refactors yet)

- [AUDIT] Map existing modules to the target runners:
  - Directory ingestion (3 lists) → DB companies
  - ATS discovery → DB company_sources
  - ATS ingestion (Lever/Greenhouse) → DB offers + descriptions
  - Scoring/metrics persistence
  - Sheets sync + feedback apply (currently InfoJobs-only path)
- [AUDIT] Identify current runtime entrypoints and which `package.json` scripts actually run
- [AUDIT] Review DB lifecycle: ensure migrations do not leave DB closed for subsequent steps
- [DECISION] Confirm: Service Account auth for Google Sheets (expected default)

Exit criteria:

- Written mapping of “what exists” vs “missing wiring”
- Clear list of dead/duplicate entrypoints to remove or deprecate

---

## Phase 1 — Canonical Runtime Entrypoint + Global Safety

- [BUILD] Establish a single canonical entrypoint (`src/main.ts`) that:
  - opens DB
  - runs migrations
  - acquires a global single-run lock (no overlap)
  - executes the orchestrator
  - releases lock + closes DB
- [BUILD] Define fatal vs best-effort error handling rules:
  - Fatal: DB/migrations/lock/config invalid
  - Best-effort: Sheets sync / feedback apply failures
- [CLEANUP] Remove/retire unused entrypoints (no “random” runners in the repo)

Exit criteria:

- `npm run start` / `npm run dev` executes the canonical `main` path
- One run completes without leaving the DB in an invalid lifecycle state

---

## Phase 2 — Runnerization (clean boundaries, no behavior changes)

- [DECISION] Runner contracts:
  - `runOnce()` idempotent
  - DB-driven state
  - provider-specific rate limiting encapsulated in clients
- [BUILD] Extract or wrap existing logic into 5 runners:
  1. DirectoryRunner
  2. AtsDiscoveryRunner
  3. AtsIngestionRunner
  4. SheetsSyncRunner
  5. FeedbackRunner
- [CLEANUP] Ensure no dead code and no “half-integrated” modules remain

Exit criteria:

- `main` orchestrates the 5 runners sequentially (even if some are no-ops due to gating)
- Each runner can be executed independently in isolation for debugging

---

## Phase 3 — Resumability & State Model (ATS ingestion is the real workload)

- [AUDIT] Review existing state infra:
  - runs table(s)
  - timestamps on offers/sources
  - pause/lock concepts
- [DECISION] Choose checkpoint strategy for ATS ingestion per provider:
  - Cursor-based pagination (store `nextCursor` on `company_source` or dedicated state table)
  - Watermark-based (`last_updated_at`)
  - Hybrid
- [BUILD] Implement DB persistence for ingestion state:
  - per `company_source` checkpoint fields (preferred) OR
  - a dedicated `source_ingestion_state` table
- [BUILD] Implement robust retry/backoff behavior:
  - handle 429/5xx with exponential backoff
  - optional DB-based pause windows (`isPausedUntil`)

Exit criteria:

- AtsIngestionRunner can stop/restart without reprocessing everything
- Rate limits do not “brick” the run; the system pauses and resumes cleanly

---

## Phase 4 — Sheets + Feedback Re-integration (ATS path)

- [BUILD] Rewire Sheets operations so they run for ATS data:
  - define a DB projection/view-model for sheets rows
  - implement idempotent upsert mapping (stable row identity)
- [BUILD] Nightly gating for SheetsSyncRunner + FeedbackRunner
  - e.g., only execute within a configured window or via explicit schedule
- [BUILD] Feedback apply rules:
  - safe parsing + validation
  - never destructive on ambiguous input (no “delete DB on misclick”)
  - optional “processed” marker column to avoid reprocessing

Exit criteria:

- ATS run results appear in Sheets
- Feedback updates DB safely and predictably
- Sheets failures do not block ingestion

---

## Phase 5 — Scheduling (hands-off 24/7)

- [DECISION] Scheduling mode:
  - cron (recommended if deploying in an environment with cron)
  - loop-based daemon with sleep + jitter
- [BUILD] Shared codepath for manual vs scheduled runs
- [BUILD] Enforce global single-run lock in scheduled mode

Exit criteria:

- System can be left running without manual intervention
- No overlapping runs

---

## Phase 6 — Tests (only after wiring is stable)

- [BUILD] Unit tests:
  - state transitions
  - checkpoint/resume logic
  - mapping to sheets row model
- [BUILD] Integration tests (DB + orchestration):
  - Directory → ATS discovery → ATS ingestion → persisted metrics
- [BUILD] E2E live tests for Google Sheets:
  - only when env credentials are present; otherwise skipped

Exit criteria:

- Test suite provides confidence without brittle mocks
- Live sheets tests gated by env

---

## Phase 7 — Documentation & Runbook (ship-ready)

- [DOC] `.env.example` with all required config (ATS + Sheets)
- [DOC] README “How to run” (manual + scheduled)
- [DOC] Operational runbook:
  - common failure modes (429, auth issues, bad tenants)
  - how to inspect run state in DB
  - how to pause/resume a source
  - how to validate sheets sync

Exit criteria:

- A new developer can run the system safely from scratch

---

## Phase 8 — Runner Core Reuse Addendum (AUDIT_RUNNER_CORE_REUSE)

### Phase 1 — Runner Engine Stabilization (blockers)

- [BUILD] Separar “startup/migrations” del cicle runOnce (migrations 1 cop, no per run; i sobretot que no tanqui la DB abans del lock). (`AUDIT_RUNNER_CORE_REUSE`)
- [BUILD] Assegurar DB lifecycle estable durant tot el run: open → lock → tasks → unlock → close. (`AUDIT_RUNNER_CORE_REUSE`)
- [BUILD] Lock heartbeat: utilitzar refreshRunLock periòdicament durant el run (o abans/després de cada task) per evitar expiració. (`AUDIT_RUNNER_CORE_REUSE`)

### Phase 2 — Convert runner.ts to task-based engine

- [DECISION] Definir contracte Task mínim: taskKey, clientKey (per pause), runOnce(ctx), shouldRun(ctx) (opcional).
- [BUILD] Substituir ALL_QUERIES per ALL_TASKS (registry de tasks). (`AUDIT_RUNNER_CORE_REUSE`)
- [BUILD] Eliminar dispatch InfoJobs-only i reemplaçar per execució directa de tasks (cada task sap què fa). (`AUDIT_RUNNER_CORE_REUSE`)

### Phase 3 — Wirejar ATS pipeline com tasks

- [BUILD] Task: DirectoryIngestionTask (3 fonts) → companies
- [BUILD] Task: AtsDiscoveryTask → company_sources
- [BUILD] Task: LeverIngestionTask (pipeline existent) → offers + scoring + aggregation
- [BUILD] Task: GreenhouseIngestionTask (pipeline existent) → idem
- [NOTE] Aquí reutilitzes al màxim; no refactors ingestion. (`AUDIT_RUNNER_CORE_REUSE`)

### Phase 4 — Sheets & Feedback com tasks (nightly gated)

- [BUILD] Task: SheetsSyncTask (upsert) (feature-gated per env)
- [BUILD] Task: FeedbackApplyTask (nightly window, no destructiu per default / safe-guards)
- [DECISION] Feedback de nit per evitar misclick/race. (`AUDIT_RUNNER_CORE_REUSE`)

### Phase 5 — Cleanup d’orquestració duplicada

- [CLEANUP] Convertir `src/orchestration/ats/*` en thin wrappers o eliminar-los si ja no s’usen (no pot quedar un segon motor). (`AUDIT_RUNNER_CORE_REUSE`)

---

# Alternative: Fold into M7

If M7 already owns “operationalization + state + scheduling + runbook”, then:

- Treat Phases 0–2 as **M7.0 (Pipeline Wiring Foundations)**
- Treat Phases 3–7 as **M7 (Operationalization proper)**
- Treat Phase 8 as **M7.x (Runner Core Reuse Addendum)**

Rule of thumb:

- If you want a clean milestone boundary, create **M8**.
- If you want a single “make it run forever” milestone, extend **M7**.

---

## Suggested Milestone Naming

- M7: Operationalization (state + scheduling) + runbook
- M8: ATS Pipeline Wiring (orchestrator + runners + Sheets reintegration)
- M8 addendum: Runner Core Reuse (`AUDIT_RUNNER_CORE_REUSE`)

(Or merge and rename M7 to “Operationalization + ATS Wiring”.)

---

## M9 — Convenience layer (only if you still want it)

Goal: improve developer ergonomics once the pipeline is working.

- [BUILD] Add CLI flags and dry-run mode
