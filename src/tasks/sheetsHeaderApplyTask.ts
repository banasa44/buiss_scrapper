/**
 * Sheets Header Apply Task
 *
 * Explicit developer-invoked task that applies the Companies header contract.
 * This task is opt-in via manual registry and never runs in normal runner flow.
 */

import type { Task, TaskContext } from "@/types";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { applyCompanySheetHeader } from "@/sheets";
import { GOOGLE_SHEETS_SPREADSHEET_ID_ENV } from "@/constants/clients/googleSheets";

/**
 * Apply Companies header contract to Google Sheets.
 *
 * Manual-only:
 * - Discoverable by taskKey via findTaskByKey
 * - Not included in automatic runner task list
 * - Intended to be invoked from dedicated apply command
 */
export const SheetsHeaderApplyTask: Task = {
  taskKey: "sheets:header:apply",
  name: "Sheets Header Apply",
  clientKey: "googleSheets",

  async runOnce(ctx: TaskContext): Promise<void> {
    const spreadsheetId = process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV]?.trim();

    if (!spreadsheetId) {
      throw new Error(
        "Missing GOOGLE_SHEETS_SPREADSHEET_ID. Set it in .env or environment.",
      );
    }

    ctx.logger.info("Starting explicit Companies header apply task");

    const client = new GoogleSheetsClient({ spreadsheetId });
    await client.assertAuthReady();
    await applyCompanySheetHeader(client);

    ctx.logger.info("Explicit Companies header apply task complete");
  },
};
