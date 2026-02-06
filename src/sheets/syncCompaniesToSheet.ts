/**
 * Sync companies to Google Sheets (append + update)
 *
 * Single entrypoint that orchestrates:
 * 1. Append new companies not yet in sheet
 * 2. Update metrics for existing companies
 *
 * Emits one structured summary log at completion.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import type { CatalogRuntime, SyncCompaniesResult } from "@/types";
import { appendNewCompaniesToSheet } from "./appendNewCompanies";
import { updateCompanyMetricsInSheet } from "./updateCompanyMetrics";
import { enforceCompanySheetHeader } from "./headerEnforcer";
import { info } from "@/logger";

/**
 * Sync companies to sheet: append new, update existing
 *
 * Process:
 * 1. Append new companies (not in sheet)
 * 2. Update metrics for existing companies (already in sheet)
 * 3. Emit single summary log with combined statistics
 *
 * Error handling:
 * - Append failure: still attempt update (best-effort)
 * - Update failure: report in combined result
 * - Global ok=true only if both succeeded
 *
 * @param client - GoogleSheetsClient instance
 * @param catalog - Compiled catalog for category label resolution
 * @returns SyncCompaniesResult with combined statistics
 */
export async function syncCompaniesToSheet(
  client: GoogleSheetsClient,
  catalog: CatalogRuntime,
): Promise<SyncCompaniesResult> {
  // Step 0: Enforce header contract before any operations
  await enforceCompanySheetHeader(client);

  const errors: string[] = [];

  // Step 1: Append new companies
  const appendResult = await appendNewCompaniesToSheet(client, catalog);
  if (!appendResult.ok && appendResult.error) {
    errors.push(`Append failed: ${appendResult.error}`);
  }

  // Step 2: Update existing companies (best-effort, even if append failed)
  const updateResult = await updateCompanyMetricsInSheet(client, catalog);
  if (!updateResult.ok && updateResult.error) {
    errors.push(`Update failed: ${updateResult.error}`);
  }

  // Step 3: Combine results
  const totalCompanies = appendResult.totalCompanies; // Both should report same total
  const appendedCount = appendResult.appendedCount;
  const updatedCount = updateResult.updatedCount;

  // Skipped count: companies neither appended nor updated
  // This happens when a company exists in sheet but fails update mapping
  const skippedCount =
    totalCompanies - (appendedCount + updateResult.updatedCount);

  const ok = appendResult.ok && updateResult.ok;

  // Step 4: Emit single summary log
  info("Company sheet sync completed", {
    ok,
    totalCompanies,
    appendedCount,
    updatedCount,
    skippedCount,
    errors: errors.length > 0 ? errors : undefined,
  });

  return {
    ok,
    totalCompanies,
    appendedCount,
    updatedCount,
    skippedCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}
