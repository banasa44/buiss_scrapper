/**
 * Append new companies to Google Sheets
 *
 * Appends only companies not yet present in the sheet.
 * Does not update existing rows.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import type { CatalogRuntime, AppendCompaniesResult } from "@/types";
import { listAllCompanies, getOfferUrlById } from "@/db";
import { readCompanySheet } from "./sheetReader";
import { mapCompanyToSheetRow } from "./companyRowMapper";
import {
  COMPANY_SHEET_NAME,
  COMPANY_SHEET_FIRST_DATA_ROW,
  COMPANY_SHEET_COLUMNS,
  COMPANY_SHEET_COL_INDEX,
  COMPANY_SHEET_READ_RANGE,
  VALID_RESOLUTIONS,
  SHEETS_APPEND_BATCH_SIZE,
} from "@/constants";
import { colIndexToLetter } from "@/utils";
import { info, warn, error } from "@/logger";

/**
 * Resolution column index (0-based for Google Sheets API)
 */
const RESOLUTION_COLUMN_INDEX = COMPANY_SHEET_COL_INDEX.resolution;

type AppendedRowBounds = {
  firstRow: number;
  lastRow: number;
};

/**
 * Parse appended row bounds from Sheets A1 updatedRange (e.g., "Companies!A12:L20")
 */
function parseUpdatedRangeRowBounds(
  updatedRange: string,
): AppendedRowBounds | null {
  const sheetSeparatorIndex = updatedRange.lastIndexOf("!");
  const a1Range =
    sheetSeparatorIndex >= 0
      ? updatedRange.slice(sheetSeparatorIndex + 1)
      : updatedRange;

  const [startCell, endCell] = a1Range.split(":");
  if (!startCell || !endCell) {
    return null;
  }

  const startRowMatch = startCell.match(/(\d+)$/);
  const endRowMatch = endCell.match(/(\d+)$/);
  if (!startRowMatch || !endRowMatch) {
    return null;
  }

  const firstRow = Number(startRowMatch[1]);
  const lastRow = Number(endRowMatch[1]);

  if (
    !Number.isInteger(firstRow) ||
    !Number.isInteger(lastRow) ||
    firstRow < COMPANY_SHEET_FIRST_DATA_ROW ||
    lastRow < firstRow
  ) {
    return null;
  }

  return { firstRow, lastRow };
}

