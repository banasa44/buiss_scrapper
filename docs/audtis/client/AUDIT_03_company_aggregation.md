# Company-Level Aggregation Layer (Implementation-Accurate)

This chapter explains how many offers become one summarized company view, exactly as implemented in the repository.

## 1) How Offer-Level Signals Become Company-Level Metrics

### Input Data and Which Offers Are Considered
- The aggregation pipeline reads **all offers** for a company from the database using `listCompanyOffersForAggregation` (`src/db/repos/offersRepo.ts`).
- The query LEFT JOINs `matches` and uses `COALESCE(m.score, 0)` so **unscored offers have score = 0**. It also pulls `matched_keywords_json` to parse `topCategoryId`.
- The pure aggregation function **filters to canonical offers only** (`canonical_offer_id IS NULL`). Duplicate/repost rows are excluded in `aggregateCompany` (`src/signal/aggregation/aggregateCompany.ts`).
- Duplicate activity still influences `offer_count` via `repost_count` on canonical offers.

### Per-Field Metric Definitions (As Persisted)

**`max_score`**
- Source: `aggregateCompany` (`src/signal/aggregation/aggregateCompany.ts`).
- Definition: maximum score across **canonical offers only**.
- Implementation: the “top offer” is selected; `max_score` is that offer’s score.
- If no canonical offers exist: `max_score = 0`.

**`offer_count`**
- Source: `aggregateCompany`.
- Definition: activity-weighted count of canonical offers, including reposts.
- Formula: `SUM(1 + repost_count)` over canonical offers only.
- If no canonical offers exist: `offer_count = 0`.

**`unique_offer_count`**
- Source: `aggregateCompany`.
- Definition: number of canonical offers (duplicates excluded).
- If no canonical offers exist: `unique_offer_count = 0`.

**`strong_offer_count`**
- Source: `aggregateCompany` + `mapCompanyOfferRows`.
- Definition: count of canonical offers whose `score >= STRONG_THRESHOLD`.
- `STRONG_THRESHOLD = 6` from `src/constants/scoring.ts`.
- Not weighted by reposts.
- If no canonical offers exist: `strong_offer_count = 0`.

**`avg_strong_score`**
- Source: `aggregateCompany`.
- Definition: arithmetic mean of scores of strong canonical offers.
- Formula: `sum(strong_scores) / strong_offer_count`.
- If `strong_offer_count = 0`, then `avg_strong_score = null`.

**`top_category_id`**
- Source: `aggregateCompany` + `listCompanyOffersForAggregation`.
- Definition: category ID of the **top offer** (the offer that produced `max_score`).
- `topCategoryId` is parsed from `matches.matched_keywords_json` in `listCompanyOffersForAggregation` (`src/db/repos/offersRepo.ts`). If parsing fails, `topCategoryId = null`.
- If no canonical offers exist: `top_category_id = null`.

**`top_offer_id`**
- Source: `aggregateCompany`.
- Definition: offer ID of the **top offer** (canonical only).
- Tie-breaking for top offer:
  - Higher score wins.
  - If scores equal, the more recent timestamp wins using `getOfferTimestamp(offer)` (`publishedAt` if present, otherwise `updatedAt`).
  - If timestamps are equal or both null, the earlier offer in the input list wins. Input order is DB `ORDER BY offers.id ASC` from `listCompanyOffersForAggregation`.
- If no canonical offers exist: `top_offer_id = null`.

**`category_max_scores`**
- Source: `aggregateCompany`.
- Definition: map `{ categoryId: maxScore }` computed across canonical offers only.
- Important nuance: `categoryId` here comes from each offer’s `topCategoryId` (parsed from `matches.matched_keywords_json`). It does **not** represent all categories matched by that offer, only the single top category per offer.
- If no canonical offers exist: `{}`.
- Persisted as JSON in `companies.category_max_scores` by `updateCompanyAggregation` (`src/db/repos/companiesRepo.ts`). Serialization errors store `null` and log a warning.

**`last_strong_at`**
- Source: `aggregateCompany`.
- Definition: most recent timestamp among **strong canonical offers**.
- Timestamp selection for each offer is `publishedAt ?? updatedAt ?? null`.
- If no strong canonical offers exist: `last_strong_at = null`.

### “Strong” Qualification
- A canonical offer is “strong” if `score >= STRONG_THRESHOLD`.
- `STRONG_THRESHOLD = 6` in `src/constants/scoring.ts`.
- `isStrong` is computed in `mapCompanyOfferRows` (`src/signal/aggregation/mapCompanyOfferRows.ts`).

### Ordering and Tie Rules (Exact)
- Top offer selection uses: higher score → more recent timestamp (`publishedAt` first, else `updatedAt`) → earlier offer ID (due to stable input order).
- Timestamp comparison uses string `localeCompare` on ISO timestamps (`compareTimestamps` in `aggregateCompany.ts`).

### Aggregation Flow (Pipeline)
1. Read offers + matches for a company: `listCompanyOffersForAggregation` (`src/db/repos/offersRepo.ts`).
2. Parse `topCategoryId` from `matched_keywords_json` for each offer.
3. Map rows to `AggregatableOffer` with `isStrong` (`mapCompanyOfferRows`).
4. Aggregate to `CompanyAggregation` (`aggregateCompany`).
5. Persist all metrics to `companies` (`aggregateCompanyAndPersist` → `updateCompanyAggregation`).

