/**
 * HTTP fetch and ATS detection logic
 *
 * Handles fetching URLs and running detectors
 */

import type { DetectionResult } from "@/types";
import { httpRequest } from "@/clients/http";
import { HTTP, LIMITS } from "@/constants";
import {
  detectLeverTenantFromHtml,
  detectGreenhouseTenantFromHtml,
} from "./detectors";

/**
 * Attempts to detect ATS tenant from a given URL by fetching and analyzing HTML
 *
 * Fetches the URL, runs both Lever and Greenhouse detectors, returns first match.
 * Returns null on network errors, parse errors, or no detection.
 *
 * @param url - URL to fetch and analyze
 * @returns Detection result or null if not found/error
 */
export async function tryDetectAtsFromUrl(
  url: string,
): Promise<DetectionResult> {
  try {
    const response = await httpRequest<string>({
      method: "GET",
      url,
      headers: HTTP.HEADERS,
      timeoutMs: HTTP.TIMEOUT_MS,
      retry: {
        maxAttempts: HTTP.MAX_ATTEMPTS,
      },
    });

    if (!response || typeof response !== "string") {
      return null;
    }

    const htmlToScan = response.slice(0, LIMITS.MAX_HTML_CHARS_TO_SCAN);

    // Try Lever detection
    const leverResult = detectLeverTenantFromHtml(htmlToScan);
    if (leverResult) {
      return {
        provider: "lever",
        tenantKey: leverResult.tenantKey,
        evidenceUrl: leverResult.evidenceUrl,
      };
    }

    // Try Greenhouse detection
    const greenhouseResult = detectGreenhouseTenantFromHtml(htmlToScan);
    if (greenhouseResult) {
      return {
        provider: "greenhouse",
        tenantKey: greenhouseResult.tenantKey,
        evidenceUrl: greenhouseResult.evidenceUrl,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches HTML from a URL and returns both URL and content for later processing
 *
 * @param url - URL to fetch
 * @returns Object with url and html, or null on error
 */
export async function fetchHtmlPage(
  url: string,
): Promise<{ url: string; html: string } | null> {
  try {
    const response = await httpRequest<string>({
      method: "GET",
      url,
      headers: HTTP.HEADERS,
      timeoutMs: HTTP.TIMEOUT_MS,
      retry: {
        maxAttempts: HTTP.MAX_ATTEMPTS,
      },
    });

    if (!response || typeof response !== "string") {
      return null;
    }

    return { url, html: response };
  } catch {
    return null;
  }
}
