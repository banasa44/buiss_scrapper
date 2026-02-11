/**
 * Madri+d startup directory source
 *
 * Fetches and parses companies from Madrid Innovation & Development directory
 * (https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/nuevas-empresas-madrid)
 *
 * Parsing approach:
 * - Uses shared multi-step pipeline (listing → detail pages → websites)
 * - Deterministic regex-based anchor extraction (no JS execution)
 * - Conservative external link identification
 * - Bounded output per directory discovery constants
 */

import type { CompanyDirectorySource } from "@/interfaces";
import type { CompanyInput } from "@/types";
import { DIRECTORY_DISCOVERY } from "@/constants";
import { fetchCompaniesViaDetailPages } from "../shared";

/**
 * Fetch companies from Madri+d directory
 *
 * Parsing strategy (multi-step via shared pipeline):
 * 1. Fetch listing page
 * 2. Extract internal company detail page URLs (matching pattern)
 * 3. Fetch detail pages (bounded by MAX_DETAIL_PAGES)
 * 4. Extract external website links from detail pages
 * 5. Deduplicate by website_domain and normalized_name (first-seen wins)
 *
 * Architectural note:
 * Unlike Catalonia (which has direct external links), Madri+d uses internal
 * detail pages that must be fetched to extract company websites. This requires
 * N+1 HTTP requests but maintains bounded behavior via the shared pipeline helper.
 *
 * Limitations (accepted for deterministic parsing):
 * - Does not execute JavaScript (static HTML only)
 * - Simple regex parsing (may miss complex/multiline anchors)
 * - Fetches only first page of listings (no pagination)
 * - Conservative domain filtering (may exclude valid sites)
 * - Network-intensive (N+1 requests for N companies)
 *
 * @returns Promise resolving to CompanyInput array
 */
export async function fetchMadrimasdCompanies(): Promise<CompanyInput[]> {
  const { SEED_URLS, TUNABLES } = DIRECTORY_DISCOVERY;
  const { MAX_COMPANIES_PER_SOURCE, DETAIL_FETCH } = TUNABLES;

  return fetchCompaniesViaDetailPages({
    sourceId: "MADRIMASD",
    seedUrl: SEED_URLS.MADRIMASD,
    detailPathPatterns: [DETAIL_FETCH.DETAIL_PATH_PATTERNS.MADRIMASD],
    maxDetailPages: DETAIL_FETCH.MAX_DETAIL_PAGES,
    maxWebsitesPerDetail: DETAIL_FETCH.MAX_WEBSITES_PER_DETAIL,
    maxCompanies: MAX_COMPANIES_PER_SOURCE,
  });
}

/**
 * Madri+d directory source object
 *
 * Implements CompanyDirectorySource interface for the Madrid Innovation & Development directory.
 */
export const madrimasdDirectorySource: CompanyDirectorySource = {
  id: "MADRIMASD",

  seedUrl: DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD,

  fetchCompanies: fetchMadrimasdCompanies,
};
