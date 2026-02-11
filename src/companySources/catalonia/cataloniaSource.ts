/**
 * Catalonia startup directory source
 *
 * Fetches and parses companies from Startups Hub Catalonia directory
 * (https://startupshub.catalonia.com/list-of-startups)
 *
 * Parsing approach:
 * - Deterministic regex-based anchor extraction (no JS execution)
 * - Conservative external link identification
 * - Bounded output per directory discovery constants
 */

import { httpRequest } from "@/clients/http";
import { DIRECTORY_DISCOVERY } from "@/constants";
import {
  normalizeCompanyName,
  extractWebsiteDomain,
} from "@/utils/identity/companyIdentity";
import type { CompanyInput } from "@/types";
import type { CompanyDirectorySource } from "@/interfaces";
import * as logger from "@/logger";
import { extractAnchors, shouldExcludeUrl } from "../shared";

/**
 * Fetch companies from Catalonia Startups Hub directory
 *
 * Parsing strategy:
 * - Extract all anchors from HTML
 * - Filter to external website links only
 * - Deduplicate by website_domain (first-seen wins)
 * - Limit by MAX_COMPANIES_PER_SOURCE
 *
 * Limitations (accepted for deterministic parsing):
 * - Does not execute JavaScript (static HTML only)
 * - Simple regex parsing (may miss complex/multiline anchors)
 * - No pagination (single seed URL only)
 * - Conservative domain filtering (may exclude valid sites)
 *
 * @returns Promise resolving to CompanyInput array
 */
export async function fetchCataloniaCompanies(): Promise<CompanyInput[]> {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA;
  const { MAX_COMPANIES_PER_SOURCE } = DIRECTORY_DISCOVERY.TUNABLES;

  logger.debug("Fetching Catalonia companies", { seedUrl });

  // Fetch HTML
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
    logger.error("Failed to fetch Catalonia directory", {
      seedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return empty array on network failures (per error handling policy)
    return [];
  }

  // Extract anchors
  const anchors = extractAnchors(html);
  logger.debug("Extracted anchors from HTML", { count: anchors.length });

  // Resolve base hostname for filtering
  const baseHostname = extractWebsiteDomain(seedUrl) ?? "";

  // Process anchors into company candidates
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const companies: CompanyInput[] = [];

  for (const anchor of anchors) {
    // Stop if we've reached the limit
    if (companies.length >= MAX_COMPANIES_PER_SOURCE) {
      break;
    }

    // Resolve to absolute URL
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(anchor.href, seedUrl).toString();
    } catch {
      // Skip malformed URLs
      continue;
    }

    // Apply exclusion filters
    if (shouldExcludeUrl(absoluteUrl, baseHostname)) {
      continue;
    }

    // Extract domain and name
    const websiteDomain = extractWebsiteDomain(absoluteUrl);
    if (!websiteDomain) {
      continue;
    }

    // Deduplicate by domain (first-seen wins)
    if (seenDomains.has(websiteDomain)) {
      continue;
    }

    // Normalize company name
    const nameRaw = anchor.text;
    const normalizedName = normalizeCompanyName(nameRaw);

    // Skip if name is empty after normalization
    if (!normalizedName) {
      continue;
    }

    // Deduplicate by normalized name as fallback
    // (different domains but same normalized name = likely same company)
    if (seenNames.has(normalizedName)) {
      continue;
    }

    // Add to results
    seenDomains.add(websiteDomain);
    seenNames.add(normalizedName);

    companies.push({
      name_raw: nameRaw,
      name_display: nameRaw, // Use raw name as display
      normalized_name: normalizedName,
      website_url: absoluteUrl,
      website_domain: websiteDomain,
    });
  }

  logger.debug("Catalonia companies processed", {
    anchorsFound: anchors.length,
    candidatesReturned: companies.length,
    cappedAt: MAX_COMPANIES_PER_SOURCE,
  });

  return companies;
}

/**
 * Catalonia directory source object
 *
 * Implements CompanyDirectorySource interface to provide a standardized
 * way to interact with the Catalonia startup directory.
 */
export const cataloniaDirectorySource: CompanyDirectorySource = {
  id: "CATALONIA",

  seedUrl: DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA,

  fetchCompanies: fetchCataloniaCompanies,
};
