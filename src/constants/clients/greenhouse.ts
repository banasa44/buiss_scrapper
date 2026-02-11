/**
 * Greenhouse client constants — base URLs, HTTP tunables
 *
 * Configuration for Greenhouse ATS API interactions.
 * Greenhouse API documentation: https://developers.greenhouse.io/job-board.html
 */

/**
 * Greenhouse Job Board API base URL
 */
export const GREENHOUSE_API_BASE_URL = "https://boards-api.greenhouse.io/v1";

/**
 * HTTP timeout for Greenhouse API requests (milliseconds)
 * Conservative value for external API calls
 */
export const GREENHOUSE_HTTP_TIMEOUT_MS = 15000;

/**
 * Maximum retry attempts for transient Greenhouse API failures
 */
export const GREENHOUSE_HTTP_MAX_ATTEMPTS = 2;

/**
 * Default HTTP headers for Greenhouse API requests
 */
export const GREENHOUSE_HTTP_HEADERS = {
  Accept: "application/json",
  "User-Agent": "buiss-scraper/1.0",
} as const;

/**
 * Greenhouse data limits — bounds for fetching and processing
 *
 * Conservative limits to ensure deterministic, bounded behavior
 */
export const GREENHOUSE_LIMITS = {
  /**
   * Maximum jobs to process per tenant (board)
   * Applied after sorting to ensure deterministic selection
   */
  MAX_JOBS_PER_TENANT: 200,

  /**
   * Maximum description length in characters
   * Applied during hydration to prevent excessive content storage
   */
  MAX_DESCRIPTION_CHARS: 50000,
} as const;
