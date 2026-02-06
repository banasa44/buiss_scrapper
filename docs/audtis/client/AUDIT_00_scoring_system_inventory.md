# Scoring & Classification System Inventory (Implementation Map)

## Scope And Sources Reviewed
- `data/catalog.json` (catalog source of truth: version 1.0.0, 6 categories, 15 keywords, 5 phrases)
- `src/constants/catalog.ts` (catalog path)
- `src/catalog/loader.ts` (catalog loading + compilation)
- `src/utils/catalogValidation.ts` (catalog validation)
- `src/utils/text/textNormalization.ts` (offer text normalization + tokenization)
- `src/utils/text/removeDiacritics.ts` (diacritic removal)
- `src/constants/textNormalization.ts` (token separator pattern)
- `src/signal/matcher/matcher.ts` (keyword + phrase matching)
- `src/signal/matcher/negation.ts` (negation windowing)
- `src/constants/negation.ts` (negation cues and windows)
- `src/signal/scorer/scorer.ts` (offer scoring)
- `src/constants/scoring.ts` (scoring parameters + thresholds)
- `src/types/matching.ts` (matching data model)
- `src/types/scoring.ts` (scoring data model)
- `src/ingestion/ingestOffers.ts` (matcher + scorer orchestration)
- `src/db/repos/matchesRepo.ts` (match persistence)
- `src/db/repos/offersRepo.ts` (aggregation query + topCategoryId parsing)
- `src/signal/aggregation/aggregateCompany.ts` (company aggregation)
- `src/signal/aggregation/mapCompanyOfferRows.ts` (aggregation input mapping)
- `src/signal/aggregation/aggregateCompanyAndPersist.ts` (aggregation persistence)
- `src/db/repos/companiesRepo.ts` (company aggregation persistence)
- `src/types/db.ts` (DB entities, aggregation input)
- `src/signal/repost/repostDetection.ts` (offer duplicate classification)
- `src/signal/repost/offerFingerprint.ts` (offer fingerprinting)
- `src/constants/repost.ts` (duplicate similarity threshold)
- `src/sheets/companyRowMapper.ts` (company export row schema)
- `src/sheets/updateCompanyMetrics.ts` (metric updates to Sheets)
- `src/sheets/appendNewCompanies.ts` (append new companies to Sheets)
- `src/constants/sheets.ts` (Sheets schema constants)
- `migrations/0001_init.sql` (matches table schema)
- `migrations/0003_company_aggregation_signals.sql` (company metrics schema)
- `migrations/0004_offer_canonicalization.sql` (offer canonicalization fields)
- `migrations/0006_add_company_resolution.sql` (resolution lifecycle field)

## A) File Ownership By Responsibility
Normalization And Tokenization
- `src/utils/text/textNormalization.ts` (lowercase, diacritic removal, split on separators, drop empty tokens)
- `src/utils/text/removeDiacritics.ts` (Unicode NFD + strip combining marks)
- `src/constants/textNormalization.ts` (token separator regex)

Catalog Loading And Compilation
- `src/constants/catalog.ts` (catalog path)
- `src/catalog/loader.ts` (load + compile keywords/phrases into token sequences)
- `src/utils/catalogValidation.ts` (schema and invariant validation)

Keyword And Phrase Matching
- `src/signal/matcher/matcher.ts` (matchOffer, keyword alias matching, phrase matching)
- `src/signal/matcher/negation.ts` (negation detection for each hit)
- `src/constants/negation.ts` (negation cues and windows)
- `src/types/matching.ts` (MatchResult, MatchHit, PhraseMatchHit)

Scoring
- `src/signal/scorer/scorer.ts` (scoreOffer, category aggregation, phrase boosts, clamping and rounding)
- `src/constants/scoring.ts` (tier weights, field weights, phrase boost points, thresholds)
- `src/types/scoring.ts` (ScoreResult, ScoreReason)

Offer-Level Classification
- `src/signal/scorer/scorer.ts` (final `score` and `topCategoryId` per offer)
- `src/constants/scoring.ts` (STRONG_THRESHOLD used for “strong” classification later)
- `src/signal/aggregation/mapCompanyOfferRows.ts` (computes `isStrong` from score >= STRONG_THRESHOLD)
- `src/signal/repost/repostDetection.ts` (duplicate vs not_duplicate classification)
- `src/signal/repost/offerFingerprint.ts` (exact duplicate fast-path via fingerprint)
- `src/constants/repost.ts` (DESC_SIM_THRESHOLD)
- `src/types/repost.ts` (DuplicateDecision model)

Company-Level Aggregation
- `src/signal/aggregation/aggregateCompany.ts` (pure aggregation logic)
- `src/signal/aggregation/mapCompanyOfferRows.ts` (DB rows -> AggregatableOffer)
- `src/signal/aggregation/aggregateCompanyAndPersist.ts` (orchestration + persistence)
- `src/db/repos/offersRepo.ts` (listCompanyOffersForAggregation + topCategoryId parsing)
- `src/db/repos/companiesRepo.ts` (updateCompanyAggregation)

Persistence (Scoring-Related)
- `src/db/repos/matchesRepo.ts` (upsertMatch stores score + ScoreResult JSON)
- `src/db/repos/offersRepo.ts` (offers for aggregation + canonicalization fields)
- `src/db/repos/companiesRepo.ts` (company-level metrics storage)
- `migrations/0001_init.sql` (matches table schema)
- `migrations/0003_company_aggregation_signals.sql` (company metrics columns)
- `migrations/0004_offer_canonicalization.sql` (offer canonicalization columns)

