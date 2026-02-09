/**
 * URL utilities for ATS discovery
 *
 * Pure functions for normalizing and validating URLs
 */

import { CANDIDATE_PATHS, LIMITS } from "@/constants";

/**
 * Normalizes a website URL to a consistent format
 *
 * Accepts various input formats:
 * - example.com
 * - https://example.com/
 * - http://example.com
 *
 * Returns normalized URL with https:// and no trailing slash
 *
 * @param websiteUrl - Raw website URL input
 * @returns Normalized URL or null if invalid
 */
export function normalizeWebsiteUrl(websiteUrl: string): string | null {
  try {
    let url = websiteUrl.trim();

    // Add protocol if missing
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    // Parse and validate
    const parsed = new URL(url);

    // Ensure it's http or https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    // Prefer https
    if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }

    // Remove trailing slash from pathname
    if (parsed.pathname === "/") {
      parsed.pathname = "";
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Generates candidate URLs to check for ATS detection
 *
 * Combines base URL with common career page paths and deduplicates
 * Caps the result at MAX_CANDIDATE_URLS
 *
 * @param baseUrl - Normalized base website URL
 * @returns Array of candidate URLs to fetch
 */
export function generateCandidateUrls(baseUrl: string): string[] {
  const candidates = new Set<string>();

  // Add base URL first
  candidates.add(baseUrl);

  // Add base + each candidate path
  for (const path of CANDIDATE_PATHS) {
    const candidateUrl = baseUrl + path;
    candidates.add(candidateUrl);

    // Stop if we've reached the limit
    if (candidates.size >= LIMITS.MAX_CANDIDATE_URLS) {
      break;
    }
  }

  return Array.from(candidates).slice(0, LIMITS.MAX_CANDIDATE_URLS);
}

/**
 * Checks if a URL belongs to the same domain as the base URL
 *
 * @param url - URL to check
 * @param baseDomain - Base domain hostname
 * @returns True if same domain
 */
export function isSameDomain(url: string, baseDomain: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === baseDomain;
  } catch {
    return false;
  }
}
