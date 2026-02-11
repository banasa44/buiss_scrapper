/**
 * Shared pipeline for multi-step directory discovery
 *
 * Some directories (e.g., Madri+d) don't list external company websites directly.
 * Instead, they link to internal detail pages that must be fetched to extract websites.
 *
 * This helper implements a deterministic, bounded two-step pipeline:
 * 1. Fetch listing page → extract internal detail URLs (matching patterns)
 * 2. Fetch detail pages → extract external website links
 * 3. Map to CompanyInput[] with deduplication and capping
 *
 * Pattern separation:
 * - Direct external links → use extractAnchors + shouldExcludeUrl directly (Catalonia pattern)
 * - Internal detail pages → use this pipeline (Madri+d pattern)
 */

import { httpRequest } from "@/clients/http";
import type { CompanyInput } from "@/types";
import {
  normalizeCompanyName,
  extractWebsiteDomain,
} from "@/utils/identity/companyIdentity";
import * as logger from "@/logger";
import { extractAnchors } from "./htmlAnchors";
import { shouldExcludeUrl } from "./urlFilters";

/**
 * Configuration for multi-step directory discovery pipeline
 */
export interface DirectoryPipelineConfig {
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
}

/**
 * Fetch companies via multi-step pipeline: listing → detail pages → websites
 *
 * Pipeline stages:
 * 1. Fetch listing HTML from seedUrl
 * 2. Extract anchors and identify internal detail page URLs (matching patterns)
 * 3. Cap detail pages by maxDetailPages
 * 4. Fetch each detail page and extract external website links
 * 5. Deduplicate by domain, then by normalized name
 * 6. Cap total results by maxCompanies
 *
 * Bounded behavior:
 * - Network requests: 1 (listing) + N (detail pages, capped by maxDetailPages)
 * - Output size: capped by maxCompanies
 * - Per-detail extraction: capped by maxWebsitesPerDetail
 *
 * Error handling:
 * - Listing page fetch failure → return empty array
 * - Individual detail page fetch failure → log warning, skip, continue with others
 *
 * @param config Pipeline configuration
 * @returns Promise resolving to array of CompanyInput (bounded, deduplicated)
 */
