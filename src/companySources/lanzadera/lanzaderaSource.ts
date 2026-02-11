/**
 * Lanzadera startup directory source (Valencia)
 *
 * Fetches and parses companies from Lanzadera accelerator portfolio
 * (https://lanzadera.es/proyectos/)
 *
 * Parsing approach:
 * - Evidence-based: checks listing for direct external links first (Option A)
 * - Falls back to multi-step pipeline if needed (Option B)
 * - Deterministic regex-based anchor extraction (no JS execution)
 * - Bounded output per directory discovery constants
 */

import { httpRequest } from "@/clients/http";
import type { CompanyDirectorySource } from "@/interfaces";
import type { CompanyInput } from "@/types";
import { DIRECTORY_DISCOVERY } from "@/constants";
import { extractWebsiteDomain } from "@/utils/identity/companyIdentity";
import * as logger from "@/logger";
import {
  hasExternalWebsiteCandidates,
  extractCompaniesFromListing,
  fetchCompaniesViaDetailPages,
} from "../shared";

/**
 * Check if URL is a valid Lanzadera project detail page
 *
 * Rule: Must be same-host, pathname starts with /proyectos/, and has at least
 * one additional path segment (not just /proyectos/ or /proyectos)
 *
 * @param url - Absolute URL to check
 * @param baseHostname - Expected hostname (lanzadera.es)
 * @returns true if this is a project detail page
 */
function isLanzaderaDetailPage(url: string, baseHostname: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = extractWebsiteDomain(url);

    // Must be same-host
    if (hostname !== baseHostname) {
      return false;
    }

    const pathname = parsed.pathname;

    // Must start with /proyectos/
    if (!pathname.startsWith("/proyectos/")) {
      return false;
    }

    // Must have at least 2 path segments: "proyectos" + project identifier
    const segments = pathname.split("/").filter((s) => s.length > 0);
    if (segments.length < 2) {
      return false;
    }

    // Exclude exact match of listing page itself
    if (pathname === "/proyectos/" || pathname === "/proyectos") {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch companies from Lanzadera directory
 *
 * Strategy (evidence-based):
 * 1. Fetch listing page
 * 2. Check for direct external website links (Option A evidence)
 * 3. If found: use single-page extraction (shared helper)
 * 4. Otherwise: use multi-step pipeline with strict detail URL matching (shared helper)
 *
 * @returns Promise resolving to CompanyInput array
 */
export async function fetchLanzaderaCompanies(): Promise<CompanyInput[]> {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA;
  const { MAX_COMPANIES_PER_SOURCE, DETAIL_FETCH } =
    DIRECTORY_DISCOVERY.TUNABLES;

  logger.debug("Fetching Lanzadera companies (evidence-based)", { seedUrl });

  // Fetch listing HTML
  let html: string;
  try {
    html = await httpRequest<string>({
      method: "GET",
      url: seedUrl,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CompanyDiscoveryBot/1.0; +https://buiss-scraper)",
      },
    });
  } catch (error) {
    logger.error("Failed to fetch Lanzadera listing page", {
      seedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  // Check for external website candidates (Option A evidence)
  const hasExternalLinks = hasExternalWebsiteCandidates(html, seedUrl);

  if (hasExternalLinks) {
    // Option A: Direct external links found - use single-page extraction
    logger.debug("Lanzadera: using single-page extraction (Option A)");
    return extractCompaniesFromListing(
      html,
      seedUrl,
      MAX_COMPANIES_PER_SOURCE,
      "Lanzadera",
    );
  } else {
    // Option B: No direct external links - use multi-step detail page pipeline
    logger.debug("Lanzadera: using detail page pipeline (Option B)");
    return fetchCompaniesViaDetailPages({
      sourceId: "LANZADERA",
      seedUrl: seedUrl,
      detailPathPatterns: [], // Not used - custom predicate provided
      isDetailUrl: isLanzaderaDetailPage,
      maxDetailPages: DETAIL_FETCH.MAX_DETAIL_PAGES,
      maxWebsitesPerDetail: DETAIL_FETCH.MAX_WEBSITES_PER_DETAIL,
      maxCompanies: MAX_COMPANIES_PER_SOURCE,
    });
  }
}

/**
 * Lanzadera directory source object
 */
export const lanzaderaDirectorySource: CompanyDirectorySource = {
  id: "LANZADERA",
  seedUrl: DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA,
  fetchCompanies: fetchLanzaderaCompanies,
};
