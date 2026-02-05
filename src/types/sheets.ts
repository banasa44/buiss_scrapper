/**
 * Sheets type definitions
 *
 * Types for Google Sheets export/import operations
 */

/**
 * Resolution values for company feedback
 * Matches the enum documented in M5 sheet schema
 */
export type CompanyResolution =
  | "PENDING"
  | "ALREADY_REVOLUT"
  | "ACCEPTED"
  | "REJECTED";

/**
 * Minimal company row data read from the sheet
 * Only includes the columns needed for indexing and feedback
 */
export type CompanySheetRow = {
  /** 1-based row index in the sheet (1 = header, 2+ = data rows) */
  rowIndex: number;
  /** Company ID from the DB */
  companyId: number;
  /** Client feedback resolution */
  resolution: CompanyResolution | null;
};

/**
 * Index mapping company IDs to their sheet positions
 */
export type SheetCompanyIndex = Map<number, CompanySheetRow>;

/**
 * Result of reading the company sheet
 */
export type ReadCompanySheetResult = {
  /** Index of companies found in the sheet */
  index: SheetCompanyIndex;
  /** Number of rows successfully parsed */
  validRows: number;
  /** Number of rows skipped due to parse errors */
  skippedRows: number;
};
