/**
 * Scoring type definitions
 *
 * Types for the offer-level scoring system that converts
 * keyword/phrase match results into numeric scores (0-10).
 */

/**
 * Category contribution to the final score.
 *
 * Records how a specific category contributed to the offer's score.
 * Used for auditability and explainability.
 */
export type CategoryContribution = {
  /** Category identifier */
  categoryId: string;
  /** Number of hits from this category (pre-aggregation) */
  hitCount: number;
  /** Points contributed by this category to the raw score */
  points: number;
};

/**
 * Phrase contribution to the final score.
 *
 * Records how phrase boosts affected the offer's score.
 */
export type PhraseContribution = {
  /** Phrase identifier */
  phraseId: string;
  /** Number of times phrase was detected (pre-aggregation) */
  hitCount: number;
  /** Points contributed by this phrase to the raw score */
  points: number;
};

/**
 * Bucket identifier for category classification.
 *
 * Scoring V2 - Increment 3: Bucketed scoring.
 */
export type BucketId =
  | "direct_fx"
  | "intl_footprint"
  | "business_model"
  | "tech_proxy";

/**
 * Bucket score breakdown.
 *
 * Shows the capped subtotal for each bucket.
 */
export type BucketScores = {
  direct_fx: number;
  intl_footprint: number;
  business_model: number;
  tech_proxy: number;
};

/**
 * Scoring explanation and breakdown.
 *
 * Makes the score auditable by showing all contributions
 * and transformations applied.
 */
export type ScoreReason = {
  /** Raw score before capping/normalization */
  rawScore: number;
  /** Final normalized score (0-10) */
  finalScore: number;
  /** Category contributions (sorted by points desc) */
  categories: CategoryContribution[];
  /** Phrase contributions */
  phrases: PhraseContribution[];
  /** Total unique categories matched */
  uniqueCategories: number;
  /** Total unique keywords matched */
  uniqueKeywords: number;
  /** Number of keyword hits excluded due to negation */
  negatedKeywordHits: number;
  /** Number of phrase hits excluded due to negation */
  negatedPhraseHits: number;
  /** Bucket scores after caps (Scoring V2 - Increment 3) */
  bucketScores?: BucketScores;
  /** Whether offer has strong FX evidence (Scoring V2 - Increment 3) */
  fxCore?: boolean;
  /** Whether no-FX guard was applied (Scoring V2 - Increment 3) */
  appliedNoFxGuard?: boolean;
  /** Total synergy points applied (Scoring V2 - Increment 4) */
  synergyPoints?: number;
  /** Synergy breakdown by type (Scoring V2 - Increment 4) */
  synergyBreakdown?: {
    fx_intl?: number;
    fx_biz?: number;
  };
};

/**
 * Complete scoring result for a single job offer.
 *
 * Produced by the scorer from MatchResult + CatalogRuntime.
 */
export type ScoreResult = {
  /** Final offer score (0-10 integer) */
  score: number;
  /** Category that contributed the most points */
  topCategoryId: string;
  /** Detailed explanation of how the score was computed */
  reasons: ScoreReason;
};
