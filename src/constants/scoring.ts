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
 * Points added per unique phrase match.
 *
 * Phrases provide independent boosts (e.g., "USD", "multidivisa").
 * Multiple occurrences of the same phrase count as 1.
 *
 * TODO: Initial default pending production data calibration.
 * TODO: Review phrase tier differentiation from catalog.
 * Current implementation treats all phrase tiers equally.
 * See docs/M2/01_define_keyword_system.md for phrase semantics.
 */
export const PHRASE_BOOST_POINTS = 1.5;

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
