/**
 * Offer batch ingestion — process multiple offers for a provider
 *
 * This module provides a composable orchestration unit for ingesting
 * batches of canonical offers. It handles per-record failures gracefully
 * (log + skip) and updates counters in the provided accumulator.
 *
 * This is NOT the final pipeline entrypoint — it's a building block.
 */

import type { IngestOffersInput, IngestOffersResult } from "@/types";
import { persistOffer } from "./offerPersistence";
import * as logger from "@/logger";

/**
 * Ingest a batch of canonical offers for a provider
 *
 * For each offer:
 * - Calls persistOffer() to persist company + offer
 * - Updates local counters and accumulator (if provided)
 * - Tracks affected company IDs (if affectedCompanyIds set provided)
 * - Logs skips at debug level, DB errors at error level
 *
 * Never throws for per-offer failures.
 *
 * @param input - Provider, offers array, optional accumulator, optional affectedCompanyIds set
 * @returns Summary with processed, upserted, skipped, failed counts and affected companies
 */
export function ingestOffers(input: IngestOffersInput): IngestOffersResult {
  const { provider, offers, acc, affectedCompanyIds } = input;

  // Local counters
  let upserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const offer of offers) {
    const result = persistOffer({ offer, provider });

    if (result.ok) {
      upserted++;
      if (acc) {
        acc.counters.offers_upserted = (acc.counters.offers_upserted ?? 0) + 1;
      }
      // Track affected company
      if (affectedCompanyIds) {
        affectedCompanyIds.add(result.companyId);
      }
    } else if (result.reason === "company_unidentifiable") {
      skipped++;
      if (acc) {
        acc.counters.offers_skipped = (acc.counters.offers_skipped ?? 0) + 1;
      }
      logger.debug("Offer skipped: company unidentifiable", {
        provider,
        offerId: offer.ref.id,
      });
    } else if (result.reason === "db_error") {
      failed++;
      if (acc) {
        acc.counters.offers_failed = (acc.counters.offers_failed ?? 0) + 1;
      }
      // Track affected company even on DB error (company was created successfully)
      if (affectedCompanyIds) {
        affectedCompanyIds.add(result.companyId);
      }
      // Note: persistOffer already logs the error details
    }
  }

  const processed = offers.length;
  const affectedCompanies = affectedCompanyIds ? affectedCompanyIds.size : 0;

  logger.info("Offer batch ingestion complete", {
    provider,
    processed,
    upserted,
    skipped,
    failed,
    affectedCompanies,
  });

  return { processed, upserted, skipped, failed, affectedCompanies };
}
