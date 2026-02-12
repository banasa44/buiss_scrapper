/**
 * Offer-level scorer
 *
 * Converts keyword/phrase matches into a numeric score (0-10) with
 * auditable explanations.
 *
 * Scoring rules (M3.3b):
 * - Negated hits (isNegated=true) are excluded before scoring (contribute 0 points)
 * - Max 1 hit per category per offer (no stacking within category)
 * - Category contribution = tier weight × field weight
 * - Phrase boosts are independent and non-stacking
 * - Final score clamped to [0, 10]
 *
 * Based on:
 * - docs/M2/01_define_keyword_system.md
 * - docs/M2/03_scoring_parameters.md
 */

import type { CatalogRuntime } from "@/types/catalog";
import type { MatchResult } from "@/types/matching";
import type {
  ScoreResult,
  CategoryContribution,
  PhraseContribution,
} from "@/types/scoring";
import {
  TIER_WEIGHTS,
  FIELD_WEIGHTS,
  PHRASE_TIER_WEIGHTS,
  MAX_SCORE,
  NO_FX_MAX_SCORE,
  BUCKET_CAPS,
  FX_CORE_THRESHOLD,
} from "@/constants/scoring";
import type { BucketId, BucketScores } from "@/types/scoring";

/**
 * Classifies a category into a bucket based on its ID prefix.
 *
 * Scoring V2 - Increment 3: Bucket classification.
 *
 * @param categoryId - Category identifier
 * @returns Bucket identifier
 */
function classifyBucket(categoryId: string): BucketId {
  if (categoryId.startsWith("cat_fx_")) return "direct_fx";
  if (categoryId.startsWith("cat_intl_")) return "intl_footprint";
  if (categoryId.startsWith("cat_biz_")) return "business_model";
  if (categoryId.startsWith("cat_proxy_")) return "tech_proxy";
  // Default: treat unknown categories as tech_proxy (conservative)
  return "tech_proxy";
}

/**
 * Aggregates keyword hits by category to enforce "max 1 hit per category" rule.
 *
 * For each category:
 * - Find the hit with highest field weight
 * - Compute points = tier_weight × field_weight
 * - Return category contributions
 *
 * Multiple keywords from the same category do NOT stack.
 * Multiple hits of the same keyword do NOT stack.
 *
 * @param keywordHits - Active (non-negated) keyword hits
 * @param catalog - Runtime catalog with category metadata
 * @returns Array of category contributions
 */
function aggregateCategoryContributions(
  keywordHits: MatchResult["keywordHits"],
  catalog: CatalogRuntime,
): CategoryContribution[] {
  // Group hits by category
  const categoryHits = new Map<
    string,
    { hitCount: number; maxPoints: number }
  >();

  for (const hit of keywordHits) {
    const category = catalog.categories.get(hit.categoryId);
    if (!category) {
      // Skip invalid category references (shouldn't happen with valid catalog)
      continue;
    }

    const fieldWeight = FIELD_WEIGHTS[hit.field] ?? 1.0;
    const tierWeight = TIER_WEIGHTS[category.tier];
    const points = tierWeight * fieldWeight;

    const existing = categoryHits.get(hit.categoryId);
    if (!existing) {
      categoryHits.set(hit.categoryId, { hitCount: 1, maxPoints: points });
    } else {
      // Update hit count but only keep the highest points
      existing.hitCount += 1;
      existing.maxPoints = Math.max(existing.maxPoints, points);
    }
  }

  // Convert to array and sort by points descending
  const contributions: CategoryContribution[] = [];
  for (const [categoryId, { hitCount, maxPoints }] of categoryHits) {
    contributions.push({
      categoryId,
      hitCount,
      points: maxPoints,
    });
  }

  contributions.sort((a, b) => b.points - a.points);
  return contributions;
}

/**
 * Aggregates phrase hits to enforce "max 1 count per phrase" rule.
 *
 * Each unique phrase contributes once, regardless of how many times
 * it appears in the offer.
 *
 * Scoring V2 - Increment 1:
 * - Phrase points now depend on phrase tier (via PHRASE_TIER_WEIGHTS)
 * - Field weight multiplier applied (title vs description)
 *
 * @param phraseHits - Active (non-negated) phrase hits
 * @param catalog - Runtime catalog with phrase metadata
 * @returns Array of phrase contributions
 */
