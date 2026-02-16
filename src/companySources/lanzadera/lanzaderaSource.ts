/**
 * Lanzadera startup directory source (Valencia)
 *
 * Fetches and parses companies from Lanzadera accelerator portfolio
 * (https://lanzadera.es/proyectos/)
 *
 * Parsing approach:
 * - Parse project cards from listing HTML
 * - Accept only canonical project detail URLs: /proyecto/<slug>
 * - Fetch accepted detail pages and extract official external websites
 * - Use card title as company name (avoid share/legal/menu labels)
 */

import { httpRequest } from "@/clients/http";
import type { CompanyDirectorySource } from "@/interfaces";
import type { CompanyInput } from "@/types";
import { DIRECTORY_DISCOVERY } from "@/constants";
import {
  normalizeCompanyName,
  extractWebsiteDomain,
} from "@/utils/identity/companyIdentity";
import * as logger from "@/logger";
import { extractAnchors, shouldExcludeUrl } from "../shared";

const LANZADERA_USER_AGENT =
  "Mozilla/5.0 (compatible; CompanyDiscoveryBot/1.0; +https://buiss-scraper)";
const LANZADERA_HOSTNAME = "lanzadera.es";
const LANZADERA_PROJECT_ROOT_SEGMENT = "proyecto";
const LANZADERA_PROJECT_SLUG_SEGMENT_COUNT = 1;
const LANZADERA_REJECTED_EXTERNAL_DOMAINS = new Set([
  "api.whatsapp.com",
  "wa.me",
  "whatsapp.com",
  "dealroom.co",
  "crunchbase.com",
]);

const LANZADERA_CARD_PATTERN =
  /<article\b[^>]*class=["'][^"']*\bstartup-slide\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
const LANZADERA_TITLE_PATTERN =
  /<h3\b[^>]*class=["'][^"']*\bstartup-slide__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i;
const LANZADERA_GENERIC_H3_PATTERN = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i;
const HREF_PATTERN = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;

export type LanzaderaProjectEntry = {
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

function extractLanzaderaCardTitle(cardHtml: string): string | null {
  const titleMatch =
    LANZADERA_TITLE_PATTERN.exec(cardHtml) ??
    LANZADERA_GENERIC_H3_PATTERN.exec(cardHtml);

  if (!titleMatch) {
    return null;
  }

  const title = stripHtmlTags(titleMatch[1]);
  return title || null;
}

/**
 * Check if URL is a canonical Lanzadera project detail page:
 * /proyecto/<slug>
 */
export function isLanzaderaProjectDetailUrl(
  url: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA,
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

    const [rootSegment, ...slugSegments] = pathSegments;

    if (rootSegment !== LANZADERA_PROJECT_ROOT_SEGMENT) {
      return false;
    }

    if (slugSegments.length !== LANZADERA_PROJECT_SLUG_SEGMENT_COUNT) {
      return false;
    }

    return slugSegments[0].trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve, validate, and canonicalize Lanzadera detail URLs.
 * Canonical form strips query/fragment and trailing slash.
 */
export function canonicalizeLanzaderaProjectDetailUrl(
  href: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA,
): string | null {
  try {
    const parsed = new URL(href, seedUrl);

    if (!isLanzaderaProjectDetailUrl(parsed.toString(), seedUrl)) {
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
 * Extract Lanzadera project entries from listing cards.
 *
 * Uses project card title (<h3>) for company name and keeps only canonical
 * detail URLs found inside the same card.
 */
export function extractLanzaderaProjectEntries(
  html: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA,
): LanzaderaProjectEntry[] {
  const entries: LanzaderaProjectEntry[] = [];
  const seenDetailUrls = new Set<string>();

  LANZADERA_CARD_PATTERN.lastIndex = 0;

  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = LANZADERA_CARD_PATTERN.exec(html)) !== null) {
    const cardHtml = cardMatch[1];

    const nameRaw = extractLanzaderaCardTitle(cardHtml);
    if (!nameRaw) {
      continue;
    }

    HREF_PATTERN.lastIndex = 0;

    let hrefMatch: RegExpExecArray | null;
    while ((hrefMatch = HREF_PATTERN.exec(cardHtml)) !== null) {
      const detailUrl = canonicalizeLanzaderaProjectDetailUrl(
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
 * Fetch companies from Lanzadera directory.
 *
 * Strategy:
 * 1. Parse project cards from listing page
 * 2. Keep only canonical Lanzadera detail URLs
 * 3. Fetch each accepted detail page
 * 4. Extract first valid external website
 * 5. Deduplicate by website domain and normalized name
 */
export async function fetchLanzaderaCompanies(): Promise<CompanyInput[]> {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA;
  const { MAX_COMPANIES_PER_SOURCE, DETAIL_FETCH } =
    DIRECTORY_DISCOVERY.TUNABLES;

  logger.debug("Fetching Lanzadera companies", { seedUrl });

  let listingHtml: string;
  try {
    listingHtml = await httpRequest<string>({
      method: "GET",
      url: seedUrl,
      headers: {
        "User-Agent": LANZADERA_USER_AGENT,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch Lanzadera listing page", {
      seedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const projectEntries = extractLanzaderaProjectEntries(listingHtml, seedUrl);
  const cappedEntries = projectEntries.slice(0, DETAIL_FETCH.MAX_DETAIL_PAGES);

  logger.debug("Lanzadera project entries extracted from listing", {
    entriesFound: projectEntries.length,
    detailPagesPlanned: cappedEntries.length,
    cappedAt: DETAIL_FETCH.MAX_DETAIL_PAGES,
  });

  const baseHostname = extractWebsiteDomain(seedUrl) ?? LANZADERA_HOSTNAME;
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const companies: CompanyInput[] = [];

  for (const projectEntry of cappedEntries) {
    if (companies.length >= MAX_COMPANIES_PER_SOURCE) {
      break;
    }

    let detailHtml: string;
    try {
      detailHtml = await httpRequest<string>({
        method: "GET",
        url: projectEntry.detailUrl,
        headers: {
          "User-Agent": LANZADERA_USER_AGENT,
        },
      });
    } catch (error) {
      logger.warn("Failed to fetch Lanzadera detail page, skipping", {
        detailUrl: projectEntry.detailUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const normalizedName = normalizeCompanyName(projectEntry.nameRaw);
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
        absoluteUrl = new URL(anchor.href, projectEntry.detailUrl).toString();
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

      if (LANZADERA_REJECTED_EXTERNAL_DOMAINS.has(websiteDomain)) {
        continue;
      }

      if (seenDomains.has(websiteDomain)) {
        continue;
      }

      seenDomains.add(websiteDomain);
      seenNames.add(normalizedName);

      companies.push({
        name_raw: projectEntry.nameRaw,
        name_display: projectEntry.nameRaw,
        normalized_name: normalizedName,
        website_url: absoluteUrl,
        website_domain: websiteDomain,
      });

      websitesExtracted++;
    }
  }

  logger.debug("Lanzadera companies processed", {
    projectEntriesFound: projectEntries.length,
    companiesReturned: companies.length,
    cappedAt: MAX_COMPANIES_PER_SOURCE,
  });

  return companies;
}

/**
 * Lanzadera directory source object
 */
export const lanzaderaDirectorySource: CompanyDirectorySource = {
  id: "LANZADERA",
  seedUrl: DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA,
  fetchCompanies: fetchLanzaderaCompanies,
};
