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

/**
 * Retry configuration defaults
 */

/**
 * Default maximum number of attempts (including initial request)
 * Conservative default: 3 attempts total (1 initial + 2 retries)
 */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Base delay in milliseconds for exponential backoff
 * First retry: ~1s, second retry: ~2s (with jitter)
 */
export const DEFAULT_BASE_DELAY_MS = 1_000;

/**
 * Maximum delay in milliseconds between retries
 * Prevents excessive waits on high retry counts
 */
export const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Maximum time in milliseconds to respect Retry-After header
 * Prevents malicious/misconfigured servers from blocking client indefinitely
 */
export const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

/**
 * HTTP methods that are safe to retry (idempotent)
 */
export const RETRYABLE_HTTP_METHODS = ["GET", "HEAD"] as const;

/**
 * HTTP status codes that warrant a retry
 * - 408: Request Timeout
 * - 429: Too Many Requests (rate limit)
 * - 5xx: Server errors (temporary issues)
 */
export const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
