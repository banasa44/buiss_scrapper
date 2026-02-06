# Catalog Configuration Audit (catalog.json Only)

This document describes exactly how `data/catalog.json` is structured and how it is used in the current implementation. All behavior described here is grounded in code paths that consume the catalog.

## 1) Schema Explanation (All Fields)

### Top-Level Structure
| Field | Purpose | Type | Constraints / Validation | Default Behavior | Code Interactions |
| --- | --- | --- | --- | --- | --- |
| `version` | Catalog version identifier (semantic version string). | `string` | Must be a non-empty string. Validation in `src/utils/catalogValidation.ts`. | No default. Missing/empty version causes validation error. | Loaded into `CatalogRuntime.version` in `src/catalog/loader.ts`. Not used for logic or gating in the codebase. |
| `categories` | Defines category taxonomy and tier strength. | `array` of `CategoryRaw` | Array must be non-empty. Each category object validated. Duplicate `id` not allowed. | No default. Missing/empty array causes validation error. | Compiled into `CatalogRuntime.categories` (`Map`) in `src/catalog/loader.ts`. Used by scorer (`src/signal/scorer/scorer.ts`) to get tier weight. |
| `keywords` | Keyword definitions and their aliases. | `array` of `KeywordRaw` | Array must be non-empty. Each keyword validated. `categoryId` must reference an existing category. Duplicate keyword `id` not allowed. | No default. Missing/empty array causes validation error. | Compiled into `CatalogRuntime.keywords` as alias token sequences in `src/catalog/loader.ts`. Consumed by matcher in `src/signal/matcher/matcher.ts`. |
| `phrases` | Phrase definitions for independent scoring boosts. | `array` of `PhraseRaw` | Array must exist; can be empty. Each phrase validated if present. Duplicate phrase `id` not allowed. | Empty array allowed. Missing array causes validation error. | Compiled into `CatalogRuntime.phrases` as token sequences in `src/catalog/loader.ts`. Consumed by phrase matcher in `src/signal/matcher/matcher.ts`. |

### Category Object (`CategoryRaw`)
| Field | Purpose | Type | Constraints / Validation | Default Behavior | Code Interactions |
| --- | --- | --- | --- | --- | --- |
| `id` | Stable identifier used across matching and scoring. | `string` | Non-empty string; unique across categories. | No default. | Used as key in `CatalogRuntime.categories` map (`src/catalog/loader.ts`). Stored in `MatchHit.categoryId` (`src/types/matching.ts`). Determines category scoring weight via tier (`src/signal/scorer/scorer.ts`). |
| `name` | Human-readable label for export/display. | `string` | Non-empty string. | No default. | Used for Sheets export label resolution in `src/sheets/companyRowMapper.ts` via catalog lookup. |
| `tier` | Strength tier (1–3) used to weight scoring. | `number` (1, 2, or 3) | Must be 1, 2, or 3. Validation in `src/utils/catalogValidation.ts`. | No default. | Scoring weight comes from `TIER_WEIGHTS` in `src/constants/scoring.ts`. |

### Keyword Object (`KeywordRaw`)
| Field | Purpose | Type | Constraints / Validation | Default Behavior | Code Interactions |
| --- | --- | --- | --- | --- | --- |
| `id` | Stable keyword identifier. | `string` | Non-empty string; unique across keywords. | No default. | Stored in `MatchHit.keywordId` (`src/types/matching.ts`). Used only for explainability and aggregation in `ScoreResult.reasons`. |
| `categoryId` | Links keyword to a category. | `string` | Must reference an existing `categories[].id`. | No default. | Determines scoring tier via category lookup in `src/signal/scorer/scorer.ts`. |
| `canonical` | Display-friendly keyword name. | `string` | Non-empty string. | No default. | Preserved in `CatalogRuntime.keywords` for potential display/debug; not used in scoring calculations. |
| `aliases` | List of strings to match in offer text. | `string[]` | Non-empty array; each alias must be a non-empty string. | No default. | Each alias is normalized to tokens (`normalizeToTokens`) and expanded into `CatalogRuntime.keywords` in `src/catalog/loader.ts`. Identical normalized aliases are deduplicated within a keyword. |

### Phrase Object (`PhraseRaw`)
| Field | Purpose | Type | Constraints / Validation | Default Behavior | Code Interactions |
| --- | --- | --- | --- | --- | --- |
| `id` | Stable phrase identifier. | `string` | Non-empty string; unique across phrases. | No default. | Stored in `PhraseMatchHit.phraseId` and `PhraseContribution.phraseId`. |
| `phrase` | Raw phrase text to be matched. | `string` | Non-empty string. | No default. | Normalized to tokens via `normalizeToTokens` during catalog compilation in `src/catalog/loader.ts`. |
| `tier` | Phrase tier (1–3). | `number` (1, 2, or 3) | Must be 1, 2, or 3. | No default. | Currently **not used** in scoring. Phrase points are fixed by `PHRASE_BOOST_POINTS` in `src/constants/scoring.ts`. The tier is stored but ignored by scoring logic. |

