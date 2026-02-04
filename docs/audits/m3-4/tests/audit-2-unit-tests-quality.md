# AUDIT 2 — Unit tests quality (M3 + M4)

Goal: ensure unit tests are meaningful, not redundant, not brittle, and aligned with real contracts/types.

## Scope
Reviewed unit tests:
- `tests/unit/textNormalization.test.ts`
- `tests/unit/negation.test.ts`
- `tests/unit/matcher.keywords.test.ts`
- `tests/unit/matcher.phrases.test.ts`
- `tests/unit/scorer.test.ts`
- `tests/unit/aggregateCompany.test.ts`

## Per-file quality summary
- `tests/unit/textNormalization.test.ts` — **good**
  - Canonical types: no `as any` usage.
  - Constants vs magic numbers: only the stress test uses 1000; acceptable.
  - Assertions: exact token arrays are appropriate for normalization.
  - Implementation detail exposure: minimal; tests read like contract/spec.
- `tests/unit/negation.test.ts` — **ok**
  - Canonical types: no `as any`.
  - Constants vs magic numbers: some hard-coded window sizes (8, 2, 9, 3) risk brittleness.
  - Assertions: stable and behavior-driven overall.
  - Implementation detail exposure: window-size specifics partly duplicated by constant-based tests.
- `tests/unit/matcher.keywords.test.ts` — **ok**
  - Canonical types: no `as any`.
  - Constants vs magic numbers: N/A.
  - Assertions: some checks rely on `tokenIndex` and exact `matchedTokens`, which can be fragile if tokenization changes while semantics remain valid.
  - Implementation detail exposure: moderate via `tokenIndex` expectations.
- `tests/unit/matcher.phrases.test.ts` — **good/ok**
  - Canonical types: no `as any`.
  - Constants vs magic numbers: N/A.
  - Assertions: mostly semantic (hit present/absent, negation flag). A few exact `matchedTokens` checks, but aligned with tokenization contract.
  - Implementation detail exposure: low-to-moderate.
- `tests/unit/scorer.test.ts` — **ok**
  - Canonical types: no `as any`.
  - Constants vs magic numbers: several tests assert exact numeric scores (6, 10, 4) rather than deriving from constants, making them brittle to weight changes.
  - Assertions: strong coverage of rules; some tests mirror scoring math verbatim.
- `tests/unit/aggregateCompany.test.ts` — **ok**
  - Canonical types: no `as any`.
  - Constants vs magic numbers: uses `STRONG_THRESHOLD` appropriately.
  - Assertions: clear and behavior-driven; tie-breaker tests encode specific ordering rules that may be implementation details if not explicitly contractual.

## Specific risky tests (line references)
- Hard-coded negation window sizes (brittle if constants change, duplicates constant-based tests)
  - `tests/unit/negation.test.ts:31-35` (BEFORE = 8)
  - `tests/unit/negation.test.ts:39-54` (outside window at 9)
  - `tests/unit/negation.test.ts:64-68` (AFTER = 2)
  - `tests/unit/negation.test.ts:72-76` (outside window at 3)
- Exact numeric score assertions derived from weights (brittle to constant changes)
  - `tests/unit/scorer.test.ts:148-166` (expects score = 6)
  - `tests/unit/scorer.test.ts:206-240` (expects score = 10)
  - `tests/unit/scorer.test.ts:302-350` (expects score = 4)
- Token index / matched token assertions that may overfit internal tokenization details
  - `tests/unit/matcher.keywords.test.ts:122-130` (expects `tokenIndex: 0`, exact `matchedTokens`)
  - `tests/unit/matcher.keywords.test.ts:208-215` (expects `tokenIndex: 0`, exact `matchedTokens`)
- Tie-breaker rules encoded as exact ordering (may be implementation-specific if not defined contractually)
  - `tests/unit/aggregateCompany.test.ts:155-185` (publishedAt priority over updatedAt)
  - `tests/unit/aggregateCompany.test.ts:208-228` (first-offer fallback when timestamps null)

## Recommendations (keep/remove/strengthen)
- Keep
  - `tests/unit/textNormalization.test.ts` overall coverage; it reads like a spec.
  - Core matcher phrase/keyword tests that assert presence/absence and negation semantics.
- Strengthen
  - Replace hard-coded negation window numbers with `NEGATION_WINDOW_BEFORE/AFTER` for boundary tests to avoid brittleness while preserving intent.
  - In scorer tests, derive expected scores from `TIER_WEIGHTS`, `FIELD_WEIGHTS`, and `PHRASE_BOOST_POINTS` instead of literal totals; keep explicit MAX_SCORE checks.
  - For matcher tests that assert `tokenIndex`/`matchedTokens`, consider asserting semantic outcomes (keyword/phrase presence, field, negation) unless `tokenIndex` is a documented contract.
  - For aggregateCompany tie-breakers, add a short note or separate tests clarifying that ordering rules are part of the contract (if intended); otherwise relax to check that the selected offer is among the top-score ties.
- Remove / de-duplicate (optional)
  - Consider consolidating negation window tests that use hard-coded values with the constant-based boundary tests to reduce redundancy.
