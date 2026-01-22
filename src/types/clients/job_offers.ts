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
export interface ProviderRef {
  provider: Provider;
  id: string;
  url?: string;
}

/**
 * Flexible dictionary item shape for provider-specific categorization data
 * Maps to InfoJobs PD (Program Data) / DictionaryItem structures
 * Other providers may have different shapes - keep this loose
 */
export interface PDItem {
  id?: number | string;
  value?: string;
  key?: string;
}

/**
 * Company information associated with a job offer
 */
export interface JobOfferCompany {
  id?: string;
  name?: string;
  hidden?: boolean;
}

/**
 * Location information for a job offer
 */
export interface JobOfferLocation {
  city?: string;
  province?: PDItem;
}

/**
 * Salary information for a job offer
 */
export interface JobOfferSalary {
  min?: PDItem;
  max?: PDItem;
  period?: PDItem;
  description?: string;
}

/**
 * Additional metadata about a job offer
 * Contains categorization and requirement details that vary by provider
 */
export interface JobOfferMetadata {
  category?: PDItem;
  subcategory?: PDItem;
  contractType?: PDItem;
  workDay?: PDItem;
  experienceMin?: PDItem;
  salary?: JobOfferSalary;
}

/**
 * Normalized job offer summary
 * Returned from list/search endpoints - contains essential info for filtering
 */
export interface JobOfferSummary {
  ref: ProviderRef;
  title: string;
  company: JobOfferCompany;
  publishedAt?: string;
  updatedAt?: string;
  location?: JobOfferLocation;
  metadata?: JobOfferMetadata;
  requirementsSnippet?: string;
}

/**
 * Normalized job offer detail
 * Returned from detail endpoints - contains full offer description
 */
export interface JobOfferDetail extends JobOfferSummary {
  description?: string;
  minRequirements?: string;
  desiredRequirements?: string;
  createdAt?: string;
  applicationsCount?: number;
}
