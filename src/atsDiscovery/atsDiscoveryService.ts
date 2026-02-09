/**
 * ATS Discovery Service
 *
 * Service for detecting ATS providers (Lever, Greenhouse) from company websites
 * and extracting tenant identifiers for direct API access.
 */

import type { AtsDiscoveryResult } from "@/types";
import { LIMITS, LINK_FOLLOW } from "@/constants";
import * as logger from "@/logger";
import {
  detectLeverTenantFromHtml,
  detectGreenhouseTenantFromHtml,
} from "./detectors";
import { normalizeWebsiteUrl, generateCandidateUrls } from "./urlUtils";
import { extractCandidateCareerLinks } from "./htmlLinkExtractor";
import { fetchHtmlPage, tryDetectAtsFromUrl } from "./fetchAndDetect";

/**
 * Discovers ATS provider and tenant information from a company website URL
 *
 * Process:
 * 1. Normalizes the input URL
 * 2. Generates candidate URLs (base + career page paths)
 * 3. Fetches HTML for each candidate and runs detectors
 * 4. If not found, extracts career-related links from fetched pages (1-hop)
 * 5. Follows and checks those links (up to MAX_LINKS_TO_FOLLOW)
 * 6. Returns immediately on first match
 * 7. Returns NOT_FOUND if no matches after all attempts
 *
 * Errors are logged and skipped to avoid crashing on per-company failures.
 *
 * @param websiteUrl - The company website URL to analyze
 * @returns Discovery result with tenant info if found
 */
export async function discoverAts(
  websiteUrl: string,
): Promise<AtsDiscoveryResult> {
  // Step 1: Normalize URL
  const normalizedUrl = normalizeWebsiteUrl(websiteUrl);
  if (!normalizedUrl) {
    logger.debug("Invalid website URL provided for ATS discovery", {
      websiteUrl,
    });
    return {
      status: "error",
      message: "Invalid or unparseable website URL",
    };
  }

  logger.debug("Starting ATS discovery", {
    originalUrl: websiteUrl,
    normalizedUrl,
  });

  // Step 2: Generate candidate URLs
  const candidateUrls = generateCandidateUrls(normalizedUrl);
  logger.debug("Generated candidate URLs for ATS discovery", {
    count: candidateUrls.length,
  });

  // Track successfully fetched HTML for link extraction
  const fetchedHtmlPages: Array<{ url: string; html: string }> = [];

  // Step 3: Fetch and detect for each candidate
  for (const candidateUrl of candidateUrls) {
    try {
      const page = await fetchHtmlPage(candidateUrl);
      if (!page) {
        continue;
      }

      // Store for later link extraction
      fetchedHtmlPages.push(page);

      // Limit HTML size to scan
      const htmlToScan = page.html.slice(0, LIMITS.MAX_HTML_CHARS_TO_SCAN);

      // Run detectors
      const leverResult = detectLeverTenantFromHtml(htmlToScan);
      if (leverResult) {
        logger.info("Detected Lever ATS tenant", {
          candidateUrl,
          tenantKey: leverResult.tenantKey,
          evidenceUrl: leverResult.evidenceUrl,
        });
        return {
          status: "found",
          tenant: {
            provider: "lever",
            tenantKey: leverResult.tenantKey,
            evidenceUrl: leverResult.evidenceUrl,
          },
        };
      }

      const greenhouseResult = detectGreenhouseTenantFromHtml(htmlToScan);
      if (greenhouseResult) {
        logger.info("Detected Greenhouse ATS tenant", {
          candidateUrl,
          tenantKey: greenhouseResult.tenantKey,
          evidenceUrl: greenhouseResult.evidenceUrl,
        });
        return {
          status: "found",
          tenant: {
            provider: "greenhouse",
            tenantKey: greenhouseResult.tenantKey,
            evidenceUrl: greenhouseResult.evidenceUrl,
          },
        };
      }
    } catch (error) {
      // Log and continue on per-candidate errors
      logger.debug("Failed to fetch or analyze candidate URL", {
        candidateUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Step 4: If not found in primary candidates, extract and follow career links (1-hop)
  const careerLinks = new Set<string>();
  for (const { url, html } of fetchedHtmlPages) {
    const extractedLinks = extractCandidateCareerLinks(html, url);
    extractedLinks.forEach((link) => careerLinks.add(link));

    // Stop if we have enough links
    if (careerLinks.size >= LINK_FOLLOW.MAX_LINKS_TO_FOLLOW) {
      break;
    }
  }

  // Remove already-checked URLs
  const linksToFollow = Array.from(careerLinks).filter(
    (link) => !candidateUrls.includes(link),
  );

  if (linksToFollow.length > 0) {
    logger.debug("Extracted career links for 1-hop follow", {
      count: linksToFollow.length,
    });

    // Step 5: Follow extracted links and check for ATS
    for (const link of linksToFollow.slice(
      0,
      LINK_FOLLOW.MAX_LINKS_TO_FOLLOW,
    )) {
      logger.debug("Following career link", { url: link });

      const result = await tryDetectAtsFromUrl(link);
      if (result) {
        logger.info(`Detected ${result.provider} ATS tenant via link follow`, {
          followedUrl: link,
          tenantKey: result.tenantKey,
          evidenceUrl: result.evidenceUrl,
        });
        return {
          status: "found",
          tenant: {
            provider: result.provider,
            tenantKey: result.tenantKey,
            evidenceUrl: result.evidenceUrl,
          },
        };
      }
    }
  }

  // Step 6: No matches found
  logger.debug("ATS discovery completed with no matches", {
    websiteUrl,
    candidatesChecked: candidateUrls.length,
    linksFollowed: linksToFollow.length,
  });

  return { status: "not_found" };
}
