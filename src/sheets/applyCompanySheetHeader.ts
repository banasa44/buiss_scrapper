/**
 * Company sheet header apply helper
 *
 * Explicitly writes the full header row from contract constants.
 * This is intentionally separate from validation-only enforcement.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import {
  COMPANY_SHEET_NAME,
  COMPANY_SHEET_HEADERS,
  COMPANY_SHEET_COLUMNS,
} from "@/constants";
import * as logger from "@/logger";

/**
 * Apply Companies sheet header contract to A1:L1.
 *
 * Overwrites row 1 for contract columns only, exactly matching
 * COMPANY_SHEET_HEADERS order and labels.
 *
 * @param client - GoogleSheetsClient instance
 * @throws Error if header write fails
 */
export async function applyCompanySheetHeader(
  client: GoogleSheetsClient,
): Promise<void> {
  const lastColumn = String.fromCharCode(65 + COMPANY_SHEET_COLUMNS.length - 1);
  const headerRange = `${COMPANY_SHEET_NAME}!A1:${lastColumn}1`;

  logger.info("Applying Companies sheet header contract", {
    headerRange,
    columnCount: COMPANY_SHEET_COLUMNS.length,
  });

  const writeResult = await client.batchUpdate([COMPANY_SHEET_HEADERS], headerRange);

  if (!writeResult.ok) {
    const errorMsg = `Failed to apply Companies sheet header: ${writeResult.error.message}`;
    logger.error(errorMsg, { error: writeResult.error });
    throw new Error(errorMsg);
  }

  logger.info("Companies sheet header applied successfully", {
    updatedRange: writeResult.data.updatedRange,
    updatedCells: writeResult.data.updatedCells,
  });
}