export async function fetchCompaniesViaDetailPages(
  config: DirectoryPipelineConfig,
): Promise<CompanyInput[]> {
  const {
    sourceId,
    seedUrl,
    detailPathPatterns,
    isDetailUrl,
    maxDetailPages,
    maxWebsitesPerDetail,
    maxCompanies,
  } = config;

  logger.debug(`[${sourceId}] Fetching companies via detail pages`, {
    seedUrl,
    maxDetailPages,
    maxCompanies,
  });

  // Stage 1: Fetch listing page
  let listingHtml: string;
  try {
    listingHtml = await httpRequest<string>({
      method: "GET",
      url: seedUrl,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CompanyDiscoveryBot/1.0; +https://buiss-scraper)",
      },
    });
  } catch (error) {
    logger.error(`[${sourceId}] Failed to fetch listing page`, {
      seedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  // Stage 2: Extract internal detail page URLs
  const listingAnchors = extractAnchors(listingHtml);
  const baseHostname = extractWebsiteDomain(seedUrl) ?? "";

  const detailPages: Array<{ url: string; name: string }> = [];

  for (const anchor of listingAnchors) {
    if (detailPages.length >= maxDetailPages) {
      break;
    }

    // Resolve to absolute URL
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(anchor.href, seedUrl).toString();
    } catch {
      continue;
    }

    // Determine if this is a detail page using custom predicate or pattern matching
    let isDetail: boolean;

    if (isDetailUrl) {
      // Use custom predicate (takes precedence)
      isDetail = isDetailUrl(absoluteUrl, baseHostname);
    } else {
      // Fallback to pattern matching
      const matchesPattern = detailPathPatterns.some((pattern) =>
        absoluteUrl.includes(pattern),
      );

      // Verify it's same-host (internal detail page)
      const detailHostname = extractWebsiteDomain(absoluteUrl);
      isDetail = matchesPattern && detailHostname === baseHostname;
    }

    if (!isDetail) {
      continue;
    }

    detailPages.push({
      url: absoluteUrl,
      name: anchor.text,
    });
  }

  logger.debug(`[${sourceId}] Extracted detail page URLs`, {
    count: detailPages.length,
  });

  // Stage 3: Fetch detail pages and extract websites
  const companies: CompanyInput[] = [];
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();

  for (const detailPage of detailPages) {
    // Stop if we've reached the company limit
    if (companies.length >= maxCompanies) {
      break;
    }

    // Fetch detail page
    let detailHtml: string;
    try {
      detailHtml = await httpRequest<string>({
        method: "GET",
        url: detailPage.url,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; CompanyDiscoveryBot/1.0; +https://buiss-scraper)",
        },
      });
    } catch (error) {
      logger.warn(`[${sourceId}] Failed to fetch detail page, skipping`, {
        url: detailPage.url,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    // Extract anchors from detail page
    const detailAnchors = extractAnchors(detailHtml);

    // Find external website links (bounded by maxWebsitesPerDetail)
    let websitesExtracted = 0;

    for (const anchor of detailAnchors) {
      if (websitesExtracted >= maxWebsitesPerDetail) {
        break;
      }

      // Resolve to absolute URL
      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(anchor.href, detailPage.url).toString();
      } catch {
        continue;
      }

      // Skip if excluded (internal links, social media, etc.)
      if (shouldExcludeUrl(absoluteUrl, baseHostname)) {
        continue;
      }

      // Extract domain
      const websiteDomain = extractWebsiteDomain(absoluteUrl);
      if (!websiteDomain) {
        continue;
      }

      // Deduplicate by domain
      if (seenDomains.has(websiteDomain)) {
        continue;
      }

      // Use name from listing page (more reliable than detail page anchor text)
      const nameRaw = detailPage.name;
      const normalizedName = normalizeCompanyName(nameRaw);

      if (!normalizedName) {
        continue;
      }

      // Deduplicate by normalized name
      if (seenNames.has(normalizedName)) {
        continue;
      }

      // Add to results
      seenDomains.add(websiteDomain);
      seenNames.add(normalizedName);

      companies.push({
        name_raw: nameRaw,
        name_display: nameRaw,
        normalized_name: normalizedName,
        website_url: absoluteUrl,
        website_domain: websiteDomain,
      });

      websitesExtracted++;
    }
  }

  // Final validation and normalization (defensive)
  // Ensure all entries meet CompanyInput invariants:
  // - At least one identity key: website_domain OR normalized_name
  // - At least one usable display name: name_raw or name_display
  // - website_url is present (always true in this pipeline)
  const validatedCompanies = companies.filter((company) => {
    // Must have at least one identity key (domain OR normalized name)
    const hasDomain = Boolean(company.website_domain);
    const hasName = Boolean(company.normalized_name);

    if (!hasDomain && !hasName) {
      logger.warn(
        `[${sourceId}] Filtered invalid company entry (no identity)`,
        {
          name_raw: company.name_raw,
          website_domain: company.website_domain,
          normalized_name: company.normalized_name,
        },
      );
      return false;
    }

    // Must have at least one usable display name
    if (!company.name_raw && !company.name_display) {
      logger.warn(`[${sourceId}] Filtered invalid company entry (no name)`, {
        website_domain: company.website_domain,
        normalized_name: company.normalized_name,
      });
      return false;
    }

    // Website URL must be present (always populated in this pipeline)
    if (!company.website_url) {
      logger.warn(`[${sourceId}] Filtered invalid company entry (no URL)`, {
        name_raw: company.name_raw,
        website_domain: company.website_domain,
      });
      return false;
    }

    return true;
  });

  // Apply final cap (defensive - should already be capped during collection)
  const finalCompanies = validatedCompanies.slice(0, maxCompanies);

  logger.debug(`[${sourceId}] Companies processed via detail pages`, {
    detailPagesFetched: detailPages.length,
    companiesReturned: finalCompanies.length,
    cappedAt: maxCompanies,
    filtered: companies.length - validatedCompanies.length,
  });

  return finalCompanies;
}
