/**
 * Google Sheets helper utilities
 *
 * Pure functions for Sheets-specific operations:
 * - A1 notation conversion
 * - Metric slicing from full row arrays
 * - Range string generation
 */

import {
  COMPANY_SHEET_FIRST_METRIC_COL_INDEX,
  COMPANY_SHEET_LAST_METRIC_COL_INDEX,
  COMPANY_SHEET_NAME,
} from "@/constants/sheets";

/**
 * Convert 0-based column index to A1 notation letter
 * Supports columns A-Z (indices 0-25)
 *
 * @param index - 0-based column index (0 = A, 1 = B, etc.)
 * @returns A1 column letter (A-Z)
 * @throws Error if index is out of supported range
 */
export function colIndexToLetter(index: number): string {
  if (index < 0 || index > 25) {
    throw new Error(
      `Column index ${index} out of range. Only A-Z (0-25) supported.`,
    );
  }
  return String.fromCharCode(65 + index); // 65 is 'A'
}

/**
 * Extract metric columns from a full sheet row array
 *
 * Given a full row (10 columns: company_id, company_name, resolution, + 7 metrics),
 * extracts only the metric columns (indices 3-9).
 *
 * This is used during updates to preserve client-controlled columns
 * (company_id, company_name, resolution) while updating only DB-sourced metrics.
 *
 * @param fullRow - Full row array from mapCompanyToSheetRow (10 elements)
 * @returns Array of metric values only (7 elements)
 */
export function extractMetricSlice(
  fullRow: (string | number)[],
): (string | number)[] {
  return fullRow.slice(
    COMPANY_SHEET_FIRST_METRIC_COL_INDEX,
    COMPANY_SHEET_LAST_METRIC_COL_INDEX + 1,
  );
}

/**
 * Generate A1 range notation for updating a single row's metrics
 *
 * Produces range like "Companies!D2:J2" for row 2.
 * Range spans only metric columns (D-J), excluding company_id, name, and resolution.
 *
 * @param rowIndex - 1-based row index in the sheet (2+ for data rows)
 * @returns A1 range string for metric columns
 */
export function buildMetricUpdateRange(rowIndex: number): string {
  const firstMetricCol = colIndexToLetter(COMPANY_SHEET_FIRST_METRIC_COL_INDEX);
  const lastMetricCol = colIndexToLetter(COMPANY_SHEET_LAST_METRIC_COL_INDEX);
  return `${COMPANY_SHEET_NAME}!${firstMetricCol}${rowIndex}:${lastMetricCol}${rowIndex}`;
}
