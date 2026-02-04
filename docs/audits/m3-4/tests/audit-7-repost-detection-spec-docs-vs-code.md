# Audit: Repost detection spec (docs + current code)

Goal: extract the exact intended repost/duplicate detection algorithm from docs and compare it to current implementation.

## 1) Spec from docs (exact algorithm)
Source: `docs/M4/03_define_repost_detection.md` plus M4 aggregation notes in `docs/M4/01_define_agg_strategy.md` and `docs/M4/M4.B3.2b_IMPLEMENTATION_SUMMARY.md`.

### Scope + constraints
- Scope: **within the same companyKey only**; dedupe is historical (new offers compared against already persisted offers for that companyKey).
- Deterministic and cheap: **no ML/embeddings**, only DB-stored data.
- Must avoid deduplicating distinct roles.
- Prefer compute over DB growth; avoid storing large duplicated text blobs.

### Canonical model
- Maintain **canonical offers** per company (unique offers after dedupe).
- If an incoming offer is a duplicate of an existing canonical offer:
  - **Do not persist a new offer row**.
  - Update canonical offer “seen” metadata + counters.

### Duplicate definition (two-stage rule)
Inputs: normalized tokens derived from raw `title` and raw `description`.

1) **Stage 1 — Title gate**
   - If normalized title matches **strongly** (exact or near-exact after normalization), it is a strong duplicate candidate and uses a **lower** description threshold.
   - Title-only equality is **not sufficient**.

2) **Stage 2 — Description similarity**
   - Compute **token similarity** between normalized descriptions.
   - Thresholds:
     - Default duplicate threshold: **>= 90%** token similarity.
     - If title strongly matches: use a **lower** threshold (TBD constant, suggested 80–85%).

### What happens on duplicate
- Do not persist a new offer record.
- Update canonical offer:
  - `repostCount += 1`
  - `lastSeenAt = now()` (or run timestamp)
  - Optionally store `lastProviderOfferRef` for traceability.

### Interaction with aggregation
- Canonical offers only contribute to metrics.
- Reposts should **increase activity signals**:
  - `offerCount` (activity-weighted)
  - `strongOfferCount` and related activity counters
- Expose both:
  - `uniqueOfferCount` (canonical count)
  - `offerCount` (activity-weighted count including reposts)
- `lastSeenAt` should drive recency indicators such as `lastStrongAt`.

### Unspecified items in docs
- **Token similarity metric** is not defined (e.g., Jaccard vs multiset overlap).
- **“Strong title match”** threshold is not defined.
- **Tie-break behavior** if multiple canonical offers are similar is not defined.

## 2) Current implementation state (what exists vs missing)

### Implemented today
- Ingestion dedupe is **only** by `(provider, provider_offer_id)` via `upsertOffer` (unique constraint). `src/ingestion/offerPersistence.ts`, `src/db/repos/offersRepo.ts:17-78`.
- Canonicalization fields exist in schema and types (`canonical_offer_id`, `repost_count`, `last_seen_at`, `content_fingerprint`). `migrations/0004_offer_canonicalization.sql`, `src/types/db.ts:101-169`.
- Aggregation **expects** canonicalization fields:
  - Filters to `canonicalOfferId === null`.
  - Uses `repostCount` to weight `offerCount`.
  - Does **not** use `last_seen_at`; it uses `publishedAt`/`updatedAt` for `lastStrongAt`. `src/signal/aggregation/mapCompanyOfferRows.ts`, `src/signal/aggregation/aggregateCompany.ts`.

### Not implemented / missing
- No content-based duplicate detection or title/description similarity check.
- No computation or storage of `content_fingerprint`.
- No use of `findCanonicalOffersByFingerprint`, `markOfferAsDuplicate`, or `incrementOfferRepostCount` in ingestion.
- Repost activity is effectively **ignored** today (all offers treated as canonical; `repost_count` stays `0`).
- `last_seen_at` never updated; `lastStrongAt` does not reflect reposts.

### Behavior mismatch vs docs
- Docs: “Do not persist a new offer row on duplicate.”
  - Current: distinct provider_offer_ids always create rows; no content-based dedupe.
- Docs: “Reposts update `repostCount` and `lastSeenAt`.”
  - Current: no updates occur.
- Docs: “Recency should use `lastSeenAt`.”
  - Current: recency uses `publishedAt`/`updatedAt` only.

## 3) Decisions needed
1) **Similarity metric** for description tokens (Jaccard? multiset overlap? cosine?).
2) **Strong title match** definition and threshold; choose the lower description threshold value (docs suggest ~80–85%).
3) **Candidate selection** strategy:
   - Scan all canonical offers for company, or
   - Use `content_fingerprint` index to prefilter (define fingerprint formula).
4) **Persistence model for duplicates**:
   - Follow docs strictly (no duplicate row), or
   - Store duplicate row with `canonical_offer_id` for traceability (conflicts with “keep DB clean”).
5) **Timestamp semantics** for `lastSeenAt` (run timestamp vs offer publishedAt).
6) **Handling missing description** (summary offers): allow title-only gate? skip dedupe? require description? (docs say title-only is insufficient).
7) **Counters/telemetry**: should duplicates be counted as `skipped`, or tracked with a dedicated counter?

## 4) Minimal implementation plan (small tasks, no stubs)
1) **Define dedupe constants + helpers**
   - Add a deterministic token similarity function (reuse `normalizeToTokens`).
   - Define constants: default description threshold (0.90), title-match threshold, lowered description threshold for strong title match.
2) **Select candidate offers**
   - Option A: add repo method to list canonical offers for a company with `title` + `description` for comparison.
   - Option B: implement `content_fingerprint` and use `findCanonicalOffersByFingerprint` to prefilter, then confirm with similarity checks.
3) **Integrate dedupe into ingestion**
   - After company persistence but before offer upsert, compare incoming offer to canonical offers for the same company.
   - If duplicate: call `incrementOfferRepostCount(canonicalId, now/run timestamp)`, optionally store last provider ref, and **skip** offer upsert + scoring.
4) **Canonical record updates for non-duplicates**
   - After upsert, set canonicalization fields (`content_fingerprint`, `last_seen_at`) using `updateOfferCanonical`.
5) **Align aggregation recency**
   - Extend `listCompanyOffersForAggregation`/`mapCompanyOfferRows` to include `last_seen_at` and have `aggregateCompany` prefer it for `lastStrongAt` (per docs).
6) **Add targeted tests**
   - Duplicate detection produces no new offer row; canonical `repost_count` increments; aggregation `offerCount` reflects reposts; `lastStrongAt` tracks reposts.

