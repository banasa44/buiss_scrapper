/**
 * Lever ATS detector
 *
 * Pure function for extracting Lever tenant identifiers from HTML content
 */

import type { LeverDetectionResult } from "@/types";
import { LEVER_PATTERNS, LIMITS } from "@/constants";

/**
 * Detects Lever ATS tenant identifier from HTML content
 *
 * Scans the HTML for known Lever URL patterns and extracts the tenant slug.
 * Only scans up to MAX_HTML_CHARS_TO_SCAN to avoid processing huge payloads.
 * Returns the first match found (deterministic).
 *
 * @param html - Raw HTML content to scan
 * @returns Detection result with tenantKey and evidenceUrl, or null if not found
 */
export function detectLeverTenantFromHtml(html: string): LeverDetectionResult {
  // Limit the amount of HTML we scan to avoid performance issues
  const htmlToScan = html.slice(0, LIMITS.MAX_HTML_CHARS_TO_SCAN);

  // Try each pattern in order
  for (const pattern of LEVER_PATTERNS) {
    const match = pattern.exec(htmlToScan);
    if (match && match[1]) {
      return {
        tenantKey: match[1],
        evidenceUrl: match[0], // Full matched URL
      };
    }
  }

  return null;
}
