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

## M2 — Catalog + matcher/scorer (signal v0 with tests)

Goal: produce explainable offer-level signals with a configurable catalog.

- [DEFINE] Define keyword catalog format and ownership
- [DEFINE] Define scoring parameters
- [DEFINE] Define text normalization rules
- [BUILD] Implement catalog loader + validation
- [BUILD] Implement matcher/scorer
- [UTEST] Add matcher tests

## M3 — Company aggregation + freshness + repost policy

Goal: turn offer signals into a ranked company view that stays relevant.

- [DEFINE] Specify offer freshness policy
- [DEFINE] Define repost detection policy
- [BUILD] Implement company aggregation
- [UTEST] Add aggregation/scoring behavior tests

## M4 — Sheets export + live gated integration

Goal: export ranked companies to Sheets and validate end-to-end integrations.

- [RESEARCH] Validate Google Sheets API limits
- [DECISION] Choose Sheets export mode
- [BUILD] Implement Sheets exporter
- [ITEST] Add gated integration tests

## M5 — Operationalization (state + scheduling) + runbook

Goal: make it hands-off to run daily with stable behavior.

- [BUILD] Implement per-query run state
- [DECISION] Choose scheduler cadence
- [BUILD] Implement runner and scheduling
- [BUILD] Implement run summary logging
- [DOC] Document configuration and runbook

## M6 — Convenience layer (only if you still want it)

Goal: improve developer ergonomics once the pipeline is working.

- [BUILD] Add CLI flags and dry-run mode
