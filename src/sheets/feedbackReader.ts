/**
 * Feedback Reader — read-only processor for client feedback from Google Sheets
 *
 * Reads only company_id and resolution columns from the sheet.
 * Returns a simple map of company_id -> resolution for downstream processing.
 *
 * SECURITY: This module enforces the nightly feedback window gate.
 * Feedback can ONLY be read during the allowed window (03:00-06:00 Europe/Madrid).
 * Attempts to read outside the window are rejected immediately.
 *
 * Part of M6 – Sheets Feedback Loop & Company Lifecycle
 */

import type { GoogleSheetsClient } from "@/clients/googleSheets";
import type { CompanyFeedbackReadResult, CompanyResolution } from "@/types";
import type { NewCompanyFeedbackEvent } from "@/types";
import { COMPANY_SHEET_READ_RANGE, COMPANY_SHEET_COL_INDEX } from "@/constants";
import { parseCompanyId, parseResolution } from "@/utils";
import { shouldRunFeedbackIngestion } from "./feedbackWindow";
import * as logger from "@/logger";

/**
 * Read company feedback from Google Sheets
 *
 * SECURITY GUARD: This function enforces the nightly feedback window gate.
 * It will refuse to read feedback outside the allowed window, even if the caller
 * forgets to check. This is a defensive measure to prevent accidental daytime reads.
 *
 * Outside the window, returns an empty result (no throw) for safe degradation.
 *
 * Reads only the columns we need:
 * - company_id
 * - resolution (feedback column)
 *
 * Returns a simple map of company_id -> resolution_value.
 *
 * Defensive parsing:
 * - Validates company_id as positive integer
 * - Validates resolution against allowed values
 * - Ignores rows with invalid data
 * - Detects duplicates (keeps first occurrence only)
 * - Never throws for data issues (only for API failures)
 *
 * @param client - GoogleSheetsClient instance
 * @param now - Optional Date for window check (defaults to current time, used for testing)
 * @returns CompanyFeedbackReadResult with map and counters (empty if outside window)
 */
export async function readCompanyFeedbackFromSheet(
  client: GoogleSheetsClient,
  now?: Date,
): Promise<CompanyFeedbackReadResult> {
  // SECURITY GUARD: Enforce feedback window gate
  // This prevents accidental daytime reads even if caller forgets to check
  const windowCheck = shouldRunFeedbackIngestion(now);
  if (!windowCheck.allowed) {
    // Outside window - return empty result without reading Sheets
    logger.info("Feedback read skipped (outside nightly window)", {
      reason: windowCheck.reason,
      currentHour: windowCheck.currentHour,
      timezone: windowCheck.timezone,
    });
    return {
      map: {},
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 0,
    };
  }

  logger.debug("Reading company feedback from sheet", {
    range: COMPANY_SHEET_READ_RANGE,
  });

  const result = await client.readRange(COMPANY_SHEET_READ_RANGE);

  if (!result.ok) {
    logger.error("Failed to read company sheet for feedback", {
      error: result.error,
    });
    throw new Error(`Failed to read company sheet: ${result.error}`);
  }

  const values = result.data.values;
  if (!values || values.length === 0) {
    logger.warn("Company sheet is empty, no feedback to process");
    return {
      map: {},
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      duplicateRows: 0,
    };
  }

  // Skip header row
  const dataRows = values.slice(1);
  const totalRows = dataRows.length;

  const feedbackMap: Record<number, CompanyResolution> = {};
  const seenCompanyIds = new Set<number>();
  let validRows = 0;
  let invalidRows = 0;
  let duplicateRows = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowIndex = i + 2; // 1-based row number in sheet (accounting for header)

    // Skip completely empty rows
    if (!row || row.length === 0 || row.every((cell) => !cell)) {
      continue;
    }

    const companyIdValue = row[COMPANY_SHEET_COL_INDEX.company_id];
    const resolutionValue = row[COMPANY_SHEET_COL_INDEX.resolution];

    // Parse and validate company_id
    const companyId = parseCompanyId(companyIdValue);
    if (companyId === null) {
      logger.warn("Skipping sheet row with invalid company_id", {
        rowIndex,
        companyIdValue,
      });
      invalidRows++;
      continue;
    }

    // Parse and validate resolution
    const resolution = parseResolution(resolutionValue);
    if (resolution === null) {
      logger.warn("Skipping sheet row with invalid resolution", {
        rowIndex,
        companyId,
        resolutionValue,
      });
      invalidRows++;
      continue;
    }

    // Check for duplicate company_id
    if (seenCompanyIds.has(companyId)) {
      logger.warn("Duplicate company_id in sheet, keeping first occurrence", {
        companyId,
        duplicateRow: rowIndex,
      });
      duplicateRows++;
      continue;
    }

    // Valid row - add to map
    feedbackMap[companyId] = resolution;
    seenCompanyIds.add(companyId);
    validRows++;
  }

  logger.info("Company feedback read complete", {
    totalRows,
    validRows,
    invalidRows,
    duplicateRows,
  });

  return {
    map: feedbackMap,
    totalRows,
    validRows,
    invalidRows,
    duplicateRows,
  };
}

