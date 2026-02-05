/**
 * Process Sheets Feedback — orchestration entrypoint for M6 feedback loop
 *
 * Coordinates the complete feedback processing pipeline (read-only):
 * 1. Window gate check (BUILD-4)
 * 2. Read feedback from Sheets (BUILD-1)
 * 3. Build diff plan vs DB (BUILD-2)
 * 4. Validate and classify transitions (BUILD-3)
 *
 * This function does NOT modify the database or delete anything.
 * It only reads and produces a validated action plan.
 *
 * Part of M6 – Sheets Feedback Loop & Company Lifecycle
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import type { ProcessFeedbackResult } from "@/types";
import { shouldRunFeedbackIngestion } from "./feedbackWindow";
import { readCompanyFeedbackFromSheet } from "./feedbackReader";
import { buildFeedbackChangePlan } from "./feedbackComparison";
import { validateFeedbackChangePlan } from "./feedbackValidation";
import * as logger from "@/logger";

/**
 * Process feedback from Google Sheets
 *
 * Orchestrates the complete feedback pipeline in strict order:
 * 1. Check if within feedback window (03:00-06:00 Europe/Madrid)
 * 2. Read company_id + resolution from sheet
 * 3. Compare against DB state and build change plan
 * 4. Validate and classify transitions by lifecycle impact
 *
 * Error handling:
 * - Window blocked: returns ok=true, skipped=true (not an error)
 * - Sheets API failure: returns ok=false with error
 * - DB read failure: returns ok=false with error
 * - Never throws except for fatal configuration issues
 *
 * Emits exactly ONE structured info log with complete statistics.
 *
 * @param client - GoogleSheetsClient instance
 * @param now - Optional Date for window check (defaults to current time, used for testing)
 * @returns ProcessFeedbackResult with validated plan and statistics
 */
export async function processSheetsFeedback(
  client: GoogleSheetsClient,
  now?: Date,
): Promise<ProcessFeedbackResult> {
  // Step 1: Check feedback window gate
  const windowCheck = shouldRunFeedbackIngestion(now);

  if (!windowCheck.allowed) {
    // Window blocked - skip feedback processing (not an error)
    // Note: Final audit logging done in runOfferBatch.ts (BUILD-11)
    return {
      ok: true,
      skipped: true,
      reason: windowCheck.reason,
    };
  }

  try {
    // Step 2: Read feedback from Google Sheets
    const feedbackReadResult = await readCompanyFeedbackFromSheet(client);

    // Step 3: Build diff plan (compare sheet vs DB)
    const changePlan = buildFeedbackChangePlan(feedbackReadResult);

    // Step 4: Validate and classify transitions
    const validatedPlan = validateFeedbackChangePlan(changePlan);

    // Note: Final audit logging done in runOfferBatch.ts (BUILD-11)

    return {
      ok: true,
      skipped: false,
      feedbackReadResult,
      changePlan,
      validatedPlan,
    };
  } catch (err) {
    // Handle unexpected errors (Sheets API failure, DB failure, etc.)
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error("Feedback processing failed", {
      error: errorMessage,
      skipped: false,
    });

    return {
      ok: false,
      skipped: false,
      error: errorMessage,
    };
  }
}
