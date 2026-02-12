/**
 * Scoring configuration constants
 *
 * All scoring parameters are defined here to keep scoring logic
 * config-driven and avoid magic numbers.
 *
 * Based on docs/M2/03_scoring_parameters.md design.
 */

/**
 * Points contributed by each category tier for a single hit.
 *
 * Tier 3 (strongest): Ads, Cloud, Global Payments
 * Tier 2 (high probability): CRM, Analytics, Dev tooling
 * Tier 1 (contextual): Design, Collaboration, Ecommerce
 *
 * Rule: Maximum 1 hit per category per offer (no stacking).
 *
 * TODO: Initial defaults pending production data calibration.
 */
export const TIER_WEIGHTS: Record<1 | 2 | 3, number> = {
  3: 4.0, // Strong USD signal
  2: 2.5, // High probability USD
  1: 1.0, // Contextual/complementary
};

/**
 * Field weight multipliers.
 *
 * Applied to category tier points based on where the match occurred.
 * Job title = strongest signal, description = standard weight.
 *
 * Note: Company name matching is disabled in matcher to reduce false positives.
 *
 * TODO: Initial defaults pending production data calibration.
 */
export const FIELD_WEIGHTS: Record<string, number> = {
  title: 1.5, // Strongest signal
  description: 1.0, // Standard weight
};

/**
 * Points added per unique phrase match, weighted by phrase tier.
 *
 * Phrases provide independent boosts (e.g., "USD", "multidivisa").
 * Multiple occurrences of the same phrase count as 1.
 *
 * Tier 3 (strong direct FX signal): USD, multidivisa, foreign exchange
 * Tier 2 (moderate signal): expansión internacional
 * Tier 1 (weak signal): contextual phrases
 *
 * Scoring V2 - Increment 1: Phrase tier weighting implemented.
 */
export const PHRASE_TIER_WEIGHTS: Record<1 | 2 | 3, number> = {
  3: 2.0, // Strong direct FX signal
  2: 1.2, // Moderate signal
  1: 0.6, // Weak/contextual signal
};

/**
 * Maximum allowed score (inclusive).
 *
 * Raw scores are clamped to this range: [0, MAX_SCORE].
 */
export const MAX_SCORE = 10;

/**
 * Minimum score threshold for inclusion.
 *
 * Offers with score <= MIN_SCORE are effectively filtered out.
 */
export const MIN_SCORE = 0;

/**
 * Score threshold for "strong" offers.
 *
 * Offers with score >= STRONG_THRESHOLD are considered high-quality signals.
 * Used in M4 aggregation to compute strongOfferCount and avgStrongScore.
 *
 * Per docs/M4/01_define_agg_strategy.md: initially 6.
 */
export const STRONG_THRESHOLD = 6;

/**
 * Maximum score allowed without direct FX signal.
 *
 * Business invariant: Without direct FX indicators, scores must not exceed 5.0.
 * Direct FX signal = phrase with tier 3.
 *
 * Scoring V2 - Increment 1: No-FX guard cap.
 */
export const NO_FX_MAX_SCORE = 5.0;

/**
 * Bucket caps for category scoring.
 *
 * After aggregating category contributions, points are summed by bucket
 * and capped to prevent any single bucket from dominating.
 *
 * Scoring V2 - Increment 3: Bucketed scoring.
 */
export const BUCKET_CAPS = {
  direct_fx: 7.0, // FX & currency operations (cat_fx_*)
  intl_footprint: 3.0, // International market presence (cat_intl_*)
  business_model: 2.5, // Business operations (cat_biz_*)
  tech_proxy: 1.5, // Tech stack proxies (cat_proxy_*)
} as const;

/**
 * Minimum direct_fx bucket score to qualify as fxCore.
 *
 * When uncapped direct_fx bucket total >= FX_CORE_THRESHOLD,
 * the offer is considered to have strong FX evidence (fxCore = true).
 *
 * Scoring V2 - Increment 3: fxCore flag.
 */
export const FX_CORE_THRESHOLD = 2.0;

/**
 * Synergy bonus points for FX + international footprint.
 *
 * Applied when fxCore=true AND intl_footprint bucket >= SYNERGY_MIN_BUCKET_POINTS.
 *
 * Scoring V2 - Increment 4: Synergy bonuses.
 */
export const SYNERGY_FX_INTL_POINTS = 1.0;

/**
 * Synergy bonus points for FX + business model.
 *
 * Applied when fxCore=true AND business_model bucket >= SYNERGY_MIN_BUCKET_POINTS.
 *
 * Scoring V2 - Increment 4: Synergy bonuses.
 */
export const SYNERGY_FX_BIZ_POINTS = 0.8;

/**
 * Maximum total synergy points that can be applied.
 *
 * Caps the sum of all synergy bonuses to prevent excessive boosting.
 *
 * Scoring V2 - Increment 4: Synergy bonuses.
 */
export const SYNERGY_MAX_POINTS = 1.8;

/**
 * Minimum bucket points required to trigger synergy.
 *
 * Bucket must have at least this value (after caps) to qualify for synergy bonus.
 *
 * Scoring V2 - Increment 4: Synergy bonuses.
 */
export const SYNERGY_MIN_BUCKET_POINTS = 1.0;