function aggregatePhraseContributions(
  phraseHits: MatchResult["phraseHits"],
  catalog: CatalogRuntime,
): PhraseContribution[] {
  // Group by phrase ID and track highest field weight
  const phraseMap = new Map<string, { hitCount: number; maxPoints: number }>();

  for (const hit of phraseHits) {
    const phrase = catalog.phrases.find((p) => p.id === hit.phraseId);
    if (!phrase) {
      // Skip invalid phrase references
      continue;
    }

    const fieldWeight = FIELD_WEIGHTS[hit.field] ?? 1.0;
    const tierWeight = PHRASE_TIER_WEIGHTS[phrase.tier];
    const points = tierWeight * fieldWeight;

    const existing = phraseMap.get(hit.phraseId);
    if (!existing) {
      phraseMap.set(hit.phraseId, { hitCount: 1, maxPoints: points });
    } else {
      // Update hit count but only keep the highest points
      existing.hitCount += 1;
      existing.maxPoints = Math.max(existing.maxPoints, points);
    }
  }

  const contributions: PhraseContribution[] = [];
  for (const [phraseId, { hitCount, maxPoints }] of phraseMap) {
    contributions.push({
      phraseId,
      hitCount,
      points: maxPoints, // Each unique phrase contributes once (max field weight)
    });
  }

  return contributions;
}

/**
 * Computes offer-level score from match results.
 *
 * Scoring algorithm:
 * 1. Filter out negated hits (isNegated=true)
 * 2. Aggregate category hits (max 1 per category)
 * 3. Sum category contributions (tier × field weight)
 * 4. Add phrase boosts (1 per unique phrase)
 * 5. Clamp to [0, MAX_SCORE]
 * 6. Round to integer
 *
 * Negation gating:
 * - Hits with isNegated=true are excluded before scoring
 * - They contribute 0 points (not subtracted, just ignored)
 *
 * Returns ScoreResult with:
 * - Final score (0-10)
 * - Top contributing category
 * - Detailed reasons including negation counts
 *
 * @param matchResult - Match results from matcher
 * @param catalog - Runtime catalog with metadata
 * @returns Complete scoring result
 */
export function scoreOffer(
  matchResult: MatchResult,
  catalog: CatalogRuntime,
): ScoreResult {
  // Filter out negated hits (negation gating)
  const activeKeywordHits = matchResult.keywordHits.filter((h) => !h.isNegated);
  const activePhraseHits = matchResult.phraseHits.filter((h) => !h.isNegated);

  // Count negated hits for audit trail
  const negatedKeywordHits =
    matchResult.keywordHits.length - activeKeywordHits.length;
  const negatedPhraseHits =
    matchResult.phraseHits.length - activePhraseHits.length;

  // Aggregate category contributions (enforces max 1 per category)
  const categoryContributions = aggregateCategoryContributions(
    activeKeywordHits,
    catalog,
  );

  // Aggregate phrase contributions (enforces max 1 per phrase)
  const phraseContributions = aggregatePhraseContributions(
    activePhraseHits,
    catalog,
  );

  // Scoring V2 - Increment 3: Bucketed scoring
  // Sum category points into buckets (before caps)
  const uncappedBuckets: Record<BucketId, number> = {
    direct_fx: 0,
    intl_footprint: 0,
    business_model: 0,
    tech_proxy: 0,
  };

  for (const contrib of categoryContributions) {
    const bucket = classifyBucket(contrib.categoryId);
    uncappedBuckets[bucket] += contrib.points;
  }

  // Determine fxCore flag (BEFORE applying caps)
  const fxCore = uncappedBuckets.direct_fx >= FX_CORE_THRESHOLD;

  // Apply bucket caps
  const bucketScores: BucketScores = {
    direct_fx: Math.min(uncappedBuckets.direct_fx, BUCKET_CAPS.direct_fx),
    intl_footprint: Math.min(
      uncappedBuckets.intl_footprint,
      BUCKET_CAPS.intl_footprint,
    ),
    business_model: Math.min(
      uncappedBuckets.business_model,
      BUCKET_CAPS.business_model,
    ),
    tech_proxy: Math.min(uncappedBuckets.tech_proxy, BUCKET_CAPS.tech_proxy),
  };

  // Sum capped buckets + phrase points = raw score
  const cappedCategoryPoints =
    bucketScores.direct_fx +
    bucketScores.intl_footprint +
    bucketScores.business_model +
    bucketScores.tech_proxy;

  const phrasePoints = phraseContributions.reduce(
    (sum, p) => sum + p.points,
    0,
  );

  let rawScore = cappedCategoryPoints + phrasePoints;

  // Scoring V2 - Increment 3: No-FX guard based on fxCore
  // Without fxCore evidence, cap score at 5.0
  let appliedNoFxGuard = false;
  if (!fxCore) {
    rawScore = Math.min(rawScore, NO_FX_MAX_SCORE);
    appliedNoFxGuard = true;
  }

  // Clamp and round to integer
  const finalScore = Math.round(Math.max(0, Math.min(MAX_SCORE, rawScore)));

  // Determine top category (highest contributing)
  const topCategoryId = categoryContributions[0]?.categoryId ?? "";

  return {
    score: finalScore,
    topCategoryId,
    reasons: {
      rawScore,
      finalScore,
      categories: categoryContributions,
      phrases: phraseContributions,
      uniqueCategories: matchResult.uniqueCategories,
      uniqueKeywords: matchResult.uniqueKeywords,
      negatedKeywordHits,
      negatedPhraseHits,
      bucketScores,
      fxCore,
      appliedNoFxGuard,
    },
  };
}
