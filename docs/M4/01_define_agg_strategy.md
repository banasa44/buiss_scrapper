# M4.1 — Aggregation strategy (DEFINE)

## Purpose

Define how multiple scored offers belonging to the same company are aggregated into a single company-level signal.

## Questions to answer

- Which aggregation signals matter at company level (e.g. max score, count, average)?
- How to combine them into a ranking strategy without inflating scores due to reposts or volume?
- How to select a representative category for the company (e.g. from which offer)?

## Constraints

- Aggregation must be deterministic.
- Must avoid summed scores that reward reposting or spam.
- Must be explainable to a non-technical user (sales).

## Outcome

A clear aggregation rule that maps:
`{ offerScore_i } → { companyScoreSignals }`
and defines how companies will be ordered.

# M4.1 — Aggregation strategy (CONCLUSIONS)

## Company-level signals (computed from offers after freshness + repost filtering)

For each company (companyKey), compute:

- `maxScore`: max offer score in [0..10]
- `offerCount`: number of offers with `score > 0`
- `strongOfferCount`: number of offers with `score >= 6` (threshold configurable)
- `avgStrongScore`: average of scores where `score >= 6` (null if none)

Rationale: we treat low/irrelevant offers as noise and do not let them dilute company quality.

## Representative category

- `topCategoryId`: category from the offer that produced `maxScore` (tie-breaker: most recent offer)

Additionally store lightweight category summary for reporting:

- `categoryMaxScores`: map `{ categoryId -> maxOfferScoreInThatCategory }`
  (or equivalent “top 3 categories by max score”, implementation choice)

## Debug / explainability fields

- `topOfferRef` (provider+id or DB id): the offer that produced `maxScore`
  Used to inspect the exact evidence behind the company ranking.

## Ordering

No ordering is required inside the aggregation function.
Ordering will be handled by DB queries / export logic as needed.
