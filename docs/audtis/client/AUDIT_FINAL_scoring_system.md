# Client Audit: Scoring and Classification System

## 1) Executive Summary
This system ingests job offers, detects USD/FX exposure signals using a curated catalog of keywords and phrases, converts those matches into an offer score (0–10), and aggregates multiple offers into a single company-level view. The outputs are exported to Google Sheets for client review and resolution.

What it enables:
- Identification of companies with the strongest USD/FX exposure signals based on offer content.
- A consistent, auditable scoring rubric that can be sorted and filtered in Sheets.
- Company-level prioritization using aggregated metrics such as max score, strong-offer count, and posting activity.

High-level flow:
1. Ingest offers and persist them to the DB.
2. Normalize offer text and match catalog keywords and phrases.
3. Score each offer (0–10) and store a detailed explanation JSON in the `matches` table.
4. Aggregate all canonical offers per company into company metrics.
5. Export company metrics to Google Sheets for review.

If any of these steps is not implemented, it is called out explicitly below.

---

## 2) Data Model

### Offer-Level Artifacts
Stored in the database:
- `offers` table (`src/types/db.ts`): includes title, description, timestamps, and canonicalization fields (`canonical_offer_id`, `repost_count`, `last_seen_at`, `content_fingerprint`).
- `matches` table (`migrations/0001_init.sql`, `src/types/db.ts`): one row per offer with `score`, `matched_keywords_json`, and `computed_at`.

Scoring explanation stored:
- `matched_keywords_json` contains a serialized `ScoreResult` (`src/types/scoring.ts`), including:
  - Final score and top category.
  - Raw score and contributions by category and phrase.
  - Counts of negated hits.
- The `matches.reasons` column exists but is not populated by current ingestion code (`src/db/repos/matchesRepo.ts`).

Offer classification beyond scoring:
- Duplicate/repost classification is performed before scoring and can prevent an offer from being scored (see “Matching Logic” below).

### Company-Level Artifacts
Stored in the database (`companies` table in `src/types/db.ts` and `migrations/0003_company_aggregation_signals.sql`):
- `max_score`
- `offer_count`
- `unique_offer_count`
- `strong_offer_count`
- `avg_strong_score`
- `top_category_id`
- `top_offer_id`
- `category_max_scores` (JSON string)
- `last_strong_at`
- `resolution` (client lifecycle field from Sheets, `migrations/0006_add_company_resolution.sql`)

### What Is Stored Where
- Offer scores and explanations: `matches.matched_keywords_json` (DB).
- Company aggregates: `companies` table (DB).
- Client-facing view: Google Sheets export (subset of company fields only).

---

## 3) Catalog Configuration (data/catalog.json)

The catalog is the single source of truth for categories, keywords, and phrases. It is loaded and compiled at runtime (`src/catalog/loader.ts`) and validated (`src/utils/catalogValidation.ts`).

### Categories (Tier-Weighted)
Tier weights are defined in `src/constants/scoring.ts`:
- Tier 3 = 4.0 points
- Tier 2 = 2.5 points
- Tier 1 = 1.0 points

Category contributions are multiplied by field weight (title = 1.5, description = 1.0).

| Category ID | Label | Tier | Weight (Title / Description) |
| --- | --- | --- | --- |
| `cat_cloud_infra` | Cloud Infrastructure | 3 | 6.0 / 4.0 |
| `cat_ads_platforms` | Advertising Platforms | 3 | 6.0 / 4.0 |
| `cat_payments` | Global Payments | 3 | 6.0 / 4.0 |
| `cat_crm` | CRM & Marketing Automation | 2 | 3.75 / 2.5 |
| `cat_analytics` | Data & Analytics | 2 | 3.75 / 2.5 |
| `cat_collaboration` | Collaboration Tools | 1 | 1.5 / 1.0 |

There is no enabled/disabled flag in the schema. All categories listed are active.

### Keywords (Exact Token Matching)
Every keyword is linked to a category and has one or more aliases. All aliases are matched using exact token sequences (not substring or regex).

