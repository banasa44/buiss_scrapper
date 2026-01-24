/**
 * Job offer type definitions — provider-agnostic normalized types
 *
 * These types represent job offers from any provider (InfoJobs, LinkedIn, etc.)
 * in a unified format for our internal processing pipeline.
 */

/**
 * Supported job offer providers
 * Use string literal union with intersection to allow future providers without constant edits
 */
export type Provider = "infojobs" | (string & {});

/**
 * Reference to a job offer in an external provider system
 */
export type ProviderRef = {
  provider: Provider;
  id: string;
  url?: string;
};

/**
 * Flexible dictionary item shape for provider-specific categorization data
 * Maps to InfoJobs PD (Program Data) / DictionaryItem structures
 * Other providers may have different shapes - keep this loose
 */
export type PDItem = {
  id?: number | string;
  value?: string;
  key?: string;
};

/**
 * Company information associated with a job offer
 */
export type JobOfferCompany = {
  id?: string;
  name?: string;
  nameRaw?: string;
  normalizedName?: string;
  websiteUrl?: string;
  websiteDomain?: string;
  hidden?: boolean;
};

/**
 * Location information for a job offer
 */
export type JobOfferLocation = {
  city?: string;
  province?: PDItem;
};

/**
 * Salary information for a job offer
 */
export type JobOfferSalary = {
  min?: PDItem;
  max?: PDItem;
  period?: PDItem;
  description?: string;
};

/**
 * Additional metadata about a job offer
 * Contains categorization and requirement details that vary by provider
 */
export type JobOfferMetadata = {
  category?: PDItem;
  subcategory?: PDItem;
  contractType?: PDItem;
  workDay?: PDItem;
  experienceMin?: PDItem;
  salary?: JobOfferSalary;
};

/**
 * Normalized job offer summary
 * Returned from list/search endpoints - contains essential info for filtering
 */
export type JobOfferSummary = {
  ref: ProviderRef;
  title: string;
  company: JobOfferCompany;
  publishedAt?: string;
  updatedAt?: string;
  location?: JobOfferLocation;
  metadata?: JobOfferMetadata;
  requirementsSnippet?: string;
};

/**
 * Normalized job offer detail
 * Returned from detail endpoints - contains full offer description
 */
export type JobOfferDetail = JobOfferSummary & {
  description?: string;
  minRequirements?: string;
  desiredRequirements?: string;
  createdAt?: string;
  applicationsCount?: number;
};

/**
 * Sort direction for search results
 */
export type SortDirection = "asc" | "desc";

/**
 * Fields that can be sorted on (aligned with normalized offer fields)
 */
export type SortField = "publishedAt" | "updatedAt";

/**
 * Sort configuration for search queries
 */
export type SearchSort = {
  field: SortField;
  direction: SortDirection;
};

/**
 * Provider-agnostic search query for job offers
 * Individual providers map these fields to their specific API parameters
 */
export type SearchOffersQuery = {
  /** Free-text search query */
  text?: string;

  /** Filter by update date (ISO 8601 string) */
  updatedSince?: string;

  /** Sort configuration */
  sort?: SearchSort;

  /** Results per page */
  pageSize?: number;

  /** Maximum pages to fetch (cap) */
  maxPages?: number;

  /** Maximum total offers to fetch (cap) */
  maxOffers?: number;
};

/**
 * Reason why pagination was stopped early
 */
export type TruncationReason = "maxPages" | "maxOffers" | "error";

/**
 * Metadata about search results (provider-agnostic)
 */
export type SearchMeta = {
  /** Provider that executed the search */
  provider: Provider;

  /** Number of pages fetched */
  pagesFetched: number;

  /** Number of offers returned */
  offersFetched: number;

  /** Total pages available (if known) */
  totalPages?: number;

  /** Total results available (if known) */
  totalResults?: number;

  /** Reason pagination stopped early (if applicable) */
  truncatedBy?: TruncationReason;
};

/**
 * Search result containing offers and metadata
 */
export type SearchOffersResult = {
  offers: JobOfferSummary[];
  meta: SearchMeta;
};