Export To Google Sheets
- `src/sheets/companyRowMapper.ts` (10-column output schema)
- `src/sheets/updateCompanyMetrics.ts` (metric-only updates)
- `src/sheets/appendNewCompanies.ts` (new row append)
- `src/constants/sheets.ts` (column indices, schema, defaults)

## B) Data Model Inventory
Offer-Level Structures
- `JobOfferSummary`, `JobOfferDetail` (`src/types/clients/job_offers.ts`): input offer fields including `title`, `description`, `company`, `publishedAt`, `updatedAt`, `requirementsSnippet`, `metadata`
- `MatchHit`, `PhraseMatchHit`, `MatchResult` (`src/types/matching.ts`): per-hit data with `keywordId`, `categoryId`, `field`, `tokenIndex`, `matchedTokens`, `isNegated`, plus `uniqueCategories` and `uniqueKeywords`
- `ScoreResult` (`src/types/scoring.ts`): `score`, `topCategoryId`, `reasons` (rawScore, finalScore, category and phrase contributions, negation counts)
- `Match` (`src/types/db.ts`): persisted match row (`offer_id`, `score`, `matched_keywords_json`, `reasons`, `computed_at`)
- `Offer` (`src/types/db.ts`): persisted offer row plus canonicalization fields (`canonical_offer_id`, `repost_count`, `last_seen_at`, `content_fingerprint`)
- `DuplicateDecision` (`src/types/repost.ts`): offer duplicate classification (`duplicate` or `not_duplicate` with reason)

Company-Level Structures
- `Company` (`src/types/db.ts`): global company record plus aggregation metrics and `resolution`
- `CompanyAggregation` (`src/signal/aggregation/aggregateCompany.ts`): pure aggregation output (maxScore, offerCount, uniqueOfferCount, strongOfferCount, avgStrongScore, topCategoryId, topOfferId, categoryMaxScores, lastStrongAt)
- `CompanyAggregationInput` (`src/types/db.ts`): DB update input for aggregation metrics
- `CompanyOfferAggRow` (`src/types/db.ts`): DB row shape for aggregation (offerId, canonicalOfferId, repostCount, publishedAt, updatedAt, score, topCategoryId)

Metrics Persisted In DB
- Matches table metrics (`migrations/0001_init.sql`, `src/types/db.ts`): `score`, `matched_keywords_json`, `reasons`, `computed_at`
- Companies table metrics (`migrations/0003_company_aggregation_signals.sql`, `src/types/db.ts`): `max_score`, `offer_count`, `unique_offer_count`, `strong_offer_count`, `avg_strong_score`, `top_category_id`, `top_offer_id`, `category_max_scores`, `last_strong_at`
- Companies table lifecycle field (`migrations/0006_add_company_resolution.sql`, `src/types/db.ts`): `resolution`
- Offers table canonicalization fields (`migrations/0004_offer_canonicalization.sql`, `src/types/db.ts`): `canonical_offer_id`, `repost_count`, `last_seen_at`, `content_fingerprint`

Metrics Exported To Google Sheets
- Column 1 `company_id` (`src/sheets/companyRowMapper.ts`)
- Column 2 `company_name` (fallback: name_display → normalized_name → “(no name)”)
- Column 3 `resolution` (set to `DEFAULT_RESOLUTION` on new rows)
- Column 4 `max_score` (1 decimal)
- Column 5 `strong_offers` (strong_offer_count)
- Column 6 `unique_offers` (unique_offer_count)
- Column 7 `posting_activity` (offer_count)
- Column 8 `avg_strong_score` (1 decimal)
- Column 9 `top_category` (category label resolved via catalog)
- Column 10 `last_strong_at` (YYYY-MM-DD)

## C) Dependency Map (Offer Text → Export)
1. Offer ingestion receives `JobOfferSummary` or `JobOfferDetail` (`src/ingestion/ingestOffers.ts`, `src/ingestion/offerPersistence.ts`).
2. Offer text is normalized and tokenized via `normalizeToTokens` (`src/utils/text/textNormalization.ts`) using `TOKEN_SEPARATOR_PATTERN` and diacritic removal.
3. Keyword and phrase matching runs on title and description only (`src/signal/matcher/matcher.ts`), applying negation detection (`src/signal/matcher/negation.ts`).
4. Scoring aggregates non-negated hits into a `ScoreResult` (`src/signal/scorer/scorer.ts`) using weights in `src/constants/scoring.ts`.
5. Scoring output is persisted to `matches` with `score` and `matched_keywords_json` (`src/db/repos/matchesRepo.ts`).
6. Company aggregation reads offers + matches (`src/db/repos/offersRepo.ts`), parses `topCategoryId` from `matched_keywords_json`, maps to aggregation input (`src/signal/aggregation/mapCompanyOfferRows.ts`), and computes company metrics (`src/signal/aggregation/aggregateCompany.ts`).
7. Aggregation results are persisted to `companies` (`src/signal/aggregation/aggregateCompanyAndPersist.ts`, `src/db/repos/companiesRepo.ts`).
8. Export reads company rows from DB (`src/sheets/appendNewCompanies.ts`, `src/sheets/updateCompanyMetrics.ts`), maps to a 10-column schema (`src/sheets/companyRowMapper.ts`), and writes to Sheets.

## Open Questions For You
- Should “offer-level classification” in the client audit include repost/duplicate classification (fingerprint + similarity) or only scoring-based classification (score, topCategoryId, strong threshold)?
- Are there any client-facing exports besides Google Sheets that must be included in the final audit (e.g., API endpoints, CSV, dashboards)?
- Should the audit explicitly cover the M6 resolution lifecycle (`resolution` field) even though it is not part of scoring, but is exposed in Sheets and affects ingestion?
