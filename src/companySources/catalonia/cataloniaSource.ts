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
import * as logger from "@/logger";

/**
 * Known social/aggregator domains to exclude from company websites
 * These are not actual company websites
 */
const EXCLUDED_DOMAINS = new Set([
  "linkedin.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "github.com",
  "startupshub.catalonia.com",
]);

/**
 * Anchor link candidate extracted from HTML
 */
type AnchorCandidate = {
  href: string;
  text: string;
};

/**
 * Extract all anchor links from HTML using regex
 * Matches: <a href="...">text</a> and <a href='...'>text</a>
 *
 * Note: This is intentionally simple and deterministic.
 * It will miss complex cases (multiline, attributes between href and >, etc.),
 * but that's acceptable for bounded discovery.
 */
function extractAnchors(html: string): AnchorCandidate[] {
  const anchors: AnchorCandidate[] = [];

  // Match <a ...href="..."...>text</a> or <a ...href='...'...>text</a>
  // Non-greedy matching to avoid issues with multiple anchors on one line
  const anchorPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1].trim();
    const text = match[2]
      .replace(/<[^>]+>/g, "") // Strip inner HTML tags
      .trim();

    if (href && text) {
      anchors.push({ href, text });
    }
  }

  return anchors;
}

/**
 * Check if a URL should be excluded based on tunables and heuristics
 */
function shouldExcludeUrl(url: string, baseHostname: string): boolean {
  const { MAX_URL_LENGTH, IGNORE_EXTENSIONS } = DIRECTORY_DISCOVERY.TUNABLES;

  // Check URL length
  if (url.length > MAX_URL_LENGTH) {
    return true;
  }

  // Check file extensions
  const urlLower = url.toLowerCase();
  if (IGNORE_EXTENSIONS.some((ext) => urlLower.endsWith(ext))) {
    return true;
  }

  // Exclude non-http(s) protocols
  if (
    !url.startsWith("http://") &&
    !url.startsWith("https://") &&
    !url.startsWith("/")
  ) {
    return true;
  }

  // Extract domain
  const domain = extractWebsiteDomain(url);
  if (!domain) {
    return true;
  }

  // Exclude internal links (same domain as source)
  if (domain === baseHostname) {
    return true;
  }

  // Exclude known social/aggregator domains
  if (EXCLUDED_DOMAINS.has(domain)) {
    return true;
  }

  return false;
}

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
