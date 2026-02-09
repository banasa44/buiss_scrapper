/**
 * HTML link extraction for ATS discovery
 *
 * Pure function for extracting career-related links from HTML
 */

import {
  DISCOVERY_LINK_KEYWORDS,
  LINK_FOLLOW,
  ATS_ALLOWED_EXTERNAL_HOSTS,
} from "@/constants";

/**
 * Extracts potential career/jobs page links from HTML content
 *
 * Parses HTML for anchor tags, filters for career-related links based on:
 * - URL path contains DISCOVERY_LINK_KEYWORDS
 * - Same domain (unless ALLOW_EXTERNAL_DOMAINS is true)
 * - Not a file download (checks IGNORE_EXTENSIONS)
 * - Not mailto/tel/javascript links
 * - URL length is reasonable (under MAX_URL_LENGTH)
 *
 * @param html - HTML content to parse
 * @param baseUrl - Base URL for resolving relative links
 * @returns Array of absolute URLs to career-related pages (deduplicated, capped)
 */
export function extractCandidateCareerLinks(
  html: string,
  baseUrl: string,
): string[] {
  const links = new Set<string>();
  const baseDomain = new URL(baseUrl).hostname;

  // Simple regex to extract href attributes from anchor tags
  // Matches both single and double quotes: <a href="..." or <a href='...
  const hrefPattern = /<a[^>]+href=["']([^"']+)["']/gi;

  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    const href = match[1];

    // Skip empty hrefs
    if (!href || href.trim() === "") {
      continue;
    }

    // Skip special protocols
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:") ||
      href === "#" ||
      href.startsWith("#")
    ) {
      continue;
    }

    try {
      // Resolve to absolute URL
      const absoluteUrl = new URL(href, baseUrl);

      // Skip if URL is too long (likely tracking/spam)
      if (absoluteUrl.href.length > LINK_FOLLOW.MAX_URL_LENGTH) {
        continue;
      }

      // Check domain restriction
      const isSameDomain = absoluteUrl.hostname === baseDomain;
      const isKnownAtsHost = ATS_ALLOWED_EXTERNAL_HOSTS.includes(
        absoluteUrl.hostname,
      );

      // Allow same-domain links, or known ATS hosts (even if external)
      if (!isSameDomain && !isKnownAtsHost) {
        continue;
      }

      // Skip if ends with ignored extension
      const pathname = absoluteUrl.pathname.toLowerCase();
      const hasIgnoredExtension = LINK_FOLLOW.IGNORE_EXTENSIONS.some((ext) =>
        pathname.endsWith(ext),
      );
      if (hasIgnoredExtension) {
        continue;
      }

      // Check if URL path contains any career-related keyword
      const urlLower = absoluteUrl.href.toLowerCase();
      const hasKeyword = DISCOVERY_LINK_KEYWORDS.some((keyword) =>
        urlLower.includes(keyword),
      );

      if (hasKeyword) {
        links.add(absoluteUrl.href);

        // Stop if we've collected enough links
        if (links.size >= LINK_FOLLOW.MAX_LINKS_TO_FOLLOW) {
          break;
        }
      }
    } catch {
      // Skip malformed URLs
      continue;
    }
  }

  return Array.from(links).slice(0, LINK_FOLLOW.MAX_LINKS_TO_FOLLOW);
}
