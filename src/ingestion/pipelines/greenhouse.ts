/**
 * Greenhouse ATS ingestion pipeline
 *
 * Fetches job offers from Greenhouse for companies with greenhouse company_sources.
 * Persists offers using existing ingestion infrastructure with company linkage.
 */

import type { RunOfferBatchResult } from "@/types";
import { GreenhouseAtsJobOffersClient } from "@/clients/greenhouse";
import { listCompanySourcesByProvider } from "@/db";
import { ingestOffers } from "@/ingestion/ingestOffers";
import { aggregateCompaniesAndPersist } from "@/ingestion/aggregateCompanies";
import { withRun } from "@/ingestion/runLifecycle";
import { GREENHOUSE_INGESTION_DEFAULT_LIMIT } from "@/constants/runner";
import * as logger from "@/logger";

/**
 * Run Greenhouse ATS ingestion pipeline
 *
 * Fetches offers from Greenhouse for all company_sources with provider='greenhouse'.
 * For each board, fetches offers and persists them with known companyId.
 * Aggregates all affected companies at end of run.
 *
 * @param options - Pipeline options
 * @param options.limit - Maximum number of company_sources to process (defaults to GREENHOUSE_INGESTION_DEFAULT_LIMIT)
 * @returns Promise resolving to run result with runId, counters, and ingestion summary
 */
export async function runGreenhousePipeline(options?: {
  limit?: number;
}): Promise<RunOfferBatchResult> {
  const limit = options?.limit ?? GREENHOUSE_INGESTION_DEFAULT_LIMIT;

  logger.info("Starting Greenhouse ingestion pipeline", { limit });

  // Capture run details for return
  let capturedRunId = 0;
  let capturedCounters: RunOfferBatchResult["counters"] = {};

  // Local counters for pipeline summary
  let sourcesChecked = 0;
  let persistedOffersTotal = 0;
  let skippedOffersTotal = 0;
  let failedOffersTotal = 0;
  let errors = 0;

  const result = await withRun("greenhouse", undefined, async (runId, acc) => {
    capturedRunId = runId;

    // Fetch Greenhouse company_sources to ingest
    const companySources = listCompanySourcesByProvider("greenhouse", limit);

    logger.info("Fetched Greenhouse company sources", {
      count: companySources.length,
    });

    // Initialize Greenhouse client
    const client = new GreenhouseAtsJobOffersClient();

    // Track affected company IDs for M4 aggregation
    const affectedCompanyIds = new Set<number>();

    // Process each company source sequentially
    for (const source of companySources) {
      sourcesChecked++;

      const boardToken = source.provider_company_id;
      const companyId = source.company_id;

      if (!boardToken) {
        // Should not happen due to query filter, but defensive check
        logger.warn("Greenhouse company_source missing provider_company_id", {
          sourceId: source.id,
          companyId,
        });
        errors++;
        continue;
      }

      try {
        // Fetch offer summaries for this board
        logger.debug("Fetching Greenhouse offers", {
          sourceId: source.id,
          companyId,
          boardToken,
        });

        const searchResult = await client.listOffersForTenant(boardToken);

        // Hydrate summaries to full details with descriptions
        const details = await client.hydrateOfferDetails({
          tenantKey: boardToken,
          offers: searchResult.offers,
        });

        logger.debug("Greenhouse offers fetched for board", {
          sourceId: source.id,
          companyId,
          boardToken,
          offersCount: searchResult.offers.length,
          detailsCount: details.length,
        });

        // Persist offers using existing ingestion infrastructure
        // Pass companyId to link offers directly to known company
        const ingestionResult = ingestOffers({
          provider: client.provider,
          offers: details,
          acc,
          affectedCompanyIds,
          companyId,
        });

        // Update local counters
        persistedOffersTotal += ingestionResult.upserted;
        skippedOffersTotal += ingestionResult.skipped;
        failedOffersTotal += ingestionResult.failed;

        logger.debug("Greenhouse offers persisted for board", {
          sourceId: source.id,
          companyId,
          boardToken,
          upserted: ingestionResult.upserted,
          skipped: ingestionResult.skipped,
          failed: ingestionResult.failed,
          duplicates: ingestionResult.duplicates,
        });
      } catch (error) {
        // Log error and continue with next source (do not halt pipeline)
        errors++;
        logger.warn("Failed to process Greenhouse board", {
          sourceId: source.id,
          companyId,
          boardToken,
          error: String(error),
        });
      }
    }

    // Aggregate all affected companies after processing all sources
    const aggregationResult = await aggregateCompaniesAndPersist(
      Array.from(affectedCompanyIds),
    );

    // Update accumulator with aggregation results
    acc.counters.companies_aggregated = aggregationResult.ok;
    acc.counters.companies_failed = aggregationResult.failed;

    logger.info("Greenhouse ingestion pipeline complete", {
      sourcesChecked,
      persistedOffersTotal,
      skippedOffersTotal,
      failedOffersTotal,
      errors,
      companiesAggregated: aggregationResult.ok,
      companiesFailed: aggregationResult.failed,
    });

    // Store counters for return
    capturedCounters = { ...acc.counters };

    // Return basic ingestion summary
    return {
      processed: persistedOffersTotal + skippedOffersTotal + failedOffersTotal,
      upserted: persistedOffersTotal,
      duplicates: 0, // duplicates tracked internally, not exposed here
      skipped: skippedOffersTotal,
      failed: failedOffersTotal,
      affectedCompanies: affectedCompanyIds.size,
    };
  });

  return {
    runId: capturedRunId,
    result,
    counters: capturedCounters,
  };
}