### Normalization and Tokenization (applies to keywords and phrases)
- Normalization is done by `normalizeToTokens` in `src/utils/text/textNormalization.ts`.
- Steps: lowercase → remove diacritics → split on `TOKEN_SEPARATOR_PATTERN` in `src/constants/textNormalization.ts` → drop empty tokens.
- Important for matching: the matching logic uses exact token sequences, not substrings or regex. Hyphens and underscores are separators; plus signs are preserved (see `TOKEN_SEPARATOR_PATTERN`).

## 2) Categories (Current Catalog)

Scoring weights for tiers come from `src/constants/scoring.ts`:
- `TIER_WEIGHTS`: tier 3 = 4.0, tier 2 = 2.5, tier 1 = 1.0
- `FIELD_WEIGHTS`: title = 1.5, description = 1.0
- Category contribution per hit = `tierWeight × fieldWeight` (`src/signal/scorer/scorer.ts`).
- Max 1 contribution per category per offer (no stacking), enforced in `src/signal/scorer/scorer.ts`.

| Category ID | Label | Tier | Weight (Title / Description) | Thresholds | Enabled? | Scoring Influence |
| --- | --- | --- | --- | --- | --- | --- |
| `cat_cloud_infra` | Cloud Infrastructure | 3 | 6.0 / 4.0 | None (no per-category threshold) | Yes (no disable flag exists) | If any keyword in this category matches, contributes up to 6.0 (title) or 4.0 (description) once per offer. |
| `cat_ads_platforms` | Advertising Platforms | 3 | 6.0 / 4.0 | None | Yes | Same as above; contributes tier-3 points once per offer. |
| `cat_payments` | Global Payments | 3 | 6.0 / 4.0 | None | Yes | Same as above; contributes tier-3 points once per offer. |
| `cat_crm` | CRM & Marketing Automation | 2 | 3.75 / 2.5 | None | Yes | Contributes tier-2 points once per offer. |
| `cat_analytics` | Data & Analytics | 2 | 3.75 / 2.5 | None | Yes | Contributes tier-2 points once per offer. |
| `cat_collaboration` | Collaboration Tools | 1 | 1.5 / 1.0 | None | Yes | Contributes tier-1 points once per offer. |

Notes on thresholds:
- There is a global `STRONG_THRESHOLD = 6` in `src/constants/scoring.ts` that classifies an offer as “strong” when `score >= 6`. This is not category-specific.

## 3) Keywords (Current Catalog)

Matching mode (applies to all keywords):
- Exact token sequence matching (single-token or multi-token). No substring matching, no regex. Implemented in `src/signal/matcher/matcher.ts` using normalized tokens from `normalizeToTokens`.
- Only `title` and `description` are matched. Company name is explicitly excluded in `src/signal/matcher/matcher.ts` to avoid false positives.
- Negation is contextual and not part of the catalog: matches are marked `isNegated` if a negation cue appears within windowed tokens (see `src/signal/matcher/negation.ts` and `src/constants/negation.ts`).

Scoring contribution (applies to all keywords):
- Keywords inherit category tier weights (no per-keyword weights in the catalog).
- Max 1 contribution per category per offer (even if multiple keywords in the same category match).
- Final score is the sum of category contributions plus phrase boosts, then clamped to [0, 10] and rounded (`src/signal/scorer/scorer.ts`).

| Keyword ID | Category | Canonical | Aliases (normalized by tokenization) | Matching Mode | Weight Contribution | Caps / Limits | Negative Keywords / Exclusions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kw_aws` | `cat_cloud_infra` | AWS | `aws`, `amazon web services`, `ec2`, `s3`, `lambda` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None in catalog; only contextual negation via `isNegated` |
| `kw_gcp` | `cat_cloud_infra` | GCP | `gcp`, `google cloud`, `google cloud platform` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_azure` | `cat_cloud_infra` | Azure | `azure`, `microsoft azure` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_google_ads` | `cat_ads_platforms` | Google Ads | `google ads`, `adwords`, `google adwords` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_meta_ads` | `cat_ads_platforms` | Meta Ads | `meta ads`, `facebook ads`, `instagram ads` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_tiktok_ads` | `cat_ads_platforms` | TikTok Ads | `tiktok ads`, `tiktok for business` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_stripe` | `cat_payments` | Stripe | `stripe`, `stripe payments` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_adyen` | `cat_payments` | Adyen | `adyen` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_paypal` | `cat_payments` | PayPal | `paypal`, `braintree` | Exact token sequence | Tier 3 weight × field weight | Max 1 per category per offer | None |
| `kw_salesforce` | `cat_crm` | Salesforce | `salesforce`, `sfdc` | Exact token sequence | Tier 2 weight × field weight | Max 1 per category per offer | None |
| `kw_hubspot` | `cat_crm` | HubSpot | `hubspot` | Exact token sequence | Tier 2 weight × field weight | Max 1 per category per offer | None |
| `kw_tableau` | `cat_analytics` | Tableau | `tableau` | Exact token sequence | Tier 2 weight × field weight | Max 1 per category per offer | None |
| `kw_powerbi` | `cat_analytics` | Power BI | `power bi`, `powerbi` | Exact token sequence | Tier 2 weight × field weight | Max 1 per category per offer | None |
| `kw_slack` | `cat_collaboration` | Slack | `slack` | Exact token sequence | Tier 1 weight × field weight | Max 1 per category per offer | None |
| `kw_jira` | `cat_collaboration` | Jira | `jira`, `atlassian jira` | Exact token sequence | Tier 1 weight × field weight | Max 1 per category per offer | None |

