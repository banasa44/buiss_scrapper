/**
 * Catalonia startup directory source
 *
 * Fetches and parses companies from Startups Hub Catalonia directory
 * (https://startupshub.catalonia.com/list-of-startups)
 *
 * Parsing approach:
 * - Parse startup cards from listing HTML
 * - Accept only canonical startup detail URLs: /startup/<location>/<slug>/<id>
 * - Fetch accepted detail pages to extract external company websites
 * - Use card title as company name (avoid share/legal/menu labels)
 */

import { httpRequest } from "@/clients/http";
import { DIRECTORY_DISCOVERY } from "@/constants";
import {
  normalizeCompanyName,
  extractWebsiteDomain,
} from "@/utils/identity/companyIdentity";
import type { CompanyInput } from "@/types";
import type { CompanyDirectorySource } from "@/interfaces";
import * as logger from "@/logger";
import { extractAnchors, shouldExcludeUrl } from "../shared";

const CATALONIA_USER_AGENT =
  "Mozilla/5.0 (compatible; CompanyDiscoveryBot/1.0; +https://buiss-scraper)";
const CATALONIA_STARTUP_HOSTNAME = "startupshub.catalonia.com";
const CATALONIA_STARTUP_ROOT_SEGMENT = "startup";
const CATALONIA_STARTUP_ID_PATTERN = /^\d+$/;
const CATALONIA_REJECTED_EXTERNAL_DOMAINS = new Set([
  "api.whatsapp.com",
  "whatsapp.com",
  "dealroom.co",
  "crunchbase.com",
]);

