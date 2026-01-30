/**
 * Company aggregation logic (M4)
 *
 * Pure in-memory aggregation of multiple scored offers into company-level signals.
 * No DB access, no side effects - deterministic function only.
 *
 * Based on:
 * - docs/M4/01_define_agg_strategy.md
 * - docs/M4/02_define_offer_freshnes.md
 * - docs/M4/03_define_repost_detection.md
 */

import { STRONG_THRESHOLD } from "@/constants";

/**
 * Input: scored offer with canonicalization info
 */
export type AggregatableOffer = {
  offerId: number;

  // Offer-level score already computed (0..10)
  score: number;

  // Representative category for this offer (typically topCategoryId from scoring)
  categoryId: string | null;

  // True if score >= STRONG_THRESHOLD
  isStrong: boolean;

  // Timestamps (ISO string or null)
  publishedAt: string | null;
  updatedAt: string | null;

  // Canonicalization info
  canonicalOfferId: number | null; // null => canonical, non-null => duplicate
  repostCount: number; // meaningful on canonical offers; duplicates can be 0
};

/**
 * Output: company-level aggregated signals
 */
export type CompanyAggregation = {
  // Core metrics
  maxScore: number; // max score across all canonical offers (0..10)
  offerCount: number; // activity-weighted count (includes reposts)
  uniqueOfferCount: number; // count of canonical offers only
  strongOfferCount: number; // count of strong canonical offers (NOT weighted)
  avgStrongScore: number | null; // simple average of strong scores (null if none)

  // Evidence / explainability
  topCategoryId: string | null; // category from offer with maxScore
  topOfferId: number | null; // offer id that produced maxScore (null if no canonical offers)
  categoryMaxScores: Record<string, number>; // { categoryId: maxScore }

  // Freshness indicator
  lastStrongAt: string | null; // most recent timestamp of strong offer
};

/**
 * Aggregate multiple scored offers into company-level signals
 *
 * Pure function: no DB access, no side effects, deterministic.
 * Strict M4-compliant implementation - only canonical offers contribute to metrics.
 *
 * Algorithm (M4.1-M4.3):
 * 1. Filter to canonical offers only (canonicalOfferId === null)
 * 2. Find maxScore from canonical offers
 * 3. Compute activity-weighted offerCount (sum of 1 + repostCount)
 * 4. Count unique canonical offers
 * 5. Count strong canonical offers (score >= STRONG_THRESHOLD, NOT weighted)
 * 6. Compute avgStrongScore (simple average of strong scores, NOT weighted)
 * 7. Find topOfferId (highest score canonical, tie-breaker: most recent)
 * 8. Build category max scores map (canonical offers only)
 * 9. Determine lastStrongAt (most recent strong canonical timestamp)
 *
 * @param offers - Array of scored offers (can include duplicates)
 * @returns Company aggregation signals
 */
export function aggregateCompany(
  offers: AggregatableOffer[],
): CompanyAggregation {
  // Filter to canonical offers only (ignore duplicates per M4.3)
  const canonicalOffers = offers.filter((o) => o.canonicalOfferId === null);

  // Edge case: no canonical offers
  if (canonicalOffers.length === 0) {
    return {
      maxScore: 0,
      offerCount: 0,
      uniqueOfferCount: 0,
      strongOfferCount: 0,
      avgStrongScore: null,
      topCategoryId: null,
      topOfferId: null,
      categoryMaxScores: {},
      lastStrongAt: null,
    };
  }

  // Compute uniqueOfferCount (number of canonical offers)
  const uniqueOfferCount = canonicalOffers.length;

  // Compute activity-weighted offerCount
  // For each canonical offer, contributes (1 + repostCount)
  const offerCount = canonicalOffers.reduce(
    (sum, o) => sum + (1 + o.repostCount),
    0,
  );

  // Find canonical offer with maxScore (tie-breaker: most recent timestamp)
  let topOffer = canonicalOffers[0];
  for (const offer of canonicalOffers) {
    if (
      offer.score > topOffer.score ||
      (offer.score === topOffer.score &&
        compareTimestamps(
          getOfferTimestamp(offer),
          getOfferTimestamp(topOffer),
        ) > 0)
    ) {
      topOffer = offer;
    }
  }

  const maxScore = topOffer.score;
  const topOfferId = topOffer.offerId;
  const topCategoryId = topOffer.categoryId;

  // Compute strong offer metrics (NOT weighted by reposts per M4.1)
  const strongCanonicalOffers = canonicalOffers.filter((o) => o.isStrong);

  const strongOfferCount = strongCanonicalOffers.length;

  const avgStrongScore =
    strongOfferCount > 0
      ? strongCanonicalOffers.reduce((sum, o) => sum + o.score, 0) /
        strongOfferCount
      : null;

  // Build category max scores map (canonical offers only)
  const categoryMaxScores: Record<string, number> = {};
  for (const offer of canonicalOffers) {
    if (offer.categoryId) {
      const currentMax = categoryMaxScores[offer.categoryId] ?? 0;
      if (offer.score > currentMax) {
        categoryMaxScores[offer.categoryId] = offer.score;
      }
    }
  }

  // Determine lastStrongAt (most recent strong canonical offer timestamp)
  let lastStrongAt: string | null = null;
  for (const offer of strongCanonicalOffers) {
    const timestamp = getOfferTimestamp(offer);
    if (
      timestamp &&
      (!lastStrongAt || compareTimestamps(timestamp, lastStrongAt) > 0)
    ) {
      lastStrongAt = timestamp;
    }
  }

  return {
    maxScore,
    offerCount,
    uniqueOfferCount,
    strongOfferCount,
    avgStrongScore,
    topCategoryId,
    topOfferId,
    categoryMaxScores,
    lastStrongAt,
  };
}

/**
 * Get timestamp for an offer (priority: publishedAt > updatedAt > null)
 */
function getOfferTimestamp(offer: AggregatableOffer): string | null {
  return offer.publishedAt ?? offer.updatedAt ?? null;
}

/**
 * Compare two ISO timestamp strings
 * Returns: >0 if a is newer, <0 if b is newer, 0 if equal/both null
 */
function compareTimestamps(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}
