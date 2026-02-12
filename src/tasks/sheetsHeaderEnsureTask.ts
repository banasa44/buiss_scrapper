/**
 * Sheets Header Ensure Task
 *
 * Ensures new feedback columns (K: MODEL_FEEDBACK, L: MODEL_NOTES) are present in the Companies sheet.
 * Idempotent: runs safely multiple times, only writes if headers are missing.
 *
 * This task is designed for production reliability when deploying the feedback feature
 * to existing sheets that may only have columns A-J.
 */

import type { Task, TaskContext } from "@/types";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { COMPANY_SHEET_NAME, COMPANY_SHEET_COLUMNS } from "@/constants";
import { GOOGLE_SHEETS_SPREADSHEET_ID_ENV } from "@/constants/clients/googleSheets";

/**
 * Expected headers for feedback columns
 * Derived from COMPANY_SHEET_COLUMNS (K=model_feedback, L=model_notes)
 */
const FEEDBACK_COLUMN_K_HEADER = COMPANY_SHEET_COLUMNS[10].header; // "Feedback Modelo"
const FEEDBACK_COLUMN_L_HEADER = COMPANY_SHEET_COLUMNS[11].header; // "Notas Modelo"

/**
 * Sheets header ensure task implementation
 *
 * Ensures columns K and L have the correct headers for the feedback feature.
 * - If K/L are empty or missing: writes expected headers
 * - If K/L already match: does nothing (idempotent)
 * - If K/L have conflicting content: aborts with error
 *
 * This task is safe to run repeatedly and will not modify columns A-J.
 *
 * Feature-gating:
 * - If GOOGLE_SHEETS_SPREADSHEET_ID env not set: early return (info log)
 * - If client init/auth fails: propagate error (configuration issue)
 */
export const SheetsHeaderEnsureTask: Task = {
  taskKey: "sheets:header:ensure",
  name: "Sheets Header Ensure",
  clientKey: "googleSheets",

  async runOnce(ctx: TaskContext): Promise<void> {
    // Feature gate: check if Sheets is configured
    const spreadsheetId = process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV];

    if (!spreadsheetId) {
      ctx.logger.info("Sheets header ensure skipped: not configured", {
        requiredEnv: GOOGLE_SHEETS_SPREADSHEET_ID_ENV,
      });
      return;
    }

    ctx.logger.info("Ensuring Companies sheet feedback headers");

    // Initialize client (throws if credentials missing - configuration error)
    const client = new GoogleSheetsClient({ spreadsheetId });

    // Assert auth ready (throws if auth fails - configuration error)
    await client.assertAuthReady();

    // Read current header row (A1:L1 covers all expected columns)
    const headerRange = `${COMPANY_SHEET_NAME}!A1:L1`;
    const readResult = await client.readRange(headerRange);

    if (!readResult.ok) {
      const errorMsg = `Failed to read Companies sheet headers: ${readResult.error.message}`;
      ctx.logger.error(errorMsg, { error: readResult.error });
      throw new Error(errorMsg);
    }

    const values = readResult.data.values;
    const currentHeader = values && values.length > 0 ? values[0] : [];

    // Get current values in K1 and L1 (indices 10 and 11)
    const currentK = String(currentHeader[10] ?? "").trim();
    const currentL = String(currentHeader[11] ?? "").trim();

    // Normalize expected headers for comparison (case-insensitive, trimmed)
    const expectedK = FEEDBACK_COLUMN_K_HEADER.trim();
    const expectedL = FEEDBACK_COLUMN_L_HEADER.trim();

    const kMatches =
      currentK === "" || currentK.toLowerCase() === expectedK.toLowerCase();
    const lMatches =
      currentL === "" || currentL.toLowerCase() === expectedL.toLowerCase();

    // Case 1: Both K and L already correct (idempotent case)
    if (
      currentK.toLowerCase() === expectedK.toLowerCase() &&
      currentL.toLowerCase() === expectedL.toLowerCase()
    ) {
      ctx.logger.info("Feedback headers already present, no action needed", {
        columnK: currentK,
        columnL: currentL,
      });
      return;
    }

    // Case 2: K or L have conflicting content (abort with error)
    if (!kMatches || !lMatches) {
      const conflicts: string[] = [];
      if (!kMatches) {
        conflicts.push(`K1: expected "${expectedK}", found "${currentK}"`);
      }
      if (!lMatches) {
        conflicts.push(`L1: expected "${expectedL}", found "${currentL}"`);
      }

      const errorMsg = [
        "Cannot ensure feedback headers: conflicting content detected.",
        "",
        "Conflicts:",
        ...conflicts.map((c) => `  ${c}`),
        "",
        "Next steps:",
        "1. Open the Google Sheet in your browser",
        "2. Manually resolve the conflicts in row 1, columns K-L",
        "3. Retry the operation",
      ].join("\n");

      ctx.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Case 3: K and L are empty or missing -> write headers
    ctx.logger.info("Writing feedback headers to K1:L1", {
      columnK: expectedK,
      columnL: expectedL,
    });

    const feedbackRange = `${COMPANY_SHEET_NAME}!K1:L1`;
    const writeResult = await client.batchUpdate(
      [[expectedK, expectedL]],
      feedbackRange,
    );

    if (!writeResult.ok) {
      const errorMsg = `Failed to write feedback headers: ${writeResult.error.message}`;
      ctx.logger.error(errorMsg, { error: writeResult.error });
      throw new Error(errorMsg);
    }

    ctx.logger.info("Feedback headers written successfully", {
      updatedRange: writeResult.data.updatedRange,
      updatedCells: writeResult.data.updatedCells,
    });
  },
};
