/**
 * Companies Sheet Provisioning
 *
 * Ensures the Companies sheet is properly configured:
 * 1. Header row matches expected contract (Spanish labels)
 * 2. Data validation on "Resolución" column (dropdown with allowed values)
 *
 * This should be called before any read/write operations on the sheet.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import { enforceCompanySheetHeader } from "./headerEnforcer";
import {
  COMPANY_SHEET_NAME,
  COMPANY_SHEET_FIRST_DATA_ROW,
  COMPANY_SHEET_VALIDATION_MAX_ROW,
  ACTIVE_RESOLUTIONS,
  RESOLVED_RESOLUTIONS,
} from "@/constants";
import * as logger from "@/logger";

/**
 * Resolution column index (0-based for Google Sheets API)
 * Column C = index 2
 */
const RESOLUTION_COLUMN_INDEX = 2;

/**
 * Provision Companies sheet with header and data validation
 *
 * Steps:
 * 1. Enforce header contract (calls existing enforceCompanySheetHeader)
 * 2. Apply data validation to "Resolución" column
 *    - Range: C2:C{COMPANY_SHEET_VALIDATION_MAX_ROW}
 *    - Rule: ONE_OF_LIST with all valid resolution values
 *    - strict=true (reject invalid entries)
 *    - showCustomUi=true (show dropdown)
 *
 * @param client - GoogleSheetsClient instance
 * @throws Error if provisioning fails
 */
export async function provisionCompaniesSheet(
  client: GoogleSheetsClient,
): Promise<void> {
  logger.debug("Provisioning Companies sheet");

  // Step 1: Enforce header contract
  await enforceCompanySheetHeader(client);

  // Step 2: Get actual sheetId for "Companies" sheet
  const sheetIdResult = await client.getSheetIdByTitle(COMPANY_SHEET_NAME);

  if (!sheetIdResult.ok) {
    const errorMsg = `Failed to find "${COMPANY_SHEET_NAME}" sheet: ${sheetIdResult.error.message}`;
    logger.error(errorMsg, { error: sheetIdResult.error });
    throw new Error(errorMsg);
  }

  const { sheetId } = sheetIdResult.data;

  logger.debug("Found Companies sheet", {
    sheetId,
    sheetTitle: COMPANY_SHEET_NAME,
  });

  // Step 3: Apply data validation to Resolution column
  const allResolutions = [
    ...ACTIVE_RESOLUTIONS,
    ...RESOLVED_RESOLUTIONS,
  ] as string[];

  // Build validation request for Google Sheets API
  // Per https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/request#SetDataValidationRequest
  const validationRequest = {
    setDataValidation: {
      range: {
        sheetId, // Use discovered sheetId
        startRowIndex: COMPANY_SHEET_FIRST_DATA_ROW - 1, // Convert 1-based to 0-based
        endRowIndex: COMPANY_SHEET_VALIDATION_MAX_ROW,
        startColumnIndex: RESOLUTION_COLUMN_INDEX,
        endColumnIndex: RESOLUTION_COLUMN_INDEX + 1, // endColumnIndex is exclusive
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: allResolutions.map((value) => ({ userEnteredValue: value })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  };

  logger.debug("Applying data validation to Resolution column", {
    range: `C${COMPANY_SHEET_FIRST_DATA_ROW}:C${COMPANY_SHEET_VALIDATION_MAX_ROW}`,
    validValues: allResolutions,
  });

  const batchUpdateResult = await client.applySheetBatchUpdate([
    validationRequest,
  ]);

  if (!batchUpdateResult.ok) {
    const errorMsg = `Failed to apply data validation to Resolution column: ${batchUpdateResult.error.message}`;
    logger.error(errorMsg, { error: batchUpdateResult.error });
    throw new Error(errorMsg);
  }

  logger.info("Companies sheet provisioned successfully", {
    validationRange: `C${COMPANY_SHEET_FIRST_DATA_ROW}:C${COMPANY_SHEET_VALIDATION_MAX_ROW}`,
    validResolutions: allResolutions,
  });
}
