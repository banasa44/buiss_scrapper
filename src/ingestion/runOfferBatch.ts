/**
 * Run-wrapped offer batch ingestion — glue for run lifecycle + batch orchestrator
 *
 * This module provides a testable entry point that combines:
 * - Run lifecycle management (withRun)
 * - Batch offer ingestion (ingestOffers)
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
import * as logger from "@/logger";

/**
 * Run a batch ingestion with full lifecycle tracking
 *
 * Wraps `ingestOffers` in `withRun` to:
 * - Create and finalize an ingestion run record
 * - Track counters through the accumulator
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

    // Run batch ingestion with accumulator
    const ingestionResult = ingestOffers({
      provider,
      offers,
      acc,
    });

    // Capture counters snapshot before withRun finalizes
    capturedCounters = { ...acc.counters };

    return ingestionResult;
  });

  logger.info("Run-wrapped batch ingestion complete", {
    runId: capturedRunId,
    provider,
    processed: result.processed,
    upserted: result.upserted,
    skipped: result.skipped,
    failed: result.failed,
  });

  return {
    runId: capturedRunId,
    result,
    counters: capturedCounters,
  };
}
