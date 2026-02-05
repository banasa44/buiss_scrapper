# BUILD-3B1 — Selected Company Metric Columns for Sheet Export

## Purpose

Document the company metric columns selected for Google Sheets export, based on inspection of actual DB schema and aggregation signals from M4.

## Context

- DB schema defined in: migrations/0003_company_aggregation_signals.sql
- Company type defined in: src/types/db.ts
- Aggregation logic in: src/signal/aggregation/aggregateCompany.ts
- Design docs: docs/M4/01_define_agg_strategy.md

## Selection Criteria

1. **Client utility** - metrics that help sales qualify companies
2. **Stability** - computed by M4 aggregation, not prone to frequent schema changes
3. **Explainability** - client can understand what the number means
4. **Actionability** - client can make decisions based on the metric

## Selected Columns (10 total)

### Identity Columns (2)

| Sheet Column Name | DB Source Field          | Client-Facing Meaning                   | Stability |
| ----------------- | ------------------------ | --------------------------------------- | --------- |
| `company_id`      | `companies.id`           | Unique company identifier (primary key) | ✅ Stable |
| `company_name`    | `companies.name_display` | Human-readable company name             | ✅ Stable |

**Notes:**

- `company_id` already in schema (BUILD-3A), included here for completeness
- `name_display` preferred over `name_raw` or `normalized_name` for client readability
- Fallback logic: `name_display ?? normalized_name ?? "(no name)"`

---

### Feedback Column (1)

| Sheet Column Name | DB Source Field | Client-Facing Meaning | Stability |
|-------------------|-------------------|------------------------------------------|-----------||
| `resolution` | N/A (client input)| Client feedback on company relevance | ✅ Stable |

**Notes:**

- `resolution` is a client-editable column for feedback (not from DB)
- Valid values: "PENDING", "ALREADY_REVOLUT", "ACCEPTED", "REJECTED"
- Already in schema contract from BUILD-3A
- Defaults to "PENDING" for new companies
- Read by system on import, written by client on export

---

### Core Quality Metrics (3)

| Sheet Column Name | DB Source Field                | Client-Facing Meaning                     | Stability |
| ----------------- | ------------------------------ | ----------------------------------------- | --------- |
| `max_score`       | `companies.max_score`          | Highest relevance score (0-10 scale)      | ✅ Stable |
| `unique_offers`   | `companies.unique_offer_count` | Number of distinct job postings           | ✅ Stable |
| `strong_offers`   | `companies.strong_offer_count` | Number of high-quality offers (score ≥ 6) | ✅ Stable |

**Notes:**

- `max_score`: Primary quality indicator, M4 aggregation from offer scoring
- `unique_offer_count`: Counts canonical offers only (ignores reposts)
- `strong_offer_count`: Filters for offers with score ≥ STRONG_THRESHOLD (6.0)
- All metrics nullable until first aggregation run (null → display as empty or "N/A")

---

### Activity Metrics (2)

| Sheet Column Name  | DB Source Field              | Client-Facing Meaning                     | Stability |
| ------------------ | ---------------------------- | ----------------------------------------- | --------- |
| `posting_activity` | `companies.offer_count`      | Total posting activity (includes reposts) | ✅ Stable |
| `avg_strong_score` | `companies.avg_strong_score` | Average score of strong offers            | ✅ Stable |

**Notes:**

- `posting_activity`: Activity-weighted metric (1 + repost_count for each canonical offer)
- Indicates company's recruitment intensity (more postings = more active hiring)
- `avg_strong_score`: Simple average of scores ≥ 6.0 (NOT weighted by reposts)
- Null if no strong offers exist

---

### Evidence/Explainability Columns (1)

| Sheet Column Name | DB Source Field             | Client-Facing Meaning      | Stability      |
| ----------------- | --------------------------- | -------------------------- | -------------- |
| `top_category`    | `companies.top_category_id` | Best-matching job category | ⚠️ Semi-stable |

**Notes:**

- Exports the **human-readable category label** from catalog, not the raw ID
- Category resolved from the offer that produced `max_score`
- Tie-breaker: most recent offer timestamp (publishedAt > updatedAt)
- Helps client understand "what kind of jobs" the company posts
- Fallback to raw `top_category_id` if catalog lookup fails
- Semi-stable: category IDs from catalog may evolve (but unlikely to break)

---

### Freshness Indicator (1)

| Sheet Column Name | DB Source Field            | Client-Facing Meaning            | Stability |
| ----------------- | -------------------------- | -------------------------------- | --------- |
| `last_strong_at`  | `companies.last_strong_at` | Date of most recent strong offer | ✅ Stable |

**Notes:**

- Derived from offer publication timestamp (prefer `publishedAt`, fallback to `updatedAt`)
- Most recent timestamp from strong canonical offers (score ≥ 6.0)
- Exported as **date only** (YYYY-MM-DD format), not full timestamp
- Helps client assess if company is currently hiring or was historically active
- Null if no strong offers or no timestamps available

