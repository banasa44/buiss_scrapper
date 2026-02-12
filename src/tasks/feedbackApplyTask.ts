/**
 * Feedback Apply Task
 *
 * Reads Google Sheets feedback column and applies resolution changes to DB.
 * Feature-gated internally: skips safely if Sheets not configured or outside nightly window.
 *
 * This is the sixth stage in the pipeline, executed after Sheets sync.
 *
 * Part of M6 – Sheets Feedback Loop & Company Lifecycle
 */

import type { Task, TaskContext } from "@/types";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import {
  processSheetsFeedback,
  applyValidatedFeedbackPlanToDb,
  readModelFeedbackFromSheet,
  persistModelFeedbackEvents,
} from "@/sheets";
import { GOOGLE_SHEETS_SPREADSHEET_ID_ENV } from "@/constants/clients/googleSheets";

/**
 * Feedback apply task implementation
 *
 * Processes feedback from Google Sheets and applies to database.
 * Database must be opened before this task runs (handled by runner).
 *
 * Feature-gating:
 * - If GOOGLE_SHEETS_SPREADSHEET_ID env not set: early return (info log)
 * - If outside nightly window (03:00-06:00 Europe/Madrid): early return (info log, handled by processSheetsFeedback)
 * - If client init/auth fails: propagate error (configuration issue)
 *
 * Error handling:
 * - Best-effort: feedback processing errors are logged but don't throw
 * - Only fatal configuration issues propagate (missing credentials, auth failure)
 */
export const FeedbackApplyTask: Task = {
  taskKey: "sheets:feedback:apply",
  name: "Feedback Apply",
  clientKey: "googleSheets",

  async runOnce(ctx: TaskContext): Promise<void> {
    // Feature gate: check if Sheets is configured
    const spreadsheetId = process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV];

    if (!spreadsheetId) {
      ctx.logger.info("Feedback apply skipped: Sheets not configured", {
        requiredEnv: GOOGLE_SHEETS_SPREADSHEET_ID_ENV,
      });
      return;
    }

    // Initialize client (throws if credentials missing - configuration error)
    const client = new GoogleSheetsClient({ spreadsheetId });

    // Assert auth ready (throws if auth fails - configuration error)
    await client.assertAuthReady();

    // Process feedback (orchestrates read + validation, includes window gate)
    const feedbackResult = await processSheetsFeedback(client);

    // Window gate: skip if outside allowed window
    if (feedbackResult.skipped) {
      ctx.logger.info("Feedback apply skipped: outside nightly window", {
        reason: feedbackResult.reason,
      });
      return;
    }

    // Error case: processing failed
    if (!feedbackResult.ok) {
      ctx.logger.warn("Feedback processing failed (non-fatal)", {
        error: feedbackResult.error,
      });
      return;
    }

    // No validated plan: nothing to apply
    if (!feedbackResult.validatedPlan) {
      ctx.logger.info("Feedback apply skipped: no validated plan");
      return;
    }

    // Log start (only when actually applying changes)
    ctx.logger.info("Applying feedback changes to database");

    // Apply validated changes to DB
    const applyResult = applyValidatedFeedbackPlanToDb(
      feedbackResult.validatedPlan,
    );

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

    // Comprehensive feedback audit log
    ctx.logger.info("Feedback apply complete", {
      sheetRead: {
        totalRows: feedbackResult.feedbackReadResult!.totalRows,
        validRows: feedbackResult.feedbackReadResult!.validRows,
        invalidRows: feedbackResult.feedbackReadResult!.invalidRows,
        duplicateRows: feedbackResult.feedbackReadResult!.duplicateRows,
      },
      diff: {
        knownCompanyIds: feedbackResult.changePlan!.knownCompanyIds,
        unknownCompanyIds: feedbackResult.changePlan!.unknownCompanyIds,
        changesDetected: feedbackResult.changePlan!.changesDetected,
        unchanged: feedbackResult.changePlan!.unchanged,
      },
      validation: {
        destructiveCount: feedbackResult.validatedPlan.destructiveCount,
        reversalCount: feedbackResult.validatedPlan.reversalCount,
        informationalCount: feedbackResult.validatedPlan.informationalCount,
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
        unknownCompanyIds: feedbackResult.changePlan!.unknownCompanyIds,
        invalidRows: feedbackResult.feedbackReadResult!.invalidRows,
      },
    });

    // Process model performance feedback (K/L columns)
    // Window gate already checked above; shares same nightly window
    ctx.logger.info("Reading model performance feedback");
    const modelFeedbackResult = await readModelFeedbackFromSheet(client);

    if (modelFeedbackResult.validRows > 0) {
      ctx.logger.info("Persisting model feedback events to database");
      const persistResult = persistModelFeedbackEvents(
        modelFeedbackResult.events,
      );

      ctx.logger.info("Model feedback persistence complete", {
        totalRowsWithFeedback: modelFeedbackResult.totalRows,
        validRows: modelFeedbackResult.validRows,
        invalidRows: modelFeedbackResult.invalidRows,
        attempted: persistResult.attempted,
        persisted: persistResult.persisted,
        duplicatesIgnored: persistResult.attempted - persistResult.persisted,
        failed: persistResult.failed,
      });
    } else {
      ctx.logger.info("No model feedback to persist", {
        totalRowsWithFeedback: modelFeedbackResult.totalRows,
      });
    }
  },
};
