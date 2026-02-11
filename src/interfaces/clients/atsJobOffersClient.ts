/**
 * AtsJobOffersClient interface — provider-agnostic contract for ATS-based job sources
 *
 * ATS (Applicant Tracking System) providers like Lever and Greenhouse differ from
 * marketplace search providers (InfoJobs, LinkedIn) in their query scope:
 * - Marketplaces: search across all companies with filters
 * - ATS: fetch all offers for a specific company tenant
 *
 * This interface defines the contract for ATS-based sources, reusing canonical
 * output types (SearchOffersResult, JobOfferDetail) for normalized ingestion.
 */

import type {
  Provider,
  SearchOffersResult,
  JobOfferSummary,
  JobOfferDetail,
} from "@/types";

/**
 * Provider-agnostic ATS job offers client interface
 *
 * ATS clients fetch offers scoped to a specific tenant (company) rather than
 * performing marketplace-wide searches.
 */
export interface AtsJobOffersClient {
  /**
   * Provider identifier (e.g., "lever", "greenhouse")
   */
  readonly provider: Provider;

  /**
   * List all active job offers for a specific ATS tenant
   *
   * Returns offers in canonical SearchOffersResult format for consistent
   * ingestion and deduplication across all provider types.
   *
   * Note: The JobOfferSummary items may or may not include full descriptions
   * depending on the provider's API. Use hydrateOfferDetails to guarantee
   * complete JobOfferDetail with descriptions.
   *
   * @param tenantKey - ATS tenant identifier (e.g., Lever company slug, Greenhouse board token)
   * @returns Promise resolving to normalized search results with offers and metadata
   */
  listOffersForTenant(tenantKey: string): Promise<SearchOffersResult>;

  /**
   * Hydrate offer summaries to full details with descriptions
   *
   * Converts JobOfferSummary items (which may lack descriptions) to complete
   * JobOfferDetail items with full description fields populated.
   *
   * Implementation strategies:
   * - NOOP: Return offers as-is if listOffersForTenant already includes full details
   * - Bulk fetch: Make additional API calls to retrieve descriptions in batch
   * - Individual fetch: Fetch each offer's full details separately (requires tenant context)
   *
   * Required (not optional) because:
   * - ATS APIs often require tenant context even for individual offer retrieval
   * - Ingestion pipeline needs guaranteed access to descriptions for scoring/matching
   * - Interface contract ensures all implementations handle this requirement
   *
   * @param params - Hydration parameters
   * @param params.tenantKey - ATS tenant identifier (required for API context)
   * @param params.offers - Array of offer summaries to hydrate
   * @returns Promise resolving to array of full offer details with descriptions
   */
  hydrateOfferDetails(params: {
    tenantKey: string;
    offers: JobOfferSummary[];
  }): Promise<JobOfferDetail[]>;
}
