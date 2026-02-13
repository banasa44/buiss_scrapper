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

// --- Column Schema Contract (Single Source of Truth) ---

/**
 * Complete column definition for the Companies sheet
 *
 * This is the SINGLE SOURCE OF TRUTH for the sheet layout.
 * All column indices, headers, and properties are derived from this constant.
 *
 * Schema order (13 columns A-M):
 * Per BUILD-3B1 and AUDIT_04 specifications
 * Columns L-M added for model performance feedback
 * Column K added for top_offer_url (clickable offer link)
 *
 * Headers are in Spanish for commercial-facing sheets.
 * resolution, model_feedback, and model_notes are editable by humans.
 */
export const COMPANY_SHEET_COLUMNS = [
  {
    id: "company_id",
    header: "ID Empresa",
    isEditableByHuman: false,
  },
  {
    id: "company_name",
    header: "Empresa",
    isEditableByHuman: false, // System writes once, never overwrites
  },
  {
    id: "resolution",
    header: "Resolución",
    isEditableByHuman: true, // Client feedback column - only editable field
  },
  {
    id: "max_score",
    header: "Score máx.",
    isEditableByHuman: false,
  },
  {
    id: "strong_offers",
    header: "Ofertas fuertes",
    isEditableByHuman: false,
  },
  {
    id: "unique_offers",
    header: "Ofertas únicas",
    isEditableByHuman: false,
  },
  {
    id: "posting_activity",
    header: "Actividad publicaciones",
    isEditableByHuman: false,
  },
  {
    id: "avg_strong_score",
    header: "Score fuerte medio",
    isEditableByHuman: false,
  },
  {
    id: "top_category",
    header: "Categoría top",
    isEditableByHuman: false,
  },
  {
    id: "last_strong_at",
    header: "Última señal fuerte",
    isEditableByHuman: false,
  },
  {
    id: "top_offer_url",
    header: "URL Oferta Top",
    isEditableByHuman: false,
  },
  {
    id: "model_feedback",
    header: "Feedback Modelo",
    isEditableByHuman: true, // Client feedback for model performance
  },
  {
    id: "model_notes",
    header: "Notas Modelo",
    isEditableByHuman: true, // Free-text notes about model behavior
  },
] as const;

/**
 * Column ID type derived from the contract
 */
export type CompanySheetColumnId = (typeof COMPANY_SHEET_COLUMNS)[number]["id"];

/**
 * Array of column headers for sheet operations
 * Derived from COMPANY_SHEET_COLUMNS
 */
export const COMPANY_SHEET_HEADERS: string[] = COMPANY_SHEET_COLUMNS.map(
  (col) => col.header,
);

/**
 * Map of column IDs to 0-based indices
 * Derived from COMPANY_SHEET_COLUMNS
 */
export const COMPANY_SHEET_COL_INDEX: Record<CompanySheetColumnId, number> =
  COMPANY_SHEET_COLUMNS.reduce(
    (acc, col, index) => {
      acc[col.id] = index;
      return acc;
    },
    {} as Record<CompanySheetColumnId, number>,
  );

/**
 * First metric column index (0-based)
 * Metrics start after: company_id, company_name, resolution
 */
export const COMPANY_SHEET_FIRST_METRIC_COL_INDEX =
  COMPANY_SHEET_COL_INDEX.max_score;

/**
 * Last metric column index (0-based)
 * Corresponds to top_offer_url (column K, index 10)
 */
export const COMPANY_SHEET_LAST_METRIC_COL_INDEX =
  COMPANY_SHEET_COL_INDEX.top_offer_url;

/**
 * Number of metric columns to update (columns 4-11 in 1-based, indices 3-10)
 */
export const COMPANY_SHEET_METRIC_COL_COUNT = 8;

/**
 * Valid resolution enum values
 * Matches M6 lifecycle specification
 */
export const VALID_RESOLUTIONS = [
  "PENDING",
  "IN_PROGRESS",
  "HIGH_INTEREST",
  "ALREADY_REVOLUT",
  "ACCEPTED",
  "REJECTED",
] as const;

/**
 * Default resolution for new company rows
 */
export const DEFAULT_RESOLUTION = "PENDING";

/**
 * Resolved resolution values (trigger lifecycle actions)
 * When a company transitions TO any of these values, offers are deleted
 * Per M6 lifecycle specification
 */
export const RESOLVED_RESOLUTIONS = [
  "ALREADY_REVOLUT",
  "ACCEPTED",
  "REJECTED",
] as const;

/**
 * Active resolution values (no lifecycle actions)
 * Informational only - company remains active
 * Per M6 lifecycle specification
 */
export const ACTIVE_RESOLUTIONS = [
  "PENDING",
  "IN_PROGRESS",
  "HIGH_INTEREST",
] as const;

/**
 * Number of decimal places for score formatting in sheet exports
 */
export const SCORE_DECIMAL_PLACES = 1;

/**
 * Placeholder text for companies with missing display name
 */
export const NO_NAME_PLACEHOLDER = "(no name)";

/**
 * Batch size for appending rows to Google Sheets
 * Balances API efficiency with request size limits
 */
export const SHEETS_APPEND_BATCH_SIZE = 100;

/**
 * Batch size for updating existing rows in Google Sheets
 * Smaller than append to handle individual range updates
 */
export const SHEETS_UPDATE_BATCH_SIZE = 50;

/**
 * Feedback ingestion time window (Spain time)
 * Per M6 decision: feedback processing runs only 03:00-06:00 Europe/Madrid
 */
export const FEEDBACK_WINDOW_START_HOUR = 3; // 03:00
export const FEEDBACK_WINDOW_END_HOUR = 6; // 06:00 (exclusive)
export const FEEDBACK_WINDOW_TIMEZONE = "Europe/Madrid";

/**
 * Maximum row number for data validation rules
 * Applies validation to rows 2..COMPANY_SHEET_VALIDATION_MAX_ROW
 * Higher values allow more companies but increase API request size
 */
export const COMPANY_SHEET_VALIDATION_MAX_ROW = 1000;