---

## Excluded Columns (with rationale)

| DB Column             | Reason for Exclusion                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `top_offer_id`        | Internal reference, not useful to client without full offer details    |
| `category_max_scores` | JSON blob, too complex for sheet format (requires column per category) |
| `website_url`         | May add in future export extension, but not critical for initial MVP   |
| `website_domain`      | Redundant with company name for client purposes                        |
| `created_at`          | Internal metadata, not actionable for sales                            |
| `updated_at`          | Internal metadata, superseded by `last_strong_at` for client use       |

---

## Column Ordering (Left-to-Right in Sheet)

Proposed order for optimal client UX:

1. `company_id` (identifier)
2. `company_name` (identity)
3. `resolution` (feedback column, already in schema from BUILD-3A)
4. `max_score` (primary quality signal)
5. `strong_offers` (quality indicator)
6. `unique_offers` (volume indicator)
7. `posting_activity` (activity indicator)
8. `avg_strong_score` (secondary quality)
9. `top_category` (explainability)
10. `last_strong_at` (freshness)

**Rationale:**

- Identity columns first (id, name, resolution)
- Primary quality signals next (max_score, strong_offers)
- Volume/activity metrics middle
- Explainability and freshness last

---

## Data Type Mapping (Sheet → DB)

| Sheet Column       | DB Type | Sheet Display Format   | Null Handling      |
| ------------------ | ------- | ---------------------- | ------------------ |
| `company_id`       | INTEGER | Number (no decimals)   | Never null (PK)    |
| `company_name`     | TEXT    | String                 | Fallback chain     |
| `resolution`       | TEXT    | Enum string            | Default: "PENDING" |
| `max_score`        | REAL    | Number (1 decimal)     | Empty if null      |
| `strong_offers`    | INTEGER | Number (no decimals)   | Empty if null      |
| `unique_offers`    | INTEGER | Number (no decimals)   | Empty if null      |
| `posting_activity` | INTEGER | Number (no decimals)   | Empty if null      |
| `avg_strong_score` | REAL    | Number (1 decimal)     | Empty if null      |
| `top_category`     | TEXT    | String (label, not ID) | Empty if null      |
| `last_strong_at`   | TEXT    | Date (YYYY-MM-DD)      | Empty if null      |

**Notes:**

- Scores displayed with 1 decimal place for readability (e.g., "7.5" not "7.500000")
- Timestamps truncated to date only (no time component) for client simplicity
- Empty cells preferred over "N/A" or "null" strings (cleaner visual)

---

## Future Extensions (Not in MVP)

Potential columns for future iterations:

- `website_url` - direct link to company website
- `category_breakdown` - top 3 categories with scores (requires multi-column or JSON)
- `repost_ratio` - `(posting_activity - unique_offers) / unique_offers` (spam indicator)
- `days_since_last_strong` - computed from `last_strong_at` (easier than ISO dates)
- `status` - e.g., "ACTIVE" (last_strong_at < 30 days), "DORMANT", "STALE"

---

## Implementation Notes for BUILD-4

When implementing the company-to-row mapper in BUILD-4:

1. **Name fallback chain:**

   ```typescript
   const name = company.name_display ?? company.normalized_name ?? "(no name)";
   ```

2. **Null handling:**
   - Metrics: `company.max_score ?? ""` (empty string, not "null")
   - Timestamps: format `last_strong_at` to YYYY-MM-DD if non-null, else empty

3. **Score formatting:**
   - Use `.toFixed(1)` for max_score and avg_strong_score
   - Keep integers as-is (no decimal formatting)

4. **Category resolution:**
   - Map `top_category_id` to human-readable label from catalog
   - Fallback to raw ID if catalog lookup fails

---

## Validation Checklist

- [x] All selected columns exist in DB schema (migrations/0003)
- [x] All columns populated by M4 aggregation (src/signal/aggregation/)
- [x] Column count within target range (10 total, 2 identity + 1 feedback + 7 metrics)
- [x] No circular dependencies or foreign keys requiring joins
- [x] All columns have clear client-facing meaning
- [x] Nullable columns have explicit null-handling strategy
- [x] Column ordering optimized for client UX
- [x] Data types compatible with sheet format (no complex objects)

---

## Summary

**Total Columns:** 10 (2 identity + 1 feedback + 7 metrics)

**Breakdown:**

- Identity: `company_id`, `company_name`
- Feedback: `resolution` (client-editable)
- Metrics: `max_score`, `unique_offers`, `strong_offers`, `posting_activity`, `avg_strong_score`, `top_category`, `last_strong_at`

**Stability:** 9 stable, 1 semi-stable (top_category depends on catalog)

**Source Confidence:** All metric columns inspected from actual DB schema, not guessed

**Client Value:** Covers quality (scores), volume (offer counts), activity (posting frequency), explainability (category), and freshness (last_strong_at)

**Ready for BUILD-4:** Yes, mapper can be implemented with these columns
