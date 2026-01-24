/**
 * InfoJobs raw API response types — minimal shapes for mapping
 *
 * These types represent ONLY the fields we actually use from InfoJobs API responses.
 * They are intentionally minimal and focused on what we need for mapping to normalized types.
 *
 * Based on research from docs/M0/01_research_validate_IJ_API.md
 */

/**
 * InfoJobs PD (Program Data) / Dictionary Item
 * Common structure for categorization fields
 */
type InfoJobsPDItem = {
  id?: number | string;
  value?: string;
  key?: string;
};

/**
 * Author/company information from list endpoint
 */
type InfoJobsAuthor = {
  id?: string;
  name?: string;
};

/**
 * Company profile from detail endpoint
 */
type InfoJobsProfile = {
  id?: string;
  name?: string;
  hidden?: boolean;
  web?: string;
  websiteUrl?: string;
  corporateWebsiteUrl?: string;
};

/**
 * Individual offer item from list endpoint (/api/9/offer)
 * Contains only fields we actually map
 */
export type InfoJobsOfferListItem = {
  id: string;
  link?: string;
  title?: string;
  published?: string;
  updated?: string;
  author?: InfoJobsAuthor;
  city?: string;
  province?: InfoJobsPDItem;
  category?: InfoJobsPDItem;
  subcategory?: InfoJobsPDItem;
  contractType?: InfoJobsPDItem;
  workDay?: InfoJobsPDItem;
  experienceMin?: InfoJobsPDItem;
  salaryMin?: InfoJobsPDItem;
  salaryMax?: InfoJobsPDItem;
  salaryPeriod?: InfoJobsPDItem;
  salaryDescription?: string;
  requirementMin?: string;
};

/**
 * List endpoint response (/api/9/offer)
 * Contains pagination metadata + offers array
 */
export type InfoJobsListResponse = {
  totalResults?: number;
  currentResults?: number;
  totalPages?: number;
  currentPage?: number;
  pageSize?: number;
  offers: InfoJobsOfferListItem[];
};

/**
 * Detail endpoint response (/api/7/offer/{offerId})
 * Contains full offer details
 */
export type InfoJobsOfferDetail = {
  id: string;
  link?: string;
  title?: string;
  description?: string;
  minRequirements?: string;
  desiredRequirements?: string;
  creationDate?: string;
  updateDate?: string;
  published?: string;
  applications?: number;
  profile?: InfoJobsProfile;
  city?: string;
  province?: InfoJobsPDItem;
  category?: InfoJobsPDItem;
  subcategory?: InfoJobsPDItem;
  contractType?: InfoJobsPDItem;
  journey?: InfoJobsPDItem; // detail endpoint uses 'journey' instead of 'workDay'
  experienceMin?: InfoJobsPDItem;
  minPay?: InfoJobsPDItem; // detail uses minPay/maxPay instead of salaryMin/salaryMax
  maxPay?: InfoJobsPDItem;
  salaryDescription?: string;
  requirementMin?: string;
};
