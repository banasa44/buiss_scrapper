/**
 * JobOffersClient interface — provider-agnostic contract for job offer data sources
 * 
 * All job offer providers (InfoJobs, LinkedIn, etc.) must implement this interface
 * to ensure consistent access patterns across the application.
 */

import type {
  Provider,
  SearchOffersQuery,
  SearchOffersResult,
  JobOfferDetail,
} from "@/types";

/**
 * Provider-agnostic job offers client interface
 */
export interface JobOffersClient {
  /**
   * Provider identifier
   */
  readonly provider: Provider;

  /**
   * Search for job offers matching the given query
   * 
   * @param query - Search query with optional filters, sort, and pagination caps
   * @returns Promise resolving to search results with offers and metadata
   */
  searchOffers(query: SearchOffersQuery): Promise<SearchOffersResult>;

  /**
   * Get full details for a specific job offer by ID
   * 
   * @param id - Provider-specific offer ID
   * @returns Promise resolving to full offer details
   */
  getOfferById(id: string): Promise<JobOfferDetail>;
}
