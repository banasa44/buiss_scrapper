/**
 * Sheet Reader — minimal read-only connector for company data
 *
 * Reads the Google Sheet and returns an index of:
 * company_id -> { rowIndex, resolution }
 *
 * This is a smoke test to validate the GoogleSheets client works end-to-end.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import type {
  CompanySheetRow,
  SheetCompanyIndex,
  ReadCompanySheetResult,
  CompanyResolution,
} from "@/types";
import {
  COMPANY_SHEET_READ_RANGE,
  COMPANY_SHEET_COL_INDEX_COMPANY_ID,
  COMPANY_SHEET_COL_INDEX_RESOLUTION,
  VALID_RESOLUTIONS,
} from "@/constants";
import * as logger from "@/logger";

/**
 * Parse a company_id value from sheet cell
 * Returns null if invalid
 */
function parseCompanyId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Parse a resolution value from sheet cell
 * Returns null if invalid or empty
 */
function parseResolution(value: unknown): CompanyResolution | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  if (trimmed === "") {
    return null;
  }
  if (VALID_RESOLUTIONS.includes(trimmed as CompanyResolution)) {
    return trimmed as CompanyResolution;
  }
  return null;
}

/**
 * Read company sheet and build an index
 *
 * Reads the minimum required columns (company_id, resolution) and returns
 * a mapping of company_id -> { rowIndex, resolution }.
 *
 * External data is unreliable: logs and skips malformed rows gracefully.
 *
 * @param client - GoogleSheetsClient instance
 * @returns ReadCompanySheetResult with index and statistics
 */
export async function readCompanySheet(
  client: GoogleSheetsClient,
): Promise<ReadCompanySheetResult> {
  logger.debug("Reading company sheet", { range: COMPANY_SHEET_READ_RANGE });

  const result = await client.readRange(COMPANY_SHEET_READ_RANGE);

  if (!result.ok) {
    logger.error("Failed to read company sheet", { error: result.error });
    return {
      index: new Map(),
      validRows: 0,
      skippedRows: 0,
    };
  }

  const values = result.data.values;
  if (!values || values.length === 0) {
    logger.warn("Company sheet is empty");
    return {
      index: new Map(),
      validRows: 0,
      skippedRows: 0,
    };
  }

  const index: SheetCompanyIndex = new Map();
  let validRows = 0;
  let skippedRows = 0;

  // Start from row 2 (index 1) to skip header
  // rowIndex is 1-based, so row 2 in the sheet = index 1 in values array
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowIndex = i + 1; // 1-based row number in the sheet

    // Skip completely empty rows
    if (!row || row.length === 0 || row.every((cell) => !cell)) {
      continue;
    }

    const companyIdValue = row[COMPANY_SHEET_COL_INDEX_COMPANY_ID];
    const resolutionValue = row[COMPANY_SHEET_COL_INDEX_RESOLUTION];

    const companyId = parseCompanyId(companyIdValue);

    if (companyId === null) {
      logger.warn("Skipping sheet row with invalid company_id", {
        rowIndex,
        companyIdValue,
      });
      skippedRows++;
      continue;
    }

    const resolution = parseResolution(resolutionValue);

    // Check for duplicate company_id
    if (index.has(companyId)) {
      logger.warn("Duplicate company_id in sheet, keeping first occurrence", {
        companyId,
        firstRow: index.get(companyId)?.rowIndex,
        duplicateRow: rowIndex,
      });
      skippedRows++;
      continue;
    }

    const sheetRow: CompanySheetRow = {
      rowIndex,
      companyId,
      resolution,
    };

    index.set(companyId, sheetRow);
    validRows++;
  }

  logger.info("Company sheet read complete", {
    totalRows: values.length - 1, // Exclude header
    validRows,
    skippedRows,
  });

  return {
    index,
    validRows,
    skippedRows,
  };
}
