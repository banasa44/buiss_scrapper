/**
 * Update company metrics in Google Sheets
 *
 * Updates metric columns for companies already present in the sheet.
 * Preserves resolution and any client-added columns.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import type {
  CatalogRuntime,
  UpdateCompaniesResult,
  UpdateOperation,
} from "@/types";
import { listAllCompanies } from "@/db";
import { readCompanySheet } from "./sheetReader";
import { mapCompanyToSheetRow } from "./companyRowMapper";
import { extractMetricSlice, buildMetricUpdateRange } from "@/utils";
import { SHEETS_UPDATE_BATCH_SIZE } from "@/constants";
import { info, warn, error } from "@/logger";

/**
 * Update metrics for existing companies in sheet
 *
 * Process:
 * 1. Read sheet index (company_id -> rowIndex mapping)
 * 2. Fetch all companies from DB
 * 3. Filter to companies present in sheet
 * 4. Map each to sheet row and extract metric columns only
 * 5. Update in batches using A1 range notation
 * 6. Return summary statistics
 *
 * Column preservation:
 * - company_id, company_name, resolution: NOT updated (preserved)
 * - Metric columns (indices 3-9): updated from DB
 * - Any client-added columns beyond index 9: NOT touched
 *
 * Error handling:
 * - Sheet read errors: return { ok: false }
 * - Update errors: return { ok: false }
 * - Mapping errors: log warning and skip individual company
 *
 * @param client - GoogleSheetsClient instance
 * @param catalog - Compiled catalog for category label resolution
 * @returns UpdateCompaniesResult with counts and success status
 */
export async function updateCompanyMetricsInSheet(
  client: GoogleSheetsClient,
  catalog: CatalogRuntime,
): Promise<UpdateCompaniesResult> {
  // Step 1: Read existing sheet index
  const sheetResult = await readCompanySheet(client);

  info("Read company sheet index for updates", {
    existingCompanies: sheetResult.index.size,
    validRows: sheetResult.validRows,
    skippedRows: sheetResult.skippedRows,
  });

  // Step 2: Fetch all companies from DB
  const allCompanies = listAllCompanies();
  const totalCompanies = allCompanies.length;

  info("Fetched companies from DB for metric updates", { totalCompanies });

  // Step 3: Filter to companies present in sheet
  const existingCompanies = allCompanies.filter((company) =>
    sheetResult.index.has(company.id),
  );

  if (existingCompanies.length === 0) {
    info("No existing companies to update");
    return {
      ok: true,
      updatedCount: 0,
      updatedCompanyIds: [],
      skippedCount: totalCompanies,
      totalCompanies,
    };
  }

  // Step 4: Build update operations (company -> metrics + rowIndex)
  // TODO: Optimization - currently updates all companies every run. Future: add dirty flag (updated_at check) to update only when metrics changed.
  const updateOps: UpdateOperation[] = [];
  const updatedCompanyIds: number[] = [];
  let mappingErrors = 0;

  for (const company of existingCompanies) {
    const sheetRow = sheetResult.index.get(company.id);
    if (!sheetRow) continue; // Should never happen, but defensive

    try {
      const fullRow = mapCompanyToSheetRow(company, catalog);
      // Extract metric columns only (indices 3-9)
      const metricValues = extractMetricSlice(fullRow);

      updateOps.push({
        rowIndex: sheetRow.rowIndex,
        metricValues,
      });
      updatedCompanyIds.push(company.id);
    } catch (err) {
      warn("Failed to map company metrics, skipping update", {
        companyId: company.id,
        companyName: company.name_display ?? company.normalized_name,
        error: String(err),
      });
      mappingErrors++;
    }
  }

  if (updateOps.length === 0) {
    error("All companies failed mapping, nothing to update", {
      existingCompanies: existingCompanies.length,
      mappingErrors,
    });
    return {
      ok: false,
      updatedCount: 0,
      updatedCompanyIds: [],
      skippedCount: totalCompanies - existingCompanies.length,
      totalCompanies,
      error: "All companies failed mapping",
    };
  }

  // Step 5: Update in batches
  let updatedCount = 0;

  for (let i = 0; i < updateOps.length; i += SHEETS_UPDATE_BATCH_SIZE) {
    const batch = updateOps.slice(i, i + SHEETS_UPDATE_BATCH_SIZE);
    const batchNumber = Math.floor(i / SHEETS_UPDATE_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(updateOps.length / SHEETS_UPDATE_BATCH_SIZE);

    info("Updating metric batch in sheet", {
      batchNumber,
      totalBatches,
      batchSize: batch.length,
    });

    // Update each row individually (batchUpdate expects contiguous range)
    for (const op of batch) {
      const range = buildMetricUpdateRange(op.rowIndex);
      const values = [op.metricValues]; // Single row

      const updateResult = await client.batchUpdate(values, range);

      if (!updateResult.ok) {
        error("Failed to update metrics for company row", {
          rowIndex: op.rowIndex,
          range,
          error: updateResult.error,
        });
        return {
          ok: false,
          updatedCount,
          updatedCompanyIds: updatedCompanyIds.slice(0, updatedCount),
          skippedCount: totalCompanies - existingCompanies.length,
          totalCompanies,
          error: `Failed to update row ${op.rowIndex}: ${updateResult.error?.message || "Unknown error"}`,
        };
      }

      updatedCount++;
    }
  }

  // Step 6: Return summary
  info("Successfully updated company metrics in sheet", {
    updatedCount,
    skippedCount: totalCompanies - existingCompanies.length,
    totalCompanies,
    mappingErrors,
  });

  return {
    ok: true,
    updatedCount,
    updatedCompanyIds,
    skippedCount: totalCompanies - existingCompanies.length,
    totalCompanies,
  };
}
