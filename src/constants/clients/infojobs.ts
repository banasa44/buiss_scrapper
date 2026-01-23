/**
 * InfoJobs client constants — base URLs, endpoint paths, pagination tunables
 *
 * These values control how we interact with the InfoJobs API:
 * - base URL and endpoint paths
 * - default page size and caps (max pages, max offers)
 * - clamp bounds to avoid over-requesting
 */

/**
 * InfoJobs API base URL
 */
export const INFOJOBS_BASE_URL = "https://api.infojobs.net";

/**
 * InfoJobs list/search offers endpoint path
 */
export const INFOJOBS_LIST_ENDPOINT_PATH = "/api/9/offer";

/**
 * InfoJobs offer detail endpoint path (use with offerId)
 */
export const INFOJOBS_DETAIL_ENDPOINT_PATH = "/api/7/offer";

/**
 * Default page size for list requests
 * InfoJobs recommends <= 50
 */
export const INFOJOBS_DEFAULT_PAGE_SIZE = 50;

/**
 * Maximum page size allowed by InfoJobs API
 * Used to clamp user-provided pageSize values
 */
export const INFOJOBS_MAX_PAGE_SIZE = 50;

/**
 * Default maximum number of pages to fetch per query
 * Prevents runaway pagination if totalPages is very large
 */
export const INFOJOBS_DEFAULT_MAX_PAGES = 10;

/**
 * Default maximum number of offers to fetch per query
 * Additional cap to limit total results regardless of pages
 */
export const INFOJOBS_DEFAULT_MAX_OFFERS = 500;

/**
 * Default country filter for Spain-wide searches
 */
export const INFOJOBS_DEFAULT_COUNTRY = "espana";

/**
 * Default order for search results (InfoJobs format)
 * Options: "updated-desc", "updated-asc", "relevance-desc", etc.
 */
export const INFOJOBS_DEFAULT_ORDER = "updated-desc";
