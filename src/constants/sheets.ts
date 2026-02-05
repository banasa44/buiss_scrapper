/**
 * Google Sheets schema constants
 *
 * Defines the minimal sheet schema contract for company export/import:
 * - Sheet name and ranges
 * - Column names and positions
 * - Valid enum values
 */

/**
 * Sheet name/tab for company data
 */
export const COMPANY_SHEET_NAME = "Companies";

/**
 * Header row number (1-based)
 */
export const COMPANY_SHEET_HEADER_ROW = 1;

/**
 * First data row number (1-based)
 */
export const COMPANY_SHEET_FIRST_DATA_ROW = 2;

/**
 * Range for reading all company data (A:Z covers up to 26 columns)
 */
export const COMPANY_SHEET_READ_RANGE = `${COMPANY_SHEET_NAME}!A:Z`;

/**
 * Range for header row
 */
export const COMPANY_SHEET_HEADER_RANGE = `${COMPANY_SHEET_NAME}!A${COMPANY_SHEET_HEADER_ROW}:Z${COMPANY_SHEET_HEADER_ROW}`;

// --- Column Names (Minimal Schema) ---

/**
 * Column name for company_id (primary key)
 */
export const COMPANY_SHEET_COL_NAME_COMPANY_ID = "company_id";

/**
 * Column name for resolution (client feedback)
 */
export const COMPANY_SHEET_COL_NAME_RESOLUTION = "resolution";

// --- Column Indices (0-based) ---

/**
 * Column index for company_id (0-based)
 */
export const COMPANY_SHEET_COL_INDEX_COMPANY_ID = 0;

/**
 * Column index for resolution (0-based)
 */
export const COMPANY_SHEET_COL_INDEX_RESOLUTION = 1;

// --- Schema Contract ---

/**
 * Minimal schema: ordered list of column names
 * Defines the expected header row structure
 * Future metric columns will be appended to this array
 */
export const COMPANY_SHEET_SCHEMA = [
  COMPANY_SHEET_COL_NAME_COMPANY_ID,
  COMPANY_SHEET_COL_NAME_RESOLUTION,
] as const;

/**
 * Valid resolution enum values
 */
export const VALID_RESOLUTIONS = [
  "PENDING",
  "ALREADY_REVOLUT",
  "ACCEPTED",
  "REJECTED",
] as const;

/**
 * Default resolution for new company rows
 */
export const DEFAULT_RESOLUTION = "PENDING";

/**
 * Number of decimal places for score formatting in sheet exports
 */
export const SCORE_DECIMAL_PLACES = 1;

/**
 * Placeholder text for companies with missing display name
 */
export const NO_NAME_PLACEHOLDER = "(no name)";
