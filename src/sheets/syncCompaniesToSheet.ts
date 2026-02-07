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
import { provisionCompaniesSheet } from "./provisionCompaniesSheet";
import { info } from "@/logger";

/**
 * Sync companies to sheet: append new, update existing
 *
 * Process:
 * 0. Provision sheet (header + data validation)
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
  // Step 0: Provision sheet (header + data validation)
  await provisionCompaniesSheet(client);

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
  // Use Set union to handle cases where same company can be both appended and updated
  // in a single run (update phase reads sheet after append phase completes)
  const actedCompanyIds = new Set([
    ...appendResult.appendedCompanyIds,
    ...updateResult.updatedCompanyIds,
  ]);
  const skippedCount = totalCompanies - actedCompanyIds.size;

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
