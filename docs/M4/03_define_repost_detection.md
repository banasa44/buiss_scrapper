# M4.3 — Repost detection policy (DEFINE)

## Purpose

Define how to detect and handle reposted or duplicated offers from the same company.

## Questions to answer

- What qualifies as “the same offer” (exact match vs near-duplicate)?
- Should reposts be ignored, merged, or counted once?
- How does repost detection interact with freshness?

## Constraints

- Must be cheap and deterministic (no ML / heavy NLP).
- Must operate only on data already stored in DB.
- Must not accidentally deduplicate distinct roles.

## Outcome

A clear rule to identify reposts and specify how they affect aggregation
(e.g. dedupe before counting).

# M4.3 — Repost detection policy (CONCLUSIONS)

## Goals

- Keep the DB clean by avoiding duplicated offers being stored multiple times.
- Still reflect repeated reposting as an “activity / sustained interest” signal at company level.

## Scope

- Dedupe is applied **within the same companyKey** only.
- Dedupe is applied **historically** (new incoming offers are compared against already persisted offers for that companyKey).

## Canonical offer model

- For each company, we keep a set of **canonical offers** (unique offers after dedupe).
- When a new offer is detected as a repost/duplicate of an existing canonical offer:
  - Do **not** persist a new offer row.
  - Update the canonical offer “seen” metadata + counters.

## Duplicate definition (cheap + deterministic)

We use a two-stage rule based on normalized tokens derived from raw `title` and raw `description`:

### Stage 1 — Title gate

- If normalized title matches strongly (exact or near-exact after normalization),
  then we consider it a strong duplicate candidate and use a **lower** description threshold.

### Stage 2 — Description similarity

- Compute token similarity between normalized descriptions.
- Thresholds:
  - Default duplicate threshold: **>= 90%** token similarity.
  - If title is strongly matching: use a **lower** threshold (TBD constant, e.g. 80–85%).

Notes:

- Title-only equality is not sufficient by itself (avoid collapsing generic titles).
- No ML, no embeddings, no external dependencies.

## What happens on duplicate

On duplicate detection:

- Do not persist a new offer record.
- Update canonical offer:
  - `repostCount += 1`
  - `lastSeenAt = now()` (or run timestamp)
  - Optionally store `lastProviderOfferRef` (for traceability)

If a duplicate is a false positive, impact is considered acceptable for v1 because:

- Company metrics are designed to reflect interest/activity, not strict HR taxonomy.
- DB cleanliness is prioritized over perfect dedupe recall/precision.

## Interaction with aggregation metrics

Reposts should **increase activity signals**.
Aggregation uses “activity-weighted” counts, meaning reposting increases:

- `offerCount`
- `strongOfferCount`
- any related activity counters

Additionally, we will expose both:

- `uniqueOfferCount` (number of canonical offers)
- `offerCount` (activity-weighted count including reposts)

This keeps explainability while preserving the intended “interest intensity” effect.

## Interaction with freshness

- Reposting refreshes confidence.
- Canonical offer `lastSeenAt` is updated on every detected repost and will drive recency indicators such as `lastStrongAt`.

## Persistence constraints

- We store raw `title` and raw `description` only; normalized forms are derived at runtime.
- Prefer compute over DB growth; avoid storing large duplicated text blobs.
