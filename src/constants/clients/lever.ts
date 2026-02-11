/**
 * Lever client constants — base URLs, HTTP tunables
 *
 * Configuration for Lever ATS API interactions.
 * Lever API documentation: https://github.com/lever/postings-api
 */

/**
 * Lever API base URL
 */
export const LEVER_API_BASE_URL = "https://api.lever.co/v0";

/**
 * HTTP timeout for Lever API requests (milliseconds)
 * Conservative value for external API calls
 */
export const LEVER_HTTP_TIMEOUT_MS = 15000;

/**
 * Maximum retry attempts for transient Lever API failures
 */
export const LEVER_HTTP_MAX_ATTEMPTS = 2;

/**
 * Default HTTP headers for Lever API requests
 */
export const LEVER_HTTP_HEADERS = {
  Accept: "application/json",
  "User-Agent": "buiss-scraper/1.0",
} as const;