---

## 2) Lifecycle Behavior

### What Happens When Offers Are Deleted
- `deleteOffersByCompanyId` (`src/db/repos/offersRepo.ts`) deletes all offers for a company.
- Matches are deleted automatically via `ON DELETE CASCADE` on `matches.offer_id` (`migrations/0001_init.sql`).
- The function **never updates the companies table**. It explicitly guarantees that all company metrics remain unchanged (see comments in `deleteOffersByCompanyId`).

### What Metrics Are Preserved
- All company aggregation metrics (`max_score`, `offer_count`, etc.) are preserved when offers are deleted unless aggregation is explicitly rerun.
- The system does **not** automatically recompute metrics on deletion in the deletion function itself.

### Resolution Changes and Metrics
- `updateCompanyResolution` (`src/db/repos/companiesRepo.ts`) updates only `resolution` and `updated_at`.
- Metric columns are explicitly excluded in this update (see in-code guarantee comment).
- Ingestion skips offers for resolved companies (`ACCEPTED`, `REJECTED`, `ALREADY_REVOLUT`) in `src/ingestion/offerPersistence.ts`.

### Invariants Guaranteed by the System
- Aggregation is deterministic and idempotent. Running aggregation multiple times with unchanged DB state yields the same results (`aggregateCompanyAndPersist`).
- Resolution updates do not modify any aggregation metrics (`updateCompanyResolution`).
- Offer deletions do not modify any aggregation metrics (`deleteOffersByCompanyId`).

---

## 3) Sheets Export (Company Aggregates)

### Fields Exported to Google Sheets
Export is defined in `mapCompanyToSheetRow` (`src/sheets/companyRowMapper.ts`). Columns:
1. `company_id`
2. `company_name` (name_display → normalized_name → “(no name)”)
3. `resolution` (default `PENDING` on append)
4. `max_score`
5. `strong_offers` (`strong_offer_count`)
6. `unique_offers` (`unique_offer_count`)
7. `posting_activity` (`offer_count`)
8. `avg_strong_score`
9. `top_category` (label resolved via catalog)
10. `last_strong_at` (YYYY-MM-DD)

### Fields Not Exported
- `top_offer_id`
- `category_max_scores`
- Any offer-level signals or match explanations

### How Updates Are Applied
- **Append**: `appendNewCompaniesToSheet` appends new companies only; it uses the full 10-column row (`src/sheets/appendNewCompanies.ts`).
- **Update**: `updateCompanyMetricsInSheet` updates only metric columns (indices 3–9), leaving `company_id`, `company_name`, and `resolution` untouched (`src/sheets/updateCompanyMetrics.ts`, `src/utils/sheets/sheetsHelpers.ts`).

### Source of Truth (SSOT) by Field
- `company_id`: DB is SSOT, used to map rows in Sheets.
- `company_name`: DB is SSOT for export values, but updates do not overwrite existing Sheet values for name because updates only touch metric columns.
- `resolution`: Sheet is treated as the client input and is read back later for lifecycle changes; updates do not overwrite it.
- Metrics (`max_score`, `strong_offer_count`, `unique_offer_count`, `offer_count`, `avg_strong_score`, `top_category`, `last_strong_at`): DB is SSOT; Sheets are updated from DB metrics.

---

## 4) Edge Cases

### Company With No Canonical Offers
- Aggregation returns `max_score = 0`, `offer_count = 0`, `unique_offer_count = 0`, `strong_offer_count = 0`.
- `avg_strong_score = null`, `top_category_id = null`, `top_offer_id = null`, `category_max_scores = {}`, `last_strong_at = null`.

### Company With No Strong Offers
- `strong_offer_count = 0`, `avg_strong_score = null`, `last_strong_at = null`.
- Other metrics are computed normally from canonical offers.

### Company With Only Old Offers
- There is **no time decay** in aggregation. Old offers count the same as new ones.
- Timestamps are used only for tie-breaking (`top_offer_id`) and to compute `last_strong_at`.

### Conflicting Categories
- Each offer contributes exactly one `topCategoryId` (from score computation) to aggregation.
- `category_max_scores` uses only that `topCategoryId`; it does **not** track all categories matched within an offer.

### Resets and Re-Aggregations
- Re-running aggregation (`aggregateCompanyAndPersist`) recomputes from current DB state, overwriting stored metrics.
- If offers or matches are deleted, metrics will reflect that deletion **only after aggregation is re-run**.
- There is no automatic re-scoring or re-aggregation when the catalog changes; aggregation operates on stored scores in `matches`.

---

## Summary
The company-level layer is a deterministic, canonical-offer-only aggregation that derives a single summary record from per-offer scores and repost activity. It preserves metrics across resolution changes and offer deletions unless aggregation is explicitly rerun. The Sheets export exposes a subset of these metrics and treats the sheet as the input source for lifecycle resolution, while all numeric metrics remain DB-sourced.
