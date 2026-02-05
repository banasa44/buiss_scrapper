/**
 * Google Sheets parsing utilities
 *
 * Pure functions for parsing and validating sheet cell values.
 * Used by sheetReader to defensively handle external data.
 */

import type { CompanyResolution } from "@/types";
import { VALID_RESOLUTIONS } from "@/constants/sheets";

/**
 * Parse a company_id value from sheet cell
 *
 * Accepts:
 * - Positive integers (as number or string)
 * - Strings with leading/trailing whitespace (containing only digits)
 *
 * Rejects:
 * - Non-integers
 * - Zero or negative numbers
 * - Non-numeric strings (including decimals like "3.14", partial numbers like "12abc")
 * - null/undefined
 *
 * @param value - Raw cell value from sheet
 * @returns Parsed company ID or null if invalid
 */
export function parseCompanyId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Strict validation: must contain only digits
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = parseInt(trimmed, 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Parse a resolution value from sheet cell
 *
 * Accepts:
 * - Valid resolution enum values (case-insensitive)
 * - Strings with leading/trailing whitespace
 *
 * Rejects:
 * - Invalid resolution values
 * - Empty strings
 * - Non-string types
 * - null/undefined
 *
 * Note: Returns null for invalid values (not empty string).
 * This allows distinguishing between "no resolution set" (null)
 * and "invalid resolution value" (also null, logged as error).
 *
 * @param value - Raw cell value from sheet
 * @returns Parsed resolution or null if invalid/empty
 */
export function parseResolution(value: unknown): CompanyResolution | null {
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
