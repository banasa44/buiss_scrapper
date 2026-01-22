/**
 * HTTP client constants — defaults and configuration
 */

/**
 * Default request timeout in milliseconds (30 seconds)
 */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/**
 * Default headers for JSON requests
 */
export const DEFAULT_JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

/**
 * Maximum length of error body snippet to include in error messages
 */
export const ERROR_BODY_SNIPPET_MAX_LENGTH = 200;
