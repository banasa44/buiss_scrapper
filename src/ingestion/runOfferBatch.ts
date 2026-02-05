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
import { syncCompaniesToSheet } from "@/sheets";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { GOOGLE_SHEETS_SPREADSHEET_ID_ENV } from "@/constants/clients/googleSheets";
import { loadCatalog } from "@/catalog";
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
    const aggregationResult = await aggregateCompaniesAndPersist(
      Array.from(affectedCompanyIds),
    );

    // Update accumulator with aggregation results
    acc.counters.companies_aggregated = aggregationResult.ok;
    acc.counters.companies_failed = aggregationResult.failed;

    // Sync companies to Sheets (best-effort, don't fail run if Sheets unavailable)
    const spreadsheetId = process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV];
    if (spreadsheetId) {
      try {
        const sheetsClient = new GoogleSheetsClient({ spreadsheetId });
        const catalog = loadCatalog();
        const sheetsResult = await syncCompaniesToSheet(sheetsClient, catalog);

        if (sheetsResult.ok) {
          logger.info("Sheets sync completed", {
            appendedCount: sheetsResult.appendedCount,
            updatedCount: sheetsResult.updatedCount,
            skippedCount: sheetsResult.skippedCount,
          });
        } else {
          logger.warn("Sheets sync completed with errors", {
            appendedCount: sheetsResult.appendedCount,
            updatedCount: sheetsResult.updatedCount,
            skippedCount: sheetsResult.skippedCount,
            errors: sheetsResult.errors,
          });
        }
      } catch (err) {
        logger.warn("Sheets sync failed (non-fatal)", {
          error: String(err),
        });
      }
    }

    // Capture counters snapshot before withRun finalizes
    capturedCounters = { ...acc.counters };

    return ingestionResult;
  });

  // Final run summary: exactly one info log per run with all telemetry
  logger.info("Run completed", {
    runId: capturedRunId,
    provider,
    status: "success",
    counters: {
      offersFetched: capturedCounters.offers_fetched ?? 0,
      offersUpserted: capturedCounters.offers_upserted ?? 0,
      offersDuplicates: capturedCounters.offers_duplicates ?? 0,
      offersSkipped: capturedCounters.offers_skipped ?? 0,
      offersFailed: capturedCounters.offers_failed ?? 0,
      companiesAggregated: capturedCounters.companies_aggregated ?? 0,
      companiesFailed: capturedCounters.companies_failed ?? 0,
      affectedCompanies: result.affectedCompanies,
    },
  });

  return {
    runId: capturedRunId,
    result,
    counters: capturedCounters,
  };
}
