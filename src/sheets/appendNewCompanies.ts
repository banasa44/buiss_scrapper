/**
 * Append new companies to Google Sheets
 *
 * Appends only companies not yet present in the sheet.
 * Does not update existing rows.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import type { CatalogRuntime, AppendCompaniesResult } from "@/types";
import { listAllCompanies } from "@/db";
import { readCompanySheet } from "./sheetReader";
import { mapCompanyToSheetRow } from "./companyRowMapper";
import {
  COMPANY_SHEET_READ_RANGE,
  SHEETS_APPEND_BATCH_SIZE,
} from "@/constants";
import { info, warn, error } from "@/logger";

/**
 * Append new companies to sheet (skip existing)
 *
 * Process:
 * 1. Read sheet index (company_id set of existing rows)
 * 2. Fetch all companies from DB
 * 3. Filter to companies not present in sheet
 * 4. Map each to sheet row format
 * 5. Append in batches
 * 6. Return summary statistics
 *
 * Error handling:
 * - Sheet read errors: return { ok: false } with error message
 * - Append errors: return { ok: false } with error message
 * - Mapping errors: log warning and skip individual company (continue)
 *
 * @param client - GoogleSheetsClient instance
 * @param catalog - Compiled catalog for category label resolution
 * @returns AppendCompaniesResult with counts and success status
 */
export async function appendNewCompaniesToSheet(
  client: GoogleSheetsClient,
  catalog: CatalogRuntime,
): Promise<AppendCompaniesResult> {
  // Step 1: Read existing sheet index
  const sheetResult = await readCompanySheet(client);
  const existingCompanyIds = new Set(sheetResult.index.keys());

  info("Read company sheet index", {
    existingCompanies: existingCompanyIds.size,
    validRows: sheetResult.validRows,
    skippedRows: sheetResult.skippedRows,
  });

  // Step 2: Fetch all companies from DB
  const allCompanies = listAllCompanies();
  const totalCompanies = allCompanies.length;

  info("Fetched companies from DB", { totalCompanies });

  // Step 3: Filter to new companies (not in sheet)
  const newCompanies = allCompanies.filter(
    (company) => !existingCompanyIds.has(company.id),
  );

  if (newCompanies.length === 0) {
    info("No new companies to append");
    return {
      ok: true,
      appendedCount: 0,
      appendedCompanyIds: [],
      skippedCount: totalCompanies,
      totalCompanies,
    };
  }

  // Step 4: Map to sheet rows
  const rowsToAppend: (string | number)[][] = [];
  const appendedCompanyIds: number[] = [];
  let mappingErrors = 0;

  for (const company of newCompanies) {
    try {
      const row = mapCompanyToSheetRow(company, catalog);
      rowsToAppend.push(row);
      appendedCompanyIds.push(company.id);
    } catch (err) {
      warn("Failed to map company to sheet row, skipping", {
        companyId: company.id,
        companyName: company.name_display ?? company.normalized_name,
        error: String(err),
      });
      mappingErrors++;
    }
  }

  if (rowsToAppend.length === 0) {
    error("All companies failed mapping, nothing to append", {
      newCompanies: newCompanies.length,
      mappingErrors,
    });
    return {
      ok: false,
      appendedCount: 0,
      appendedCompanyIds: [],
      skippedCount: totalCompanies - newCompanies.length,
      totalCompanies,
      error: "All companies failed mapping",
    };
  }

  // Step 5: Append in batches
  let appendedCount = 0;

  for (let i = 0; i < rowsToAppend.length; i += SHEETS_APPEND_BATCH_SIZE) {
    const batch = rowsToAppend.slice(i, i + SHEETS_APPEND_BATCH_SIZE);
    const batchNumber = Math.floor(i / SHEETS_APPEND_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(
      rowsToAppend.length / SHEETS_APPEND_BATCH_SIZE,
    );

    info("Appending batch to sheet", {
      batchNumber,
      totalBatches,
      batchSize: batch.length,
    });

    const appendResult = await client.appendRows(
      batch,
      COMPANY_SHEET_READ_RANGE,
    );

    if (!appendResult.ok) {
      error("Failed to append batch to sheet", {
        batchNumber,
        error: appendResult.error,
      });
      return {
        ok: false,
        appendedCount,
        appendedCompanyIds: appendedCompanyIds.slice(0, appendedCount),
        skippedCount: totalCompanies - newCompanies.length,
        totalCompanies,
        error: `Failed to append batch ${batchNumber}: ${appendResult.error?.message || "Unknown error"}`,
      };
    }

    appendedCount += batch.length;
  }

  // Step 6: Return summary
  info("Successfully appended companies to sheet", {
    appendedCount,
    skippedCount: totalCompanies - newCompanies.length,
    totalCompanies,
    mappingErrors,
  });

  return {
    ok: true,
    appendedCount,
    appendedCompanyIds,
    skippedCount: totalCompanies - newCompanies.length,
    totalCompanies,
  };
}
