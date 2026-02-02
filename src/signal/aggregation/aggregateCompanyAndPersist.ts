/**
 * Company aggregation orchestration (M4.B3.2b)
 *
 * Wires together the full aggregation pipeline:
 * 1. Fetch company offers from DB
 * 2. Run pure aggregation logic
 * 3. Persist results to companies table
 *
 * This is the public entry point for triggering company aggregation.
 */

import type { Company, CompanyAggregationInput } from "@/types";
import { listCompanyOffersForAggregation } from "@/db/repos/offersRepo";
import {
  updateCompanyAggregation,
  getCompanyById,
} from "@/db/repos/companiesRepo";
import { aggregateCompany } from "./aggregateCompany";
import { mapCompanyOfferRows } from "./mapCompanyOfferRows";

/**
 * Aggregate company offers and persist signals to DB
 *
 * End-to-end orchestration:
 * 1. Query all offers for company (LEFT JOIN with matches)
 * 2. Map rows to aggregation input format
 * 3. Compute company-level signals (pure function)
 * 4. Persist aggregation results to companies table
 * 5. Return updated company record
 *
 * Safe to call multiple times - aggregation is deterministic and idempotent.
 *
 * @param companyId - Company ID to aggregate
 * @returns Updated company record with fresh aggregation signals
 * @throws Error if company does not exist
 */
export function aggregateCompanyAndPersist(companyId: number): Company {
  // Step 1: Fetch aggregation-relevant offer data from DB
  const rows = listCompanyOffersForAggregation(companyId);

  // Step 2: Map DB rows to pure function input format
  const offers = mapCompanyOfferRows(rows);

  // Step 3: Run pure aggregation logic (no DB, no side effects)
  const aggregation = aggregateCompany(offers);

  // Step 4: Map aggregation output to DB input format
  const input: CompanyAggregationInput = {
    max_score: aggregation.maxScore,
    offer_count: aggregation.offerCount,
    unique_offer_count: aggregation.uniqueOfferCount,
    strong_offer_count: aggregation.strongOfferCount,
    avg_strong_score: aggregation.avgStrongScore,
    top_category_id: aggregation.topCategoryId,
    top_offer_id: aggregation.topOfferId,
    category_max_scores: aggregation.categoryMaxScores,
    last_strong_at: aggregation.lastStrongAt,
  };

  // Step 5: Persist to DB (atomic update with JSON serialization)
  const updatedCompany = updateCompanyAggregation(companyId, input);

  return updatedCompany;
}
