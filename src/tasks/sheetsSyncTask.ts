/**
 * Sheets Sync Task
 *
 * Syncs company data to Google Sheets (append new + update existing).
 * Feature-gated internally: skips safely if Sheets not configured.
 *
 * This is the fifth stage in the pipeline, executed after ATS ingestion.
 */

import type { Task, TaskContext } from "@/types";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { syncCompaniesToSheet } from "@/sheets";
import { loadCatalog } from "@/catalog";
import { GOOGLE_SHEETS_SPREADSHEET_ID_ENV } from "@/constants/clients/googleSheets";

/**
 * Sheets sync task implementation
 *
 * Syncs company aggregation results to Google Sheets.
 * Database must be opened before this task runs (handled by runner).
 *
 * Feature-gating:
 * - If GOOGLE_SHEETS_SPREADSHEET_ID env not set: early return (info log)
 * - If client init/auth fails: propagate error (configuration issue)
 */
export const SheetsSyncTask: Task = {
  taskKey: "sheets:sync",
  name: "Sheets Sync",
  clientKey: "googleSheets",

  async runOnce(ctx: TaskContext): Promise<void> {
    // Feature gate: check if Sheets is configured
    const spreadsheetId = process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV];

    if (!spreadsheetId) {
      ctx.logger.info("Sheets sync skipped: not configured", {
        requiredEnv: GOOGLE_SHEETS_SPREADSHEET_ID_ENV,
      });
      return;
    }

    // Sheets is configured, proceed with sync
    ctx.logger.info("Starting Sheets sync");

    // Initialize client (throws if credentials missing - configuration error)
    const client = new GoogleSheetsClient({ spreadsheetId });

    // Assert auth ready (throws if auth fails - configuration error)
    await client.assertAuthReady();

    // Load catalog for category label resolution
    const catalog = loadCatalog();

    // Execute sync
    const result = await syncCompaniesToSheet(client, catalog);

    // Log completion
    ctx.logger.info("Sheets sync complete", {
      ok: result.ok,
      totalCompanies: result.totalCompanies,
      appendedCount: result.appendedCount,
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount,
      errors: result.errors,
    });
  },
};
