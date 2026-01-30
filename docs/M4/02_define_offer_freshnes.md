# M4.2 — Offer freshness window (DEFINE)

## Purpose

Define how offer recency affects aggregation and relevance of company signals.

## Questions to answer

- Should old offers contribute to company signals?
- What time window is considered “relevant” for sales purposes?
- Which timestamp is authoritative (publishedAt vs ingestedAt)?

## Constraints

- Freshness logic must be simple and configurable.
- Must not depend on external APIs at aggregation time.
- Must behave safely when dates are missing or inconsistent.

## Outcome

A freshness policy that decides which offers are included or excluded
before aggregation.

# M4.2 — Offer freshness window (CONCLUSIONS)

## Decision summary

- **Freshness does NOT gate offers**
  - No offer is excluded from aggregation based on age.
  - Old offers remain valid signals.

- **Freshness does NOT affect scoring**
  - No decay, penalties, or score adjustments based on time.
  - Offer score remains purely signal-based.

- **Freshness is informational only**
  - Used to contextualize confidence for sales and reporting.
  - Indicates how recent the last strong signal was.

## Persisted freshness signals

- **lastStrongAt**
  - Timestamp of the most recent offer with `score >= STRONG_THRESHOLD` (initially 6).
  - Computed at aggregation time.

- **(Optional derived field) lastStrongAgeDays**
  - Days since `lastStrongAt`, computed at read/query time if needed.

## Timestamp source priority

1. `publishedAt`
2. `updatedAt`
3. `null` (if neither exists)

- No fallback corrections.
- No assumptions on missing or inconsistent dates.

## Constraints respected

- Deterministic and simple logic.
- No dependency on external APIs.
- Safe behavior when timestamps are missing.

## Rationale

- Companies operating in FX / USD contexts tend to do so continuously.
- Recency increases confidence, but lack of recency should not invalidate a lead.
- Sales can prioritize based on freshness without losing potentially valuable companies.

## Intended usage

- Drive prioritization and sorting (e.g. “recent strong signal”).
- Improve explainability in reports (“last strong signal seen X days ago”).
- Support future heuristics without locking current behavior.
