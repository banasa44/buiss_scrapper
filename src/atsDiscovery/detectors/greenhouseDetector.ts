/**
 * Greenhouse ATS detector
 *
 * Pure function for extracting Greenhouse tenant identifiers from HTML content
 */

import type { GreenhouseDetectionResult } from "@/types";
import { GREENHOUSE_PATTERNS, LIMITS } from "@/constants";

/**
 * Detects Greenhouse ATS tenant identifier from HTML content
 *
 * Scans the HTML for known Greenhouse URL patterns and extracts the tenant token.
 * Only scans up to MAX_HTML_CHARS_TO_SCAN to avoid processing huge payloads.
 * Returns the first match found (deterministic).
 *
 * @param html - Raw HTML content to scan
 * @returns Detection result with tenantKey and evidenceUrl, or null if not found
 */
export function detectGreenhouseTenantFromHtml(
  html: string,
): GreenhouseDetectionResult {
  // Limit the amount of HTML we scan to avoid performance issues
  const htmlToScan = html.slice(0, LIMITS.MAX_HTML_CHARS_TO_SCAN);

  // Try each pattern in order
  for (const pattern of GREENHOUSE_PATTERNS) {
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