| Keyword ID | Category | Canonical | Aliases |
| --- | --- | --- | --- |
| `kw_aws` | `cat_cloud_infra` | AWS | aws, amazon web services, ec2, s3, lambda |
| `kw_gcp` | `cat_cloud_infra` | GCP | gcp, google cloud, google cloud platform |
| `kw_azure` | `cat_cloud_infra` | Azure | azure, microsoft azure |
| `kw_google_ads` | `cat_ads_platforms` | Google Ads | google ads, adwords, google adwords |
| `kw_meta_ads` | `cat_ads_platforms` | Meta Ads | meta ads, facebook ads, instagram ads |
| `kw_tiktok_ads` | `cat_ads_platforms` | TikTok Ads | tiktok ads, tiktok for business |
| `kw_stripe` | `cat_payments` | Stripe | stripe, stripe payments |
| `kw_adyen` | `cat_payments` | Adyen | adyen |
| `kw_paypal` | `cat_payments` | PayPal | paypal, braintree |
| `kw_salesforce` | `cat_crm` | Salesforce | salesforce, sfdc |
| `kw_hubspot` | `cat_crm` | HubSpot | hubspot |
| `kw_tableau` | `cat_analytics` | Tableau | tableau |
| `kw_powerbi` | `cat_analytics` | Power BI | power bi, powerbi |
| `kw_slack` | `cat_collaboration` | Slack | slack |
| `kw_jira` | `cat_collaboration` | Jira | jira, atlassian jira |

There are no negative keyword lists or exclusion rules in the catalog; negation is handled contextually during matching.

### Phrases (Fixed Boosts)
Phrases provide an independent score boost when matched. All phrases are matched as exact token sequences.

| Phrase ID | Phrase Text | Tier | Scoring Impact |
| --- | --- | --- | --- |
| `phrase_usd` | USD | 3 | +1.5 per unique phrase |
| `phrase_multicurrency` | multidivisa | 3 | +1.5 per unique phrase |
| `phrase_international_payments` | pagos internacionales | 3 | +1.5 per unique phrase |
| `phrase_global_expansion` | expansión internacional | 2 | +1.5 per unique phrase |
| `phrase_forex` | foreign exchange | 3 | +1.5 per unique phrase |

Phrase tier is validated but not used in scoring; all phrases contribute the same fixed boost (`PHRASE_BOOST_POINTS = 1.5` in `src/constants/scoring.ts`).

---

## 4) Matching Logic

### Text Processing
The system normalizes text using `normalizeToTokens` (`src/utils/text/textNormalization.ts`):
- Lowercase all text.
- Remove diacritics (NFD normalization + strip combining marks).
- Split on a fixed separator regex (`src/constants/textNormalization.ts`): whitespace, punctuation, slashes, brackets, commas, quotes, hyphens, underscores.
- Drop empty tokens.
- No stopword removal, stemming, lemmatization, or language detection.

### Fields Considered
- Title and description are matched.
- Company name is explicitly excluded from matching (`src/signal/matcher/matcher.ts`).

### Keyword Matching
- Each alias is matched as an exact token sequence.
- Single-token aliases match when the token is equal.
- Multi-token aliases match only when tokens appear consecutively.
- No regex or substring matching is used.

### Phrase Matching
- Phrases are matched using the same exact token sequence logic as multi-token keywords.
- Phrase matching runs independently of keyword matching.

### Negation Handling
Negation is implemented in `src/signal/matcher/negation.ts` with cues from `src/constants/negation.ts`:
- Negation cues: `no`, `sin`, `not`, `without`.
- Window: 8 tokens before a match and 2 tokens after a match.
- If a cue appears in the window, the hit is marked `isNegated = true` and excluded from scoring.

### Duplicate/Repost Classification (Pre-Scoring)
Offers can be classified as duplicates before scoring (`src/signal/repost/repostDetection.ts`, `src/signal/repost/offerFingerprint.ts`):
1. Fingerprint match: if normalized title+description produce the same SHA-256 fingerprint as an existing canonical offer, the new offer is treated as a repost.
2. Exact title match: if normalized title tokens match exactly, it is treated as a repost.
3. Description similarity: if token-overlap similarity >= 0.90 (`DESC_SIM_THRESHOLD` in `src/constants/repost.ts`), it is treated as a repost.

If a repost duplicate is detected, no new offer row is inserted and the offer is not scored; instead the canonical offer’s `repost_count` is incremented.

---

## 5) Scoring Model

### Weights and Constants (`src/constants/scoring.ts`)
- Tier weights: tier 3 = 4.0, tier 2 = 2.5, tier 1 = 1.0
- Field weights: title = 1.5, description = 1.0
- Phrase boost: +1.5 per unique phrase
- Max score: 10 (scores are clamped and rounded)
- Strong threshold: 6 (used for aggregation)