## 4) Phrases (Current Catalog)

Definition format:
- Each phrase is a raw string in `phrases[].phrase`.
- During catalog compilation (`src/catalog/loader.ts`), phrases are normalized into token sequences using `normalizeToTokens` (`src/utils/text/textNormalization.ts`).

Multi-word phrase matching:
- Matching is **exact consecutive token sequence** (same algorithm as multi-token keywords) in `src/signal/matcher/matcher.ts`.
- Single-token phrases match on exact token equality.

Precedence vs keywords:
- Phrase matches are **independent** of keyword matches. Phrase boosts are added after category points in `src/signal/scorer/scorer.ts`.
- No precedence or suppression exists between phrases and keywords. Both can match the same text independently.

Overlap resolution rules:
- Phrase contributions are deduplicated by phrase ID: multiple occurrences of the same phrase count once per offer (`aggregatePhraseContributions` in `src/signal/scorer/scorer.ts`).
- Negated phrase hits are excluded before scoring (`isNegated` in `src/signal/matcher/negation.ts`).

Phrase scoring behavior:
- Each unique phrase contributes `PHRASE_BOOST_POINTS = 1.5` regardless of `phrases[].tier` (`src/constants/scoring.ts`). Phrase tier is currently **not used**.

| Phrase ID | Phrase Text | Tier | Matching Mode | Scoring Contribution |
| --- | --- | --- | --- | --- |
| `phrase_usd` | USD | 3 | Exact token sequence | +1.5 per unique phrase |
| `phrase_multicurrency` | multidivisa | 3 | Exact token sequence | +1.5 per unique phrase |
| `phrase_international_payments` | pagos internacionales | 3 | Exact token sequence | +1.5 per unique phrase |
| `phrase_global_expansion` | expansión internacional | 2 | Exact token sequence | +1.5 per unique phrase |
| `phrase_forex` | foreign exchange | 3 | Exact token sequence | +1.5 per unique phrase |

## 5) Versioning and Lifecycle

- `catalog.json` is loaded from the path in `src/constants/catalog.ts` each time `ingestOffers()` runs (`src/ingestion/ingestOffers.ts` calls `loadCatalog()` once per batch).
- The `version` field is validated and stored in `CatalogRuntime.version` (`src/catalog/loader.ts`), but **not used** to gate, migrate, or trigger reprocessing.
- Scores are computed at ingestion time and stored in the `matches` table (`src/db/repos/matchesRepo.ts`). There is **no code path** in the repository that automatically recomputes existing scores when the catalog changes.
- Company aggregation uses stored scores from `matches` (`src/db/repos/offersRepo.ts` + `src/signal/aggregation/aggregateCompany.ts`). Changing the catalog does not automatically update existing aggregated metrics.
- Sheets export uses the **current** catalog to resolve `top_category_id` into a label (`src/sheets/companyRowMapper.ts`). If a category ID is removed or renamed in the catalog, the exporter will fall back to the raw ID (see `resolveCategoryLabel` in `src/sheets/companyRowMapper.ts`).

## 6) Edge Cases (As Implemented)

- Ambiguous matches between keywords: if two different keywords (possibly in different categories) share the same alias token sequence, the matcher will record **both** hits. Scoring will then apply at most one contribution per category (`src/signal/scorer/scorer.ts`).
- Collisions within the same keyword: identical aliases normalize to the same token sequence and are deduplicated during catalog compilation (`src/catalog/loader.ts`).
- Multi-word alias or phrase must match **consecutive** tokens; partial sequences do not match (`src/signal/matcher/matcher.ts`).
- Tokenization is strict: separators include whitespace, punctuation, hyphens, and underscores (`src/constants/textNormalization.ts`). This can split common compound forms into multiple tokens, affecting multi-word matching.
- Diacritics are removed (`removeDiacritics` in `src/utils/text/removeDiacritics.ts`), so “expansión” becomes “expansion” during matching.
- No stopword removal, stemming, or lemmatization (`src/utils/text/textNormalization.ts`). Exact token sequences are required.
- Multilingual behavior depends entirely on provided aliases/phrases; there is no language detection or translation. Negation cues are limited to `no`, `sin`, `not`, `without` (`src/constants/negation.ts`).
- Phrase tiers are validated but currently **ignored** for scoring (all phrases use fixed `PHRASE_BOOST_POINTS` in `src/constants/scoring.ts`).

