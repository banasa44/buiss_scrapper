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