### Exact Formula (Implementation-Derived)
1. Remove negated keyword and phrase hits.
2. For each category, keep the **maximum** points among its hits.
3. Add +1.5 for each unique phrase matched.
4. `rawScore = sum(categoryPoints) + sum(phrasePoints)`
5. `finalScore = round(clamp(rawScore, 0, 10))`
6. `topCategoryId = category with highest points, or empty string if none`

Pseudocode from `src/signal/scorer/scorer.ts`:

```ts
activeKeywordHits = keywordHits.filter(h => !h.isNegated)
activePhraseHits = phraseHits.filter(h => !h.isNegated)

categoryPoints = max-per-category(tierWeight * fieldWeight)
phrasePoints = 1.5 * (count of unique phrase IDs)

rawScore = sum(categoryPoints) + sum(phrasePoints)
finalScore = round(clamp(rawScore, 0, 10))
```

### Strong Classification
- An offer is “strong” if `score >= 6` (`STRONG_THRESHOLD`).

---

## 6) Aggregation Model (Company-Level)

Aggregation is performed in `src/signal/aggregation/aggregateCompany.ts` using only canonical offers (`canonical_offer_id IS NULL`).

### Metric Definitions (As Implemented)
- `max_score`: maximum score across canonical offers.
- `offer_count`: activity-weighted count, `sum(1 + repost_count)` for canonical offers.
- `unique_offer_count`: number of canonical offers.
- `strong_offer_count`: count of canonical offers with score ≥ 6.
- `avg_strong_score`: mean score of strong canonical offers; `null` if none.
- `top_offer_id`: canonical offer with highest score; ties broken by most recent timestamp, then lowest ID (DB order by ID).
- `top_category_id`: the `topCategoryId` of the top offer.
- `category_max_scores`: map `{ topCategoryId: max offer score }` across canonical offers.
- `last_strong_at`: most recent timestamp among strong canonical offers (`publishedAt` preferred over `updatedAt`).

### Tie-Breaking Rules
- Higher score wins.
- If equal score, the more recent timestamp wins (`publishedAt` > `updatedAt`).
- If timestamps are equal or missing, the earlier offer ID (DB order) wins.

### Re-Aggregation Behavior
- Aggregation is deterministic and idempotent. Rerunning aggregation overwrites metrics with values computed from current DB state (`aggregateCompanyAndPersist`).
- There is no automatic re-aggregation triggered by catalog changes or offer deletions; it must be run explicitly.

---

## 7) Interpretation Guide

### Offer Scores (0–10)
- `0`: No non-negated keyword or phrase matches.
- `1–5`: Low to moderate signal. Typically phrase-only matches or a single tier-2/tier-3 match in description.
- `6+`: Strong signal (the system uses this threshold explicitly for “strong offers”).
- `10`: Very strong signal; typically multiple tier-3 categories plus phrase boosts. Scores are capped at 10.

### Company Metrics
- `max_score`: strongest single offer signal for the company.
- `strong_offer_count`: count of strong offers (score ≥ 6); higher is better.
- `offer_count`: posting activity including reposts. Higher suggests repeated postings or higher activity.
- `unique_offer_count`: number of distinct canonical offers.
- `avg_strong_score`: average strength of strong offers; `null` if no strong offers.
- `top_category`: label resolved from `top_category_id` using the catalog; empty if no category match.
- `last_strong_at`: recency of strong signal; empty if none.

### What “Good vs Bad” Means (As Implemented)
- The only explicit system threshold is `STRONG_THRESHOLD = 6`.
- “Good” in system terms therefore means `score >= 6` or a company with non-zero `strong_offer_count`.
- No other score bands or quality thresholds are defined in code.

---

## 8) Limitations & Risks

These are derived from current implementation and catalog design:

- Exact token matching only. No substring or regex matching means near-miss terms will not match.
- Negation is limited to four cues (`no`, `sin`, `not`, `without`) and fixed windows (8 tokens before, 2 after). Contextual negation beyond that is not detected.
- Phrases ignore tier. All phrases contribute the same +1.5 points even if their `tier` differs.
- Company names are excluded from matching, so signals present only in company names are ignored.
- Matching can occur inside URLs because tokenization splits URLs into tokens, which can yield false positives (e.g., `stripe.com`).
- No language detection or translation; coverage depends entirely on catalog aliases and phrases.
- Catalog changes do not trigger automatic rescoring of existing offers. Scores persist until offers are re-ingested and rescored.
- `category_max_scores` is based on each offer’s `topCategoryId` only. It does not represent all categories matched within an offer.

