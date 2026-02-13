/**
 * Sheet Header Contract Enforcer
 *
 * Ensures the Companies sheet header row matches the expected contract.
 * - If empty/missing: writes the expected header row
 * - If mismatch: fails fast with clear error message
 *
 * This prevents silent data corruption from reading/writing against
 * a sheet with incorrect column order or labels.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import {
  COMPANY_SHEET_NAME,
  COMPANY_SHEET_HEADERS,
  COMPANY_SHEET_COLUMNS,
} from "@/constants";
import * as logger from "@/logger";

/**
 * Enforce header contract for Companies sheet
 *
 * Validates that the sheet header row matches our contract (Spanish labels).
 * - If sheet is empty or header is missing: writes header row
 * - If header exists but differs: throws fatal error
 *
 * This must be called before any read/write operations on the Companies sheet.
 *
 * @param client - GoogleSheetsClient instance
 * @throws Error if header exists but doesn't match contract
 */
export async function enforceCompanySheetHeader(
  client: GoogleSheetsClient,
): Promise<void> {
  // Derive header range dynamically from contract (A1:L1 for 12 columns)
  const lastColumn = String.fromCharCode(65 + COMPANY_SHEET_COLUMNS.length - 1); // 'A' + 11 = 'L'
  const headerRange = `${COMPANY_SHEET_NAME}!A1:${lastColumn}1`;

  logger.debug("Enforcing Companies sheet header contract", { headerRange });

  // Read current header row
  const readResult = await client.readRange(headerRange);

  if (!readResult.ok) {
    const errorMsg = `Failed to read Companies sheet header: ${readResult.error.message}`;
    logger.error(errorMsg, { error: readResult.error });
    throw new Error(errorMsg);
  }

  const values = readResult.data.values;
  const currentHeader = values && values.length > 0 ? values[0] : null;

  // Case 1: Header is missing or empty -> Write expected header
  if (!currentHeader || currentHeader.length === 0) {
    logger.info("Companies sheet header missing, writing expected header", {
      expectedHeaders: COMPANY_SHEET_HEADERS,
    });

    const writeResult = await client.batchUpdate(
      [COMPANY_SHEET_HEADERS],
      headerRange,
    );

    if (!writeResult.ok) {
      const errorMsg = `Failed to write Companies sheet header: ${writeResult.error.message}`;
      logger.error(errorMsg, { error: writeResult.error });
      throw new Error(errorMsg);
    }

    logger.info("Companies sheet header written successfully");
    return;
  }

  // Case 2: Header exists -> Validate it matches contract
  const headerMatches = headersMatch(currentHeader, COMPANY_SHEET_HEADERS);

  if (!headerMatches) {
    // Fail fast with detailed error
    const errorMsg = buildHeaderMismatchError(
      currentHeader,
      COMPANY_SHEET_HEADERS,
    );
    logger.error("Companies sheet header mismatch", {
      expected: COMPANY_SHEET_HEADERS,
      actual: currentHeader,
    });
    throw new Error(errorMsg);
  }

  logger.debug("Companies sheet header validated successfully");
}

/**
 * Check if two header arrays match exactly
 *
 * Compares:
 * - Length (number of columns)
 * - Each cell value (case-sensitive, trimmed)
 *
 * @param actual - Header row from sheet
 * @param expected - Expected header row from contract
 * @returns true if headers match exactly
 */
function headersMatch(actual: unknown[], expected: string[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  for (let i = 0; i < expected.length; i++) {
    const actualValue = String(actual[i] ?? "").trim();
    const expectedValue = expected[i].trim();

    if (actualValue !== expectedValue) {
      return false;
    }
  }

  return true;
}

/**
 * Build detailed error message for header mismatch
 *
 * Provides:
 * - Expected vs actual headers
 * - Column-by-column comparison
 * - Clear next steps for user
 *
 * @param actual - Header row from sheet
 * @param expected - Expected header row from contract
 * @returns Formatted error message
 */
function buildHeaderMismatchError(
  actual: unknown[],
  expected: string[],
): string {
  const lines: string[] = [
    "Companies sheet header does not match contract.",
    "",
    "Expected headers (13 columns A-M):",
    `  ${expected.join(" | ")}`,
    "",
    `Actual headers (${actual.length} columns):`,
    `  ${actual.map((v) => String(v ?? "")).join(" | ")}`,
    "",
  ];

  // Column-by-column diff
  if (actual.length === expected.length) {
    lines.push("Differences:");
    for (let i = 0; i < expected.length; i++) {
      const actualValue = String(actual[i] ?? "").trim();
      const expectedValue = expected[i].trim();
      if (actualValue !== expectedValue) {
        const col = String.fromCharCode(65 + i); // A, B, C...
        lines.push(
          `  Column ${col}: expected "${expectedValue}", got "${actualValue}"`,
        );
      }
    }
  } else {
    lines.push(
      `Column count mismatch: expected ${expected.length}, got ${actual.length}`,
    );
  }

  lines.push("");
  lines.push("Next steps:");
  lines.push("1. Open the Google Sheet in your browser");
  lines.push("2. Manually fix row 1 to match the expected headers above");
  lines.push("3. Ensure column order and spelling are exact");
  lines.push("4. Retry the operation");

  return lines.join("\n");
}
