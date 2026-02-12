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
import {
  processSheetsFeedback,
  applyValidatedFeedbackPlanToDb,
} from "@/sheets";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { GOOGLE_SHEETS_SPREADSHEET_ID_ENV } from "@/constants/clients/googleSheets";
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
 * @param queryKey - Optional query key from query registry (for M7 scheduling)
 * @returns Run ID, ingestion result, and final counters snapshot
 */
export async function runOfferBatchIngestion(
  provider: Provider,
  offers: (JobOfferSummary | JobOfferDetail)[],
  queryKey?: string,
): Promise<RunOfferBatchResult> {
  let capturedRunId = 0;
  let capturedCounters: RunOfferBatchResult["counters"] = {};

  const result = await withRun(
    provider,
    undefined,
    async (runId, acc) => {
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
        let sheetsClient: GoogleSheetsClient;

        try {
          sheetsClient = new GoogleSheetsClient({ spreadsheetId });
        } catch (err) {
          logger.error("Sheets client initialization failed", {
            error: String(err),
          });
          throw err;
        }

        try {
          await sheetsClient.assertAuthReady();
        } catch (err) {
          logger.error("Sheets authentication failed during initialization", {
            error: String(err),
          });
          throw err;
        }

        try {
          // ========================================================================
          // NOTE: Sheets sync now handled by SheetsSyncTask (task-based migration)
          // ========================================================================
          // The syncCompaniesToSheet call previously here has been migrated to
          // SheetsSyncTask, which runs in the task pipeline phase (before queries).
          //
          // This prevents double-execution:
          // - Task phase: SheetsSyncTask syncs companies to Sheets
          // - Query phase: Feedback loop (below) reads from already-synced Sheet
          //
          // Legacy sync code removed to eliminate duplication.
          // For context, see: src/tasks/sheetsSyncTask.ts
          // ========================================================================

          // M6: Process feedback loop (reads from Sheet synced by SheetsSyncTask)
          // Nightly gated (03:00-06:00), best-effort error handling
          try {
            const feedbackResult = await processSheetsFeedback(sheetsClient);

            if (
              feedbackResult.ok &&
              !feedbackResult.skipped &&
              feedbackResult.validatedPlan
            ) {
              // Apply validated changes to DB (update resolution + delete offers)
              const applyResult = applyValidatedFeedbackPlanToDb(
                feedbackResult.validatedPlan,
              );

              // M6.BUILD-11: Comprehensive feedback audit log
              // Compute resolution breakdown for audit trail
              const byToResolution: Record<string, number> = {};
              for (const change of [
                ...feedbackResult.validatedPlan.destructiveChanges,
                ...feedbackResult.validatedPlan.reversalChanges,
                ...feedbackResult.validatedPlan.informationalChanges,
              ]) {
                byToResolution[change.toResolution] =
                  (byToResolution[change.toResolution] || 0) + 1;
              }

              logger.info("Feedback audit", {
                window: {
                  skipped: false,
                },
                sheetRead: {
                  totalRows: feedbackResult.feedbackReadResult!.totalRows,
                  validRows: feedbackResult.feedbackReadResult!.validRows,
                  invalidRows: feedbackResult.feedbackReadResult!.invalidRows,
                  duplicateRows:
                    feedbackResult.feedbackReadResult!.duplicateRows,
                },
                diff: {
                  knownCompanyIds: feedbackResult.changePlan!.knownCompanyIds,
                  unknownCompanyIds:
                    feedbackResult.changePlan!.unknownCompanyIds,
                  changesDetected: feedbackResult.changePlan!.changesDetected,
                  unchanged: feedbackResult.changePlan!.unchanged,
                },
                validation: {
                  destructiveCount:
                    feedbackResult.validatedPlan.destructiveCount,
                  reversalCount: feedbackResult.validatedPlan.reversalCount,
                  informationalCount:
                    feedbackResult.validatedPlan.informationalCount,
                },
                resolutionUpdates: {
                  attempted: applyResult.attempted,
                  updated: applyResult.updated,
                  skipped: applyResult.skipped,
                  failed: applyResult.failed,
                  byToResolution,
                },
                offerDeletions: {
                  attemptedCompanies: applyResult.offerDeletionAttempted,
                  deletedOffersTotal: applyResult.offersDeleted,
                  failedCompanies: applyResult.offerDeletionsFailed,
                },
                ignored: {
                  unknownCompanyIds:
                    feedbackResult.changePlan!.unknownCompanyIds,
                  invalidRows: feedbackResult.feedbackReadResult!.invalidRows,
                },
              });
            } else if (feedbackResult.skipped) {
              // Window gate blocked - emit skip audit log
              logger.info("Feedback audit", {
                window: {
                  skipped: true,
                  reason: feedbackResult.reason,
                },
              });
            } else {
              // Error occurred - already logged by processSheetsFeedback
              logger.warn("Feedback loop skipped due to processing error", {
                error: feedbackResult.error,
              });
            }
          } catch (err) {
            // Best-effort: feedback loop failure should not fail the run
            logger.warn("Feedback loop failed (non-fatal)", {
              error: String(err),
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
    },
    queryKey,
  );

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