---

## 9) Examples (From Real Fixtures)

The following examples use actual fixtures in `tests/fixtures/infojobs/` and are computed according to the implemented logic.

### Example 1: Strong Multi-Signal Offer (fx01_strong_usd_signal.json)
**Offer text**
- Title: “Performance Marketing Manager (Google Ads, Meta) - Remote”
- Description: “We manage large Google Ads and Meta Ads budgets. Experience with AWS (EC2, S3) and payments via Stripe. We invoice in USD and work with international customers.”

**Matched keywords (non-negated)**
- Ads Platforms: `google ads` (title), `google ads` (description), `meta ads` (description)
- Cloud Infrastructure: `aws`, `ec2`, `s3` (description)
- Payments: `stripe` (description)

**Matched phrases (non-negated)**
- `usd`

**Score breakdown**
- Ads Platforms: tier 3 × title 1.5 = 6.0 (category cap)
- Cloud Infrastructure: tier 3 × description 1.0 = 4.0
- Payments: tier 3 × description 1.0 = 4.0
- Phrase boosts: 1 × 1.5 = 1.5
- Raw score = 15.5 → clamped to 10 → final score = 10
- `topCategoryId = cat_ads_platforms`

**Company impact (if this is the only canonical offer)**
- `max_score = 10`
- `strong_offer_count = 1`
- `avg_strong_score = 10`
- `offer_count = 1` (assuming repost_count = 0)
- `top_category_id = cat_ads_platforms`

### Example 2: Negation Removes a Keyword (fx02_negation_aws.json)
**Offer text**
- Title: “Backend Developer - Node.js”
- Description: “No experience with AWS required. You will work mostly on on-prem systems. Familiarity with Azure is a plus.”

**Matched keywords**
- `aws` is matched but **negated** due to nearby “no”.
- `azure` is matched and not negated.

**Score breakdown**
- Cloud Infrastructure (Azure): tier 3 × description 1.0 = 4.0
- Raw score = 4.0 → final score = 4
- `topCategoryId = cat_cloud_infra`
- `negatedKeywordHits = 1`

**Company impact (if this is the only canonical offer)**
- `max_score = 4`
- `strong_offer_count = 0`
- `avg_strong_score = null`

### Example 3: Phrase-Only Score (fx05_phrase_boost_fx.json)
**Offer text**
- Title: “Finance Operations Specialist”
- Description: “Gestion de pagos internacionales y facturacion multidivisa. Coordination with external providers and reporting in foreign exchange contexts.”

**Matched phrases**
- `pagos internacionales`
- `multidivisa`
- `foreign exchange`

**Score breakdown**
- No keyword matches.
- Phrase boosts: 3 × 1.5 = 4.5
- Raw score = 4.5 → rounded to final score = 5
- `topCategoryId = ""` (empty string, because no categories matched)

**Company impact (if this is the only canonical offer)**
- `max_score = 5`
- `strong_offer_count = 0`
- `avg_strong_score = null`
- `top_category_id` remains empty in DB (no category match)

---

## 10) Recommendations

These are actionable next steps to validate fit and reduce risk before production:

1. Perform a manual review of top-scoring offers and companies.
   - Confirm that high scores align with true USD/FX exposure.

2. Review low-scoring offers from known relevant companies.
   - Identify missing keywords or phrases to add to the catalog.

3. Validate false positives from URLs.
   - Decide whether to exclude URLs from tokenization or add filtering rules if this becomes a concern.

4. Calibrate phrase usage.
   - If phrase tiers are meant to differentiate strength, implement tier-aware phrase scoring or adjust phrase list to reflect equal weighting.

5. Plan for catalog change management.
   - Because rescoring is not automatic, define a process for recomputing scores and re-aggregating if the catalog is updated.

6. Expand negation cues if needed.
   - Add additional negation terms or language variants if client data shows gaps.

---

## Final Note
Every statement above is derived from the current implementation and `data/catalog.json`. Where the system does **not** implement a behavior (e.g., automatic rescoring on catalog change), this is explicitly stated. If you want any additional behavior, it will require a code change.