/**
 * Append new companies to sheet (skip existing)
 *
 * Process:
 * 1. Read sheet index (company_id set of existing rows)
 * 2. Fetch all companies from DB
 * 3. Filter to companies not present in sheet
 * 4. Map each to sheet row format
 * 5. Append in batches
 * 6. Propagate template formatting + validation to appended rows
 * 7. Return summary statistics
 *
 * Error handling:
 * - Sheet read errors: return { ok: false } with error message
 * - Append errors: return { ok: false } with error message
 * - Formatting/validation propagation errors: return { ok: false } with error message
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
      // Fetch top offer URL if top_offer_id exists
      const topOfferUrl = company.top_offer_id
        ? getOfferUrlById(company.top_offer_id)
        : null;

      const row = mapCompanyToSheetRow(company, catalog, topOfferUrl);
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
  let firstAppendedRow: number | null = null;
  let lastAppendedRow: number | null = null;

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

    const batchRowBounds = parseUpdatedRangeRowBounds(
      appendResult.data.updates.updatedRange,
    );

    if (!batchRowBounds) {
      error("Failed to parse appended row bounds from updatedRange", {
        batchNumber,
        updatedRange: appendResult.data.updates.updatedRange,
      });
      return {
        ok: false,
        appendedCount,
        appendedCompanyIds: appendedCompanyIds.slice(0, appendedCount),
        skippedCount: totalCompanies - newCompanies.length,
        totalCompanies,
        error: `Failed to parse appended row bounds for batch ${batchNumber}`,
      };
    }

    firstAppendedRow =
      firstAppendedRow === null
        ? batchRowBounds.firstRow
        : Math.min(firstAppendedRow, batchRowBounds.firstRow);
    lastAppendedRow =
      lastAppendedRow === null
        ? batchRowBounds.lastRow
        : Math.max(lastAppendedRow, batchRowBounds.lastRow);

    appendedCount += batch.length;
  }

  // Defensive no-op guard: avoid structural API calls when nothing was appended.
  if (appendedCount === 0) {
    info("No appended rows to propagate formatting/validation");
    return {
      ok: true,
      appendedCount,
      appendedCompanyIds: appendedCompanyIds.slice(0, appendedCount),
      skippedCount: totalCompanies - newCompanies.length,
      totalCompanies,
    };
  }

  if (firstAppendedRow === null || lastAppendedRow === null) {
    error("Missing appended row bounds after successful appends", {
      appendedCount,
    });
    return {
      ok: false,
      appendedCount,
      appendedCompanyIds: appendedCompanyIds.slice(0, appendedCount),
      skippedCount: totalCompanies - newCompanies.length,
      totalCompanies,
      error: "Missing appended row bounds after append operation",
    };
  }

  // Step 6: Propagate formatting + validation to appended rows
  const templateSheetIdResult = await client.getSheetIdByTitle(
    COMPANY_SHEET_NAME,
  );

  if (!templateSheetIdResult.ok) {
    error(
      "Failed to resolve Companies sheet id for append formatting propagation",
      {
        error: templateSheetIdResult.error,
      },
    );
    return {
      ok: false,
      appendedCount,
      appendedCompanyIds: appendedCompanyIds.slice(0, appendedCount),
      skippedCount: totalCompanies - newCompanies.length,
      totalCompanies,
      error: `Failed to resolve sheet id for formatting propagation: ${templateSheetIdResult.error.message}`,
    };
  }

  const { sheetId } = templateSheetIdResult.data;
  const firstColumnIndex = COMPANY_SHEET_COL_INDEX.company_id;
  const lastColumnExclusiveIndex = COMPANY_SHEET_COLUMNS.length;
  const templateRowStartIndex = COMPANY_SHEET_FIRST_DATA_ROW - 1;
  const resolutionColumnLetter = colIndexToLetter(RESOLUTION_COLUMN_INDEX);

  const sourceRange = {
    sheetId,
    startRowIndex: templateRowStartIndex,
    endRowIndex: templateRowStartIndex + 1,
    startColumnIndex: firstColumnIndex,
    endColumnIndex: lastColumnExclusiveIndex,
  };

  const destinationRange = {
    sheetId,
    startRowIndex: firstAppendedRow - 1,
    endRowIndex: lastAppendedRow,
    startColumnIndex: firstColumnIndex,
    endColumnIndex: lastColumnExclusiveIndex,
  };

  const resolutionValidationRequest = {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: firstAppendedRow - 1,
        endRowIndex: lastAppendedRow,
        startColumnIndex: RESOLUTION_COLUMN_INDEX,
        endColumnIndex: RESOLUTION_COLUMN_INDEX + 1,
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: VALID_RESOLUTIONS.map((value) => ({
            userEnteredValue: value,
          })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  };

  const propagateResult = await client.applySheetBatchUpdate([
    {
      copyPaste: {
        source: sourceRange,
        destination: destinationRange,
        pasteType: "PASTE_FORMAT",
      },
    },
    resolutionValidationRequest,
  ]);

  if (!propagateResult.ok) {
    error("Failed to propagate formatting/validation to appended rows", {
      firstAppendedRow,
      lastAppendedRow,
      appendedCount,
      error: propagateResult.error,
    });
    return {
      ok: false,
      appendedCount,
      appendedCompanyIds: appendedCompanyIds.slice(0, appendedCount),
      skippedCount: totalCompanies - newCompanies.length,
      totalCompanies,
      error: `Failed to propagate formatting/validation for appended rows: ${propagateResult.error.message}`,
    };
  }

  info("Propagated formatting/validation to appended rows", {
    templateRow: COMPANY_SHEET_FIRST_DATA_ROW,
    firstAppendedRow,
    lastAppendedRow,
    appendedCount,
    resolutionValidationRange: `${resolutionColumnLetter}${firstAppendedRow}:${resolutionColumnLetter}${lastAppendedRow}`,
  });

  // Step 7: Return summary
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
