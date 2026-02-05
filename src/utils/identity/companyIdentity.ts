/**
 * Company identity utilities — normalization and domain extraction
 *
 * These functions provide deterministic normalization for company identity
 * resolution based on the strategy defined in docs/M1/03_define_company_id.md
 */

import { removeDiacritics } from "@/utils/text/removeDiacritics";

/**
 * Normalize company name for deterministic identity matching
 *
 * Rules (docs/M1/03_define_company_id.md):
 * - trim whitespace
 * - lowercase
 * - collapse repeated whitespace to single spaces
 * - strip accents/diacritics for stability
 * - remove trailing legal suffix noise conservatively (sl, s.l., slu, sa, s.a.)
 *
 * @param raw - Raw company name string
 * @returns Normalized company name string
 */
export function normalizeCompanyName(raw: string): string {
  if (!raw) return "";

  let normalized = raw.trim();

  // Lowercase
  normalized = normalized.toLowerCase();

  // Strip accents/diacritics
  // Uses NFD (canonical decomposition) + removes combining diacritical marks
  normalized = removeDiacritics(normalized);

  // Collapse repeated whitespace to single spaces
  normalized = normalized.replace(/\s+/g, " ");

  // Remove trailing legal suffix noise (conservative list)
  // Match patterns like "sl", "s.l.", "slu", "sa", "s.a." at end of string
  // Preceded by space or comma-space
  normalized = normalized.replace(
    /[,\s]+(s\.?\s?l\.?|s\.?\s?l\.?\s?u\.?|s\.?\s?a\.?)$/i,
    "",
  );

  return normalized.trim();
}

/**
 * Extract and normalize domain from a URL string
 *
 * Returns lowercase hostname with leading "www." stripped.
 * Returns null if:
 * - URL is malformed/unparseable
 * - Hostname is missing or invalid
 *
 * Note: This function is provider-agnostic. Provider-specific domain filtering
 * (e.g., rejecting internal provider domains) should be done in the mapper layer.
 *
 * @param url - Full URL string
 * @returns Normalized domain string or null if not usable
 */
export function extractWebsiteDomain(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  try {
    // Parse URL (throws on malformed URLs)
    const parsed = new URL(url.trim());
    let hostname = parsed.hostname.toLowerCase();

    // Strip leading "www."
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }

    // Basic validation: must have at least one dot and non-empty
    if (!hostname || !hostname.includes(".")) {
      return null;
    }

    return hostname;
  } catch {
    // URL parsing failed - return null (log+skip behavior, no throw)
    return null;
  }
}

/**
 * Pick the best candidate company website URL from available fields
 *
 * Priority order (based on InfoJobs API field semantics):
 * 1. corporateWebsiteUrl (most likely external company website)
 * 2. websiteUrl (may be external or InfoJobs profile)
 * 3. web (fallback, unclear semantics)
 *
 * Note: This function returns the raw URL string if any candidate exists.
 * Use extractWebsiteDomain() afterward to determine if it's a usable external domain.
 *
 * @param fields - Object containing possible website-related fields
 * @returns Best candidate URL string or null if none available
 */
export function pickCompanyWebsiteUrl(fields: {
  corporateWebsiteUrl?: string;
  websiteUrl?: string;
  web?: string;
}): string | null {
  // Priority order: corporateWebsiteUrl -> websiteUrl -> web
  if (fields.corporateWebsiteUrl?.trim()) {
    return fields.corporateWebsiteUrl.trim();
  }

  if (fields.websiteUrl?.trim()) {
    return fields.websiteUrl.trim();
  }

  if (fields.web?.trim()) {
    return fields.web.trim();
  }

  return null;
}
