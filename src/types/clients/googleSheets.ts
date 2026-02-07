/**
 * Google Sheets API type definitions
 *
 * These types represent the data shapes used by the Google Sheets client.
 * They are intentionally NOT exported from the global types barrel (@/types)
 * and should only be imported within src/clients/googleSheets/
 */

/**
 * Service account credentials for Google Sheets API authentication
 */
export type GoogleSheetsCredentials = {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
};

/**
 * Google Sheets client configuration
 */
export type GoogleSheetsConfig = {
  /**
   * Service account credentials for authentication
   * If not provided, will attempt to load from environment variables
   */
  credentials?: GoogleSheetsCredentials;

  /**
   * Target spreadsheet ID (required)
   */
  spreadsheetId: string;

  /**
   * Retry configuration for API requests
   */
  retry?: {
    /** Maximum number of retry attempts (default from constants) */
    maxAttempts?: number;
    /** Base delay in ms for exponential backoff (default from constants) */
    baseDelayMs?: number;
    /** Maximum delay in ms between retries (default from constants) */
    maxDelayMs?: number;
  };
};

/**
 * Result type for read operations
 */
export type SheetReadResult = {
  range: string;
  values: unknown[][] | null;
};

/**
 * Result type for write/update operations
 */
export type SheetWriteResult = {
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
};

/**
 * Result type for append operations
 */
export type SheetAppendResult = {
  tableRange: string;
  updates: SheetWriteResult;
};

/**
 * Error details specific to Google Sheets API
 */
export type GoogleSheetsErrorDetails = {
  status?: number;
  message: string;
  code?: string;
  spreadsheetId?: string;
  range?: string;
};

/**
 * OAuth2 token response from Google
 * Used internally for service account authentication
 */
export type GoogleOAuth2TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

/**
 * Success result wrapper
 */
export type SheetOperationSuccess<T> = {
  ok: true;
  data: T;
};

/**
 * Error result wrapper
 */
export type SheetOperationError = {
  ok: false;
  error: GoogleSheetsErrorDetails;
};

/**
 * Result union for operations that may fail
 */
export type SheetOperationResult<T> =
  | SheetOperationSuccess<T>
  | SheetOperationError;

/**
 * Spreadsheet batch update response (for structural changes like validation rules)
 */
export type SpreadsheetBatchUpdateResult = {
  spreadsheetId: string;
  replies: unknown[];
};
