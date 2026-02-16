/**
 * Companies Sheet Provisioning
 *
 * Ensures the Companies sheet is properly configured:
 * 1. Header row matches expected contract (Spanish labels)
 * 2. Data validation on "Resolución" column (dropdown with allowed values)
 * 3. Data validation on "Feedback Modelo" column (strict enum dropdown)
 *
 * This should be called before any read/write operations on the sheet.
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import { enforceCompanySheetHeader } from "./headerEnforcer";
import {
  COMPANY_SHEET_NAME,
  COMPANY_SHEET_FIRST_DATA_ROW,
  COMPANY_SHEET_VALIDATION_MAX_ROW,
  COMPANY_SHEET_COL_INDEX,
  VALID_RESOLUTIONS,
  MODEL_FEEDBACK_VALUES,
} from "@/constants";
import * as logger from "@/logger";

/**
 * Resolution column index (0-based for Google Sheets API)
 */
const RESOLUTION_COLUMN_INDEX = COMPANY_SHEET_COL_INDEX.resolution;

/**
 * Model feedback column index (0-based for Google Sheets API)
 * Column K
 */
const MODEL_FEEDBACK_COLUMN_INDEX = COMPANY_SHEET_COL_INDEX.model_feedback;

/**
 * Provision Companies sheet with header and data validation
 *
 * Steps:
 * 1. Enforce header contract (calls existing enforceCompanySheetHeader)
 * 2. Apply data validation to "Resolución" column (C)
 * 3. Apply data validation to "Feedback Modelo" column (K)
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

  // Step 3: Apply data validation to Resolution and Model Feedback columns
  const allResolutions = [...VALID_RESOLUTIONS] as string[];

  // Build validation requests for Google Sheets API
  // Per https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/request#SetDataValidationRequest
  const resolutionValidationRequest = {
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

  const modelFeedbackValidationRequest = {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: COMPANY_SHEET_FIRST_DATA_ROW - 1,
        endRowIndex: COMPANY_SHEET_VALIDATION_MAX_ROW,
        startColumnIndex: MODEL_FEEDBACK_COLUMN_INDEX,
        endColumnIndex: MODEL_FEEDBACK_COLUMN_INDEX + 1,
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: MODEL_FEEDBACK_VALUES.map((value) => ({
            userEnteredValue: value,
          })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  };

  logger.debug("Applying data validation to Companies sheet columns", {
    range: `C${COMPANY_SHEET_FIRST_DATA_ROW}:C${COMPANY_SHEET_VALIDATION_MAX_ROW}`,
    validValues: allResolutions,
    modelFeedbackRange: `K${COMPANY_SHEET_FIRST_DATA_ROW}:K${COMPANY_SHEET_VALIDATION_MAX_ROW}`,
    modelFeedbackValues: MODEL_FEEDBACK_VALUES,
  });

  const batchUpdateResult = await client.applySheetBatchUpdate([
    resolutionValidationRequest,
    modelFeedbackValidationRequest,
  ]);

  if (!batchUpdateResult.ok) {
    const errorMsg = `Failed to apply data validation to Companies sheet columns: ${batchUpdateResult.error.message}`;
    logger.error(errorMsg, { error: batchUpdateResult.error });
    throw new Error(errorMsg);
  }

  logger.info("Companies sheet provisioned successfully", {
    resolutionValidationRange: `C${COMPANY_SHEET_FIRST_DATA_ROW}:C${COMPANY_SHEET_VALIDATION_MAX_ROW}`,
    modelFeedbackValidationRange: `K${COMPANY_SHEET_FIRST_DATA_ROW}:K${COMPANY_SHEET_VALIDATION_MAX_ROW}`,
    validResolutions: allResolutions,
    validModelFeedbackValues: MODEL_FEEDBACK_VALUES,
  });
}
