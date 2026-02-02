/**
 * Mapping adapter for company aggregation pipeline
 *
 * Converts DB query results (CompanyOfferAggRow) to the format expected
 * by the pure aggregateCompany() function (AggregatableOffer).
 *
 * No DB access, no side effects - pure transformation only.
 */

import type { CompanyOfferAggRow } from "@/types";
import type { AggregatableOffer } from "./aggregateCompany";
import { STRONG_THRESHOLD } from "@/constants";

/**
 * Map DB query results to aggregation input format
 *
 * Converts CompanyOfferAggRow[] → AggregatableOffer[]
 *
 * Mapping rules:
 * - offerId ← row.offerId
 * - score ← row.score (0..10, includes 0 for unscored offers)
 * - categoryId ← row.topCategoryId (parsed from matched_keywords_json)
 * - isStrong ← row.score >= STRONG_THRESHOLD
 * - publishedAt, updatedAt, canonicalOfferId, repostCount ← direct from row
 *
 * @param rows - Query results from listCompanyOffersForAggregation()
 * @returns Array of offers ready for pure aggregation function
 */
export function mapCompanyOfferRows(
  rows: CompanyOfferAggRow[],
): AggregatableOffer[] {
  return rows.map((row) => ({
    offerId: row.offerId,
    score: row.score,
    categoryId: row.topCategoryId,
    isStrong: row.score >= STRONG_THRESHOLD,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    canonicalOfferId: row.canonicalOfferId,
    repostCount: row.repostCount,
  }));
}
