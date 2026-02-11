/**
 * URL filtering utilities for company directory discovery
 *
 * Provides deterministic URL filtering based on directory discovery tunables.
 */

import { DIRECTORY_DISCOVERY } from "@/constants";
import { extractWebsiteDomain } from "@/utils/identity/companyIdentity";

/**
 * Check if a URL should be excluded based on tunables and heuristics
 *
 * Filters out:
 * - URLs exceeding MAX_URL_LENGTH
 * - URLs with excluded file extensions
 * - Non-http(s) protocols
 * - Internal links (same domain as source)
 * - Known social/aggregator domains
 *
 * @param url - Absolute URL to check
 * @param baseHostname - Hostname of the source directory (to filter internal links)
 * @returns true if URL should be excluded, false if it's a valid candidate
 */
export function shouldExcludeUrl(url: string, baseHostname: string): boolean {
  const { MAX_URL_LENGTH, IGNORE_EXTENSIONS, EXCLUDED_DOMAINS } =
    DIRECTORY_DISCOVERY.TUNABLES;

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
  if ((EXCLUDED_DOMAINS as readonly string[]).includes(domain)) {
    return true;
  }

  return false;
}
