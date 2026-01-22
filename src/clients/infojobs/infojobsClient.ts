/**
 * InfoJobsClient — API client for InfoJobs
 * 
 * Implements the JobOffersClient interface for InfoJobs provider.
 */

import type { JobOffersClient } from "@/interfaces";
import type {
  Provider,
  SearchOffersQuery,
  SearchOffersResult,
  JobOfferDetail,
} from "@/types";

/**
 * InfoJobs implementation of JobOffersClient
 */
export class InfoJobsClient implements JobOffersClient {
  readonly provider: Provider = "infojobs";

  /**
   * Search for job offers matching the given query
   */
  async searchOffers(query: SearchOffersQuery): Promise<SearchOffersResult> {
    // TODO: Implement searchOffers
    throw new Error("Not implemented");
  }

  /**
   * Get full details for a specific job offer by ID
   */
  async getOfferById(id: string): Promise<JobOfferDetail> {
    // TODO: Implement getOfferById
    throw new Error("Not implemented");
  }
}
