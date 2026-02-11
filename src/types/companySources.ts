/**
 * Company Sources type definitions
 *
 * Types for company discovery from external directories
 * (startup hubs, company registries, etc.)
 */

/**
 * Result of company source ingestion
 *
 * Tracks counters for fetching and persisting companies from external directories
 */
export type CompanySourceIngestionResult = {
  /** Number of companies fetched from the directory */
  fetched: number;
  /** Number of companies attempted to persist (after initial filtering) */
  attempted: number;
  /** Number of companies successfully upserted */
  upserted: number;
  /** Number of companies skipped (invalid identity) */
  skipped: number;
  /** Number of companies that failed to persist (errors) */
  failed: number;
};

/**
 * Configuration for multi-step directory discovery pipeline
 */
export type DirectoryPipelineConfig = {
  /**
   * Source identifier for logging (e.g., "MADRIMASD")
   */
  sourceId: string;

  /**
   * Seed URL for the listing page
   */
  seedUrl: string;

  /**
   * URL path patterns that identify company detail pages
   * Only internal URLs matching any of these patterns will be fetched
   * Example: ["/emprendedores/empresa/detalle/"] for Madri+d
   *
   * Ignored if isDetailUrl is provided (custom predicate takes precedence)
   */
  detailPathPatterns: string[];

  /**
   * Optional custom predicate to determine if a URL is a detail page
   * If provided, this overrides detailPathPatterns matching
   *
   * @param url - Absolute URL to check
   * @param baseHostname - Base hostname for same-host verification
   * @returns true if URL should be treated as a detail page
   */
  isDetailUrl?: (url: string, baseHostname: string) => boolean;

  /**
   * Maximum number of detail pages to fetch
   */
  maxDetailPages: number;

  /**
   * Maximum number of external websites to extract per detail page
   */
  maxWebsitesPerDetail: number;

  /**
   * Maximum total companies to return
   */
  maxCompanies: number;
};
