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

Goal: make it hands-off to run daily with stable behavior.

- [BUILD] Implement per-query run state
- [DECISION] Choose scheduler cadence
- [BUILD] Implement runner and scheduling
- [BUILD] Implement run summary logging
- [DOC] Document configuration and runbook

---

## M8 — Convenience layer (only if you still want it)

Goal: improve developer ergonomics once the pipeline is working.

- [BUILD] Add CLI flags and dry-run mode