/**
 * Result of reading model performance feedback from sheet
 */
export type ModelFeedbackReadResult = {
  /** Array of feedback events ready for persistence */
  events: NewCompanyFeedbackEvent[];
  /** Total number of rows with model feedback data */
  totalRows: number;
  /** Number of rows with valid feedback data */
  validRows: number;
  /** Number of rows with invalid/missing data */
  invalidRows: number;
};

/**
 * Read model performance feedback from Google Sheets
 *
 * SECURITY GUARD: Enforces the nightly feedback window gate (same as resolution feedback).
 * Outside the window, returns an empty result.
 *
 * Reads MODEL_FEEDBACK and MODEL_NOTES columns for companies with feedback.
 * Only processes rows where MODEL_FEEDBACK has a non-empty value.
 *
 * Defensive parsing:
 * - Validates company_id as positive integer
 * - Skips rows with empty/missing MODEL_FEEDBACK value
 * - Allows empty MODEL_NOTES (optional field)
 * - Never throws for data issues (only for API failures)
 *
 * @param client - GoogleSheetsClient instance
 * @param now - Optional Date for window check (defaults to current time, used for testing)
 * @returns ModelFeedbackReadResult with events and counters (empty if outside window)
 */
export async function readModelFeedbackFromSheet(
  client: GoogleSheetsClient,
  now?: Date,
): Promise<ModelFeedbackReadResult> {
  // SECURITY GUARD: Enforce feedback window gate
  const windowCheck = shouldRunFeedbackIngestion(now);
  if (!windowCheck.allowed) {
    logger.info("Model feedback read skipped (outside nightly window)", {
      reason: windowCheck.reason,
      currentHour: windowCheck.currentHour,
      timezone: windowCheck.timezone,
    });
    return {
      events: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
    };
  }

  logger.debug("Reading model feedback from sheet", {
    range: COMPANY_SHEET_READ_RANGE,
  });

  const result = await client.readRange(COMPANY_SHEET_READ_RANGE);

  if (!result.ok) {
    logger.error("Failed to read company sheet for model feedback", {
      error: result.error,
    });
    throw new Error(`Failed to read company sheet: ${result.error}`);
  }

  const values = result.data.values;
  if (!values || values.length === 0) {
    logger.warn("Company sheet is empty, no model feedback to process");
    return {
      events: [],
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
    };
  }

  // Skip header row
  const dataRows = values.slice(1);

  const events: NewCompanyFeedbackEvent[] = [];
  let validRows = 0;
  let invalidRows = 0;
  let totalRowsWithFeedback = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowIndex = i + 2; // 1-based row number in sheet

    // Skip completely empty rows
    if (!row || row.length === 0 || row.every((cell) => !cell)) {
      continue;
    }

    const companyIdValue = row[COMPANY_SHEET_COL_INDEX.company_id];
    const modelFeedbackValue = row[COMPANY_SHEET_COL_INDEX.model_feedback];
    const modelNotesValue = row[COMPANY_SHEET_COL_INDEX.model_notes];

    // Only process rows with MODEL_FEEDBACK value
    if (!modelFeedbackValue || String(modelFeedbackValue).trim() === "") {
      continue;
    }

    totalRowsWithFeedback++;

    // Parse and validate company_id
    const companyId = parseCompanyId(companyIdValue);
    if (companyId === null) {
      logger.warn(
        "Skipping sheet row with invalid company_id in model feedback",
        {
          rowIndex,
          companyIdValue,
        },
      );
      invalidRows++;
      continue;
    }

    // Valid row - create feedback event
    // Normalize notes: use empty string instead of null for stable dedup
    events.push({
      companyId,
      sheetRowIndex: rowIndex,
      feedbackValue: String(modelFeedbackValue).trim(),
      notes:
        modelNotesValue && String(modelNotesValue).trim() !== ""
          ? String(modelNotesValue).trim()
          : "",
    });
    validRows++;
  }

  logger.info("Model feedback read complete", {
    totalRowsWithFeedback,
    validRows,
    invalidRows,
    eventsRead: events.length,
  });

  return {
    events,
    totalRows: totalRowsWithFeedback,
    validRows,
    invalidRows,
  };
}
