# AUDIT 4 — E2E tests realism (offline pipeline)

Goal: ensure E2E tests use real pipeline modules, offline fixtures, and assert meaningful end-state.

## Findings
- Real pipeline entrypoints are used in both files (`runOfferBatchIngestion`), with real DB harness setup (`createTestDb`) and no manual DB seeding. `tests/e2e/ingestion_to_aggregation.e2e.test.ts:11-36`, `tests/e2e/repost_detection_to_aggregation.e2e.test.ts:15-37`.
- Tests validate meaningful end-state via persisted offers, matches, and aggregated company metrics using repos and direct SQL reads (not mocks). `tests/e2e/ingestion_to_aggregation.e2e.test.ts:106-214`, `tests/e2e/repost_detection_to_aggregation.e2e.test.ts:101-147`.
- Relationship-based assertions exist (e.g., `company.max_score` equals `match.score`, and `top_offer_id` equals the highest scoring offer in that test’s narrative). `tests/e2e/ingestion_to_aggregation.e2e.test.ts:171-199`.
- Idempotency is exercised by running ingestion twice and asserting single-row persistence plus stable key metrics. `tests/e2e/ingestion_to_aggregation.e2e.test.ts:216-305`.

## Weak spots / brittle points
- **Fixture-dependent score ordering**: The first test assumes offer1 is the top-scoring offer and sets `company.max_score === match1.score` and `top_offer_id === offer1.id`. If catalog weights or fixtures change, the top offer could shift and fail the test without a regression in pipeline logic. `tests/e2e/ingestion_to_aggregation.e2e.test.ts:171-199`.
- **Hard expectation of positive score for offer2**: `match2.score > 0` depends on fixture/catalog content; this can become brittle if catalog or scoring rules evolve. `tests/e2e/ingestion_to_aggregation.e2e.test.ts:148-151`.
- **Current-implementation assumptions in repost test**: Assertions that `canonical_offer_id` is `NULL` and `repost_count` is `0` bake in the “no repost tracking” state. These are likely to break once canonicalization/repost tracking expands. `tests/e2e/repost_detection_to_aggregation.e2e.test.ts:118-122`.
- **Idempotency verification is partial**: The double-run test checks counts and a few metrics, but doesn’t verify that matches/aggregation outputs are unchanged relative to the first run (e.g., compare max_score or category_max_scores between runs). `tests/e2e/ingestion_to_aggregation.e2e.test.ts:271-305`.

## Suggested improvements (no code)
- Make top-offer assertions **relationship-based**: compute max score from matches in DB and assert `company.max_score` and `company.top_offer_id` match that max, rather than assuming a specific fixture is top. This reduces brittleness if fixtures/catalog scoring change.
- Relax or contextualize “positive score” for offer2: either assert “match row exists” or tie the expectation to a fixture-specific claim (e.g., verify a known keyword is present), to avoid breakage from catalog evolution.
- For repost tests, keep the **core invariants** (single row, updated published_at, aggregation counts) and treat `canonical_offer_id`/`repost_count` as optional or explicitly “current behavior” to avoid future refactors breaking the test.
- Strengthen idempotency by comparing **aggregation outputs between runs** (e.g., max_score, strong_offer_count, category_max_scores), not only counts.
