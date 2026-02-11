/**
 * Company Directory Source Interface
 *
 * Behavioral contract for company discovery sources that fetch from
 * external directories (startup hubs, company registries, etc.)
 */

import type { CompanyInput } from "@/types";

/**
 * Interface for company directory sources
 *
 * Each source must implement this contract to ensure consistent
 * behavior and enable polymorphic usage across different directories.
 */
export interface CompanyDirectorySource {
  /**
   * Unique identifier for this directory source
   */
  id: string;

  /**
   * Seed URL for the directory (base URL to start fetching from)
   */
  seedUrl: string;

  /**
   * Fetch companies from this directory source
   *
   * Returns a bounded list of CompanyInput objects with identity fields
   * populated (website_domain and/or normalized_name).
   *
   * @returns Promise resolving to array of CompanyInput
   */
  fetchCompanies(): Promise<CompanyInput[]>;
}
