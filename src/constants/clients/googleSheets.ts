/**
 * Google Sheets API client constants
 *
 * Base URLs, endpoints, and default retry/timeout tunables
 */

/**
 * Google Sheets API base URL
 */
export const GOOGLE_SHEETS_BASE_URL = "https://sheets.googleapis.com";

/**
 * Google Sheets API version path
 */
export const GOOGLE_SHEETS_API_VERSION = "/v4";

/**
 * Google OAuth2 token URL for service account authentication
 */
export const GOOGLE_OAUTH2_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Google Sheets API scopes required for read/write operations
 */
export const GOOGLE_SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
];

/**
 * Default maximum number of retry attempts for failed requests
 * Includes the initial request
 */
export const GOOGLE_SHEETS_DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Default base delay in milliseconds for exponential backoff
 */
export const GOOGLE_SHEETS_DEFAULT_BASE_DELAY_MS = 1000;

/**
 * Default maximum delay in milliseconds between retry attempts
 * Prevents exponential backoff from growing unbounded
 */
export const GOOGLE_SHEETS_DEFAULT_MAX_DELAY_MS = 10000;

/**
 * Default timeout in milliseconds for API requests
 */
export const GOOGLE_SHEETS_DEFAULT_TIMEOUT_MS = 30000;

/**
 * Environment variable name for target spreadsheet ID
 * If not set, Sheets sync will be skipped during ingestion runs
 */
export const GOOGLE_SHEETS_SPREADSHEET_ID_ENV = "GOOGLE_SHEETS_SPREADSHEET_ID";

/**
 * JWT expiration time in seconds (1 hour)
 * Google's OAuth2 JWT tokens are valid for 1 hour
 */
export const GOOGLE_SHEETS_JWT_EXPIRATION_SECONDS = 3600;

/**
 * Value input option for raw (unformatted) data
 */
export const GOOGLE_SHEETS_VALUE_INPUT_OPTION_RAW = "RAW";

/**
 * Value input option for user-entered data (formatted)
 */
export const GOOGLE_SHEETS_VALUE_INPUT_OPTION_USER_ENTERED = "USER_ENTERED";

/**
 * Insert data option: overwrite existing rows
 */
export const GOOGLE_SHEETS_INSERT_DATA_OPTION_OVERWRITE = "OVERWRITE";

/**
 * Insert data option: insert new rows
 */
export const GOOGLE_SHEETS_INSERT_DATA_OPTION_INSERT_ROWS = "INSERT_ROWS";

/**
 * Token expiry buffer in seconds
 * Refresh token this many seconds before actual expiry to avoid edge cases
 */
export const GOOGLE_SHEETS_TOKEN_EXPIRY_BUFFER_SECONDS = 60;

/**
 * Milliseconds per second
 */
export const GOOGLE_SHEETS_MS_PER_SECOND = 1000;

/**
 * HTTP status code for rate limiting
 */
export const GOOGLE_SHEETS_HTTP_STATUS_RATE_LIMIT = 429;

/**
 * HTTP status code for request timeout
 */
export const GOOGLE_SHEETS_HTTP_STATUS_REQUEST_TIMEOUT = 408;

/**
 * HTTP status code threshold for server errors (5xx)
 */
export const GOOGLE_SHEETS_HTTP_STATUS_SERVER_ERROR_MIN = 500;