const STARTUP_CARD_PATTERN =
  /<li\b[^>]*class=["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
const STARTUP_TITLE_PATTERN =
  /<h3\b[^>]*class=["'][^"']*\bsmall_title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i;
const HREF_PATTERN = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;

export type CataloniaStartupEntry = {
  nameRaw: string;
  detailUrl: string;
};

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

/**
 * Check if URL is a canonical Catalonia startup detail page:
 * /startup/<location>/<slug>/<numeric_id>
 */
export function isCataloniaStartupDetailUrl(
  url: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA,
): boolean {
  try {
    const parsed = new URL(url, seedUrl);
    const expectedHostname = new URL(seedUrl).hostname.toLowerCase();

    if (parsed.hostname.toLowerCase() !== expectedHostname) {
      return false;
    }

    const pathSegments = normalizePathname(parsed.pathname)
      .split("/")
      .filter((segment) => segment.length > 0);

    const [
      rootSegment,
      locationSegment,
      slugSegment,
      startupIdSegment,
      ...extraSegments
    ] = pathSegments;

    if (extraSegments.length > 0) {
      return false;
    }

    if (rootSegment !== CATALONIA_STARTUP_ROOT_SEGMENT) {
      return false;
    }

    if (!locationSegment || !slugSegment || !startupIdSegment) {
      return false;
    }

    return CATALONIA_STARTUP_ID_PATTERN.test(startupIdSegment);
  } catch {
    return false;
  }
}

/**
 * Resolve, validate, and canonicalize Catalonia startup detail URLs.
 * Canonical form strips query/fragment and trailing slash.
 */
export function canonicalizeCataloniaStartupDetailUrl(
  href: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA,
): string | null {
  try {
    const parsed = new URL(href, seedUrl);

    if (!isCataloniaStartupDetailUrl(parsed.toString(), seedUrl)) {
      return null;
    }

    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = normalizePathname(parsed.pathname);

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Extract startup entries from listing cards.
 *
 * Uses card title (<h3 class="small_title">) for company name and keeps only
 * canonical startup detail links from the same card.
 */
export function extractCataloniaStartupEntries(
  html: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA,
): CataloniaStartupEntry[] {
  const entries: CataloniaStartupEntry[] = [];
  const seenDetailUrls = new Set<string>();

  STARTUP_CARD_PATTERN.lastIndex = 0;

  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = STARTUP_CARD_PATTERN.exec(html)) !== null) {
    const cardHtml = cardMatch[1];

    const titleMatch = STARTUP_TITLE_PATTERN.exec(cardHtml);
    if (!titleMatch) {
      continue;
    }

    const nameRaw = stripHtmlTags(titleMatch[1]);
    if (!nameRaw) {
      continue;
    }

    HREF_PATTERN.lastIndex = 0;

    let hrefMatch: RegExpExecArray | null;
    while ((hrefMatch = HREF_PATTERN.exec(cardHtml)) !== null) {
      const detailUrl = canonicalizeCataloniaStartupDetailUrl(
        hrefMatch[1],
        seedUrl,
      );

      if (!detailUrl) {
        continue;
      }

      if (seenDetailUrls.has(detailUrl)) {
        continue;
      }

      seenDetailUrls.add(detailUrl);
      entries.push({ nameRaw, detailUrl });
      break;
    }
  }

  return entries;
}

/**
 * Fetch companies from Catalonia Startups Hub directory.
 *
 * Strategy:
 * 1. Parse startup cards from listing
 * 2. Keep only canonical startup detail URLs
 * 3. Fetch each accepted detail page
 * 4. Extract first valid external website link
 * 5. Deduplicate by website domain and normalized name
 */
export async function fetchCataloniaCompanies(): Promise<CompanyInput[]> {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA;
  const { MAX_COMPANIES_PER_SOURCE, DETAIL_FETCH } =
    DIRECTORY_DISCOVERY.TUNABLES;

  logger.debug("Fetching Catalonia companies", { seedUrl });

  let listingHtml: string;
  try {
    listingHtml = await httpRequest<string>({
      method: "GET",
      url: seedUrl,
      headers: {
        "User-Agent": CATALONIA_USER_AGENT,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch Catalonia directory", {
      seedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const startupEntries = extractCataloniaStartupEntries(listingHtml, seedUrl);
  const cappedEntries = startupEntries.slice(0, DETAIL_FETCH.MAX_DETAIL_PAGES);

  logger.debug("Catalonia startup entries extracted from listing", {
    entriesFound: startupEntries.length,
    detailPagesPlanned: cappedEntries.length,
    cappedAt: DETAIL_FETCH.MAX_DETAIL_PAGES,
  });

  const baseHostname = extractWebsiteDomain(seedUrl) ?? CATALONIA_STARTUP_HOSTNAME;
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const companies: CompanyInput[] = [];

  for (const startupEntry of cappedEntries) {
    if (companies.length >= MAX_COMPANIES_PER_SOURCE) {
      break;
    }

    let detailHtml: string;
    try {
      detailHtml = await httpRequest<string>({
        method: "GET",
        url: startupEntry.detailUrl,
        headers: {
          "User-Agent": CATALONIA_USER_AGENT,
        },
      });
    } catch (error) {
      logger.warn("Failed to fetch Catalonia startup detail page, skipping", {
        detailUrl: startupEntry.detailUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const normalizedName = normalizeCompanyName(startupEntry.nameRaw);
    if (!normalizedName || seenNames.has(normalizedName)) {
      continue;
    }

    const detailAnchors = extractAnchors(detailHtml);
    let websitesExtracted = 0;

    for (const anchor of detailAnchors) {
      if (websitesExtracted >= DETAIL_FETCH.MAX_WEBSITES_PER_DETAIL) {
        break;
      }

      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(anchor.href, startupEntry.detailUrl).toString();
      } catch {
        continue;
      }

      if (shouldExcludeUrl(absoluteUrl, baseHostname)) {
        continue;
      }

      const websiteDomain = extractWebsiteDomain(absoluteUrl);
      if (!websiteDomain) {
        continue;
      }

      if (CATALONIA_REJECTED_EXTERNAL_DOMAINS.has(websiteDomain)) {
        continue;
      }

      if (seenDomains.has(websiteDomain)) {
        continue;
      }

      seenDomains.add(websiteDomain);
      seenNames.add(normalizedName);

      companies.push({
        name_raw: startupEntry.nameRaw,
        name_display: startupEntry.nameRaw,
        normalized_name: normalizedName,
        website_url: absoluteUrl,
        website_domain: websiteDomain,
      });

      websitesExtracted++;
    }
  }

  logger.debug("Catalonia companies processed", {
    startupEntriesFound: startupEntries.length,
    companiesReturned: companies.length,
    cappedAt: MAX_COMPANIES_PER_SOURCE,
  });

  return companies;
}

/**
 * Catalonia directory source object
 *
 * Implements CompanyDirectorySource interface to provide a standardized
 * way to interact with the Catalonia startup directory.
 */
export const cataloniaDirectorySource: CompanyDirectorySource = {
  id: "CATALONIA",

  seedUrl: DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA,

  fetchCompanies: fetchCataloniaCompanies,
};
