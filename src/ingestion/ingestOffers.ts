/**
 * Offer batch ingestion — process multiple offers for a provider
 *
 * This module provides a composable orchestration unit for ingesting
 * batches of canonical offers. It handles per-record failures gracefully
 * (log + skip) and updates counters in the provided accumulator.
 *
 * This is NOT the final pipeline entrypoint — it's a building block.
 */

import type {
  IngestOffersInput,
  IngestOffersResult,
  JobOfferDetail,
} from "@/types";
import { persistOffer } from "./offerPersistence";
import { upsertMatch } from "@/db";
import { loadCatalog } from "@/catalog";
import { matchOffer } from "@/signal/matcher";
import { scoreOffer } from "@/signal/scorer";
import * as logger from "@/logger";

/**
 * Ingest a batch of canonical offers for a provider
 *
 * For each offer:
 * - Calls persistOffer() to persist company + offer
 * - If offer has description (JobOfferDetail), scores it via matcher + scorer
 * - Persists match/score to matches table
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

  // Load catalog once for the entire batch
  const catalog = loadCatalog();

  // Local counters
  let upserted = 0;
  let skipped = 0;
  let failed = 0;
  let duplicates = 0;

  for (const offer of offers) {
    const result = persistOffer({ offer, provider });

    if (result.ok) {
      // Check if this is a repost duplicate or a normal insert/update
      if ("reason" in result && result.reason === "repost_duplicate") {
        // Repost duplicate detected - no new offer inserted
        duplicates++;
        if (acc) {
          acc.counters.offers_duplicates =
            (acc.counters.offers_duplicates ?? 0) + 1;
        }

        // Track affected company for aggregation (repost_count changed)
        if (affectedCompanyIds) {
          affectedCompanyIds.add(result.companyId);
        }

        // Skip matching/scoring for reposts (no new offer row exists)
        continue;
      }

      // Normal insert/update (offerId is present)
      upserted++;
      if (acc) {
        acc.counters.offers_upserted = (acc.counters.offers_upserted ?? 0) + 1;
      }
      // Track affected company
      if (affectedCompanyIds) {
        affectedCompanyIds.add(result.companyId);
      }

      // Score offer if it has description (JobOfferDetail)
      // Summary offers without description are skipped for scoring
      if ("description" in offer) {
        try {
          const matchResult = matchOffer(offer as JobOfferDetail, catalog);
          const scoreResult = scoreOffer(matchResult, catalog);

          // Persist match/score to matches table
          upsertMatch({
            offer_id: result.offerId,
            score: scoreResult.score,
            matched_keywords_json: JSON.stringify(scoreResult),
          });

          // Track affected company for scoring changes
          if (affectedCompanyIds) {
            affectedCompanyIds.add(result.companyId);
          }
        } catch (err) {
          // Log scoring failure but don't fail the entire ingestion
          logger.warn("Failed to score offer, continuing", {
            provider,
            offerId: result.offerId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
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
    } else if (result.reason === "company_resolved") {
      // M6: company is resolved, skip offer ingestion
      skipped++;
      if (acc) {
        acc.counters.offers_skipped = (acc.counters.offers_skipped ?? 0) + 1;
      }
      // Track affected company (company state matters for aggregation)
      if (affectedCompanyIds) {
        affectedCompanyIds.add(result.companyId);
      }
      // Note: persistOffer already logs the skip at debug level
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

  return {
    processed,
    upserted,
    duplicates,
    skipped,
    failed,
    affectedCompanies,
  };
}
