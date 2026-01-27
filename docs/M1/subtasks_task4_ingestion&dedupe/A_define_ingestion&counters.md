# M1.4-A — Ingestion & Dedupe (Write Path Definition)

## Goal

Define the exact write-path behavior to persist normalized offers idempotently,
without mixing scoring, aggregation, or scheduling concerns.

This task defines rules only. Implementation comes after.

---

## Inputs

- Normalized data:
  - `JobOfferSummary`
  - `JobOfferDetail`
- DB schema + repos from M1.1–M1.3
- Company identity rules (provider-agnostic)

---

## Core Rules (Final)

### 1) Offer identity (dedupe key)

- Offers are deduped by `(provider, provider_offer_id)` composite key.
- Enforced by DB UNIQUE constraint `uq_offer_provider_id`.

### 2) Upsert semantics (null handling)

- Upserts are **overwrite-based**:
  - If a field is `null/undefined` in the incoming input, the stored column becomes `NULL`.
  - No COALESCE / "keep old value" behavior.

### 3) Company identity requirement (skip behavior)

- A company is considered deterministically identifiable if **any** of the following exist:
  - `websiteDomain` OR `normalizedName` OR `providerCompanyId`
- If company cannot be deterministically identified:
  - **SKIP offer**
  - Log reason: `company_unidentifiable`
  - Increment `offers_skipped`

No placeholder/anonymous companies. No fuzzy matching.

### 4) Offer persistence policy

- Persist offers regardless of score.
- Score `0` is valid and does not affect ingestion.
- No filtering at ingestion time.

### 5) Raw data retention

- **M1 policy:** `offers.raw_json` is always `null` (no raw retention for simplicity).
- No raw retention in `company_sources` (skip storing raw company source JSON).
- Future milestones may revisit raw retention if debugging/auditing needs arise.

### 6) Runs

- Always create a row in `ingestion_runs` for each ingestion execution.
- `requests_count` and `http_429_count` are **not tracked in M1**:
  - set to `NULL` or `0` consistently (implementation choice), but do not attempt counting yet.

### 7) Error handling

Non-fatal (continue):

- One bad record must not stop ingestion:
  - log error
  - increment `offers_failed`
  - continue
- If `upsertCompanySource` fails:
  - log + increment `company_sources_failed`
  - **continue** (still persist offer)

Fatal (stop the whole run):

- DB unavailable / cannot open connection
- migrations not applied / schema mismatch preventing ingestion start

Per-offer DB errors:

- If `upsertOffer` fails for a single record → log + skip + continue (non-fatal)

### 8) Ingestion flow (logical)

For each normalized offer:

1. Resolve company identity evidence (websiteDomain / normalizedName / providerCompanyId)
   - If not resolvable → skip
2. Upsert company
3. Upsert company source (if applicable)
4. Upsert offer
5. Update counters:
   - offers_upserted
   - offers_skipped (with reason)
   - offers_failed
   - company_sources_failed (optional but recommended)

---

## Non-Goals

- scoring/matching (M2)
- freshness/repost (M3)
- aggregation (M3)
- scheduling/state (M5)
- unchanged vs updated detection
- cleanup/pruning policies
