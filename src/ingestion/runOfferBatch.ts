/**
 * Run-wrapped offer batch ingestion — glue for run lifecycle + batch orchestrator
 *
 * This module provides a testable entry point that combines:
 * - Run lifecycle management (withRun)
 * - Batch offer ingestion (ingestOffers)
 * - Company aggregation (aggregateCompaniesAndPersist) - M4.B3.3
 *
 * Returns the complete execution context (runId, result, counters) for test assertions.
 */

import type {
  Provider,
  JobOfferSummary,
  JobOfferDetail,
  RunOfferBatchResult,
} from "@/types";
import { withRun } from "./runLifecycle";
import { ingestOffers } from "./ingestOffers";
import { aggregateCompaniesAndPersist } from "./aggregateCompanies";
import * as logger from "@/logger";

/**
 * Run a batch ingestion with full lifecycle tracking
 *
 * Wraps `ingestOffers` + `aggregateCompaniesAndPersist` in `withRun` to:
 * - Create and finalize an ingestion run record
 * - Track counters through the accumulator
 * - Aggregate affected companies at end-of-run
 * - Persist final counters on run completion
 *
 * Per-offer failures do not throw; only fatal init/db errors can throw.
 *
 * @param provider - Provider identifier (e.g., "infojobs")
 * @param offers - Array of canonical job offers
 * @returns Run ID, ingestion result, and final counters snapshot
 */
export async function runOfferBatchIngestion(
  provider: Provider,
  offers: (JobOfferSummary | JobOfferDetail)[],
): Promise<RunOfferBatchResult> {
  let capturedRunId = 0;
  let capturedCounters: RunOfferBatchResult["counters"] = {};

  const result = await withRun(provider, undefined, async (runId, acc) => {
    capturedRunId = runId;

    // Set offers_fetched to total offers attempted
    acc.counters.offers_fetched = offers.length;

    // Track affected company IDs for M4 aggregation
    const affectedCompanyIds = new Set<number>();

    // Run batch ingestion with accumulator + company tracking
    const ingestionResult = ingestOffers({
      provider,
      offers,
      acc,
      affectedCompanyIds,
    });

    // Run company aggregation for all affected companies
    logger.info("Starting company aggregation for affected companies", {
      affectedCompanies: affectedCompanyIds.size,
    });

    const aggregationResult = await aggregateCompaniesAndPersist(
      Array.from(affectedCompanyIds),
    );

    // Update accumulator with aggregation results
    acc.counters.companies_aggregated = aggregationResult.ok;
    acc.counters.companies_failed = aggregationResult.failed;

    // Capture counters snapshot before withRun finalizes
    capturedCounters = { ...acc.counters };

    return ingestionResult;
  });

  logger.info("Run-wrapped batch ingestion complete", {
    runId: capturedRunId,
    provider,
    processed: result.processed,
    upserted: result.upserted,
    duplicates: result.duplicates,
    skipped: result.skipped,
    failed: result.failed,
    affectedCompanies: result.affectedCompanies,
    companiesAggregated: capturedCounters.companies_aggregated ?? 0,
    companiesFailed: capturedCounters.companies_failed ?? 0,
  });

  return {
    runId: capturedRunId,
    result,
    counters: capturedCounters,
  };
}
