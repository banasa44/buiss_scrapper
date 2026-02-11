/**
 * Shared utilities for extracting companies from directory listing pages
 *
 * This module provides reusable functions for the single-page extraction pattern
 * (Option A) used by sources like Catalonia and optionally Lanzadera.
 */

import type { CompanyInput } from "@/types";
import {
  normalizeCompanyName,
  extractWebsiteDomain,
} from "@/utils/identity/companyIdentity";
import * as logger from "@/logger";
import { extractAnchors } from "./htmlAnchors";
import { shouldExcludeUrl } from "./urlFilters";

/**
 * Check if listing HTML contains at least one valid external website candidate
 *
 * This is used to decide between Option A (direct extraction) and Option B
 * (detail page pipeline) in evidence-based sources.
 *
 * @param html - Listing page HTML content
 * @param seedUrl - Base URL for resolving relative links
 * @returns true if at least one valid external website link exists
 */
export function hasExternalWebsiteCandidates(
  html: string,
  seedUrl: string,
): boolean {
  const anchors = extractAnchors(html);
  const baseHostname = extractWebsiteDomain(seedUrl) ?? "";

  for (const anchor of anchors) {
    // Resolve to absolute URL
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(anchor.href, seedUrl).toString();
    } catch {
      continue;
    }

    // Check if this is an external website link
    if (shouldExcludeUrl(absoluteUrl, baseHostname)) {
      continue;
    }

    const websiteDomain = extractWebsiteDomain(absoluteUrl);
    if (websiteDomain) {
      // Found at least one valid external candidate
      return true;
    }
  }

  return false;
}

/**
 * Extract companies from a directory listing page with direct external links
 *
 * This implements the single-page extraction pattern (Option A) used by:
 * - Catalonia (always)
 * - Lanzadera (when evidence shows direct links exist)
 *
 * Algorithm:
 * - Extract all anchors from HTML
 * - Filter to external website links only (using shouldExcludeUrl)
 * - Deduplicate by website_domain first, then by normalized_name
 * - Map to CompanyInput with all required fields
 * - Cap total results by maxCompanies
 *
 * @param html - Listing page HTML content
 * @param seedUrl - Base URL for resolving relative links
 * @param maxCompanies - Maximum number of companies to return
 * @param sourceId - Source identifier for logging (optional)
 * @returns Array of CompanyInput (bounded, deduplicated)
 */
export function extractCompaniesFromListing(
  html: string,
  seedUrl: string,
  maxCompanies: number,
  sourceId?: string,
): CompanyInput[] {
  const anchors = extractAnchors(html);
  const baseHostname = extractWebsiteDomain(seedUrl) ?? "";
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const companies: CompanyInput[] = [];

  for (const anchor of anchors) {
    if (companies.length >= maxCompanies) {
      break;
    }

    // Resolve to absolute URL
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(anchor.href, seedUrl).toString();
    } catch {
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

    // Deduplicate by domain
    if (seenDomains.has(websiteDomain)) {
      continue;
    }

    // Normalize company name
    const nameRaw = anchor.text;
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
  }

  if (sourceId) {
    logger.debug(`${sourceId} companies extracted from listing`, {
      companiesReturned: companies.length,
      cappedAt: maxCompanies,
    });
  }

  return companies;
}
