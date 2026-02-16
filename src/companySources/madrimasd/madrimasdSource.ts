/**
 * Madri+d startup directory source
 *
 * Fetches and parses companies from Madrid Innovation & Development directory
 * (https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/nuevas-empresas-madrid)
 *
 * Parsing approach:
 * - Parse company cards from listing HTML
 * - Accept only canonical detail URLs: /emprendedores/emprendedores-casos-exito/<slug>
 * - Fetch accepted detail pages and extract official external websites
 * - Use card title as company name (avoid share/legal/menu labels)
 */

import { httpRequest } from "@/clients/http";
import { DIRECTORY_DISCOVERY } from "@/constants";
import type { CompanyDirectorySource } from "@/interfaces";
import type { CompanyInput } from "@/types";
import {
  normalizeCompanyName,
  extractWebsiteDomain,
} from "@/utils/identity/companyIdentity";
import * as logger from "@/logger";
import { extractAnchors, shouldExcludeUrl } from "../shared";

const MADRIMASD_USER_AGENT =
  "Mozilla/5.0 (compatible; CompanyDiscoveryBot/1.0; +https://buiss-scraper)";
const MADRIMASD_HOSTNAME = "startups.madrimasd.org";
const MADRIMASD_REJECTED_EXTERNAL_DOMAINS = new Set([
  "api.whatsapp.com",
  "wa.me",
  "whatsapp.com",
  "dealroom.co",
  "crunchbase.com",
]);
const MADRIMASD_COMPANY_SLUG_SEGMENT_COUNT = 1;
const MADRIMASD_DETAIL_PATH_PREFIX =
  DIRECTORY_DISCOVERY.TUNABLES.DETAIL_FETCH.DETAIL_PATH_PATTERNS.MADRIMASD;

const MADRIMASD_CARD_PATTERN =
  /<li\b[^>]*class=["'][^"']*\belement-list\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
const MADRIMASD_TITLE_PATTERN = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i;
const HREF_PATTERN = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;

export type MadrimasdCompanyEntry = {
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
 * Check if URL is a canonical Madrimasd company detail page:
 * /emprendedores/emprendedores-casos-exito/<company-slug>
 */
export function isMadrimasdCompanyDetailUrl(
  url: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD,
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
    const prefixSegments = normalizePathname(MADRIMASD_DETAIL_PATH_PREFIX)
      .split("/")
      .filter((segment) => segment.length > 0);

    if (pathSegments.length !== prefixSegments.length + 1) {
      return false;
    }

    for (let index = 0; index < prefixSegments.length; index++) {
      if (pathSegments[index] !== prefixSegments[index]) {
        return false;
      }
    }

    const slugSegments = pathSegments.slice(prefixSegments.length);
    if (slugSegments.length !== MADRIMASD_COMPANY_SLUG_SEGMENT_COUNT) {
      return false;
    }

    return slugSegments[0].trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve, validate, and canonicalize Madrimasd detail URLs.
 * Canonical form strips query/fragment and trailing slash.
 */
export function canonicalizeMadrimasdCompanyDetailUrl(
  href: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD,
): string | null {
  try {
    const parsed = new URL(href, seedUrl);

    if (!isMadrimasdCompanyDetailUrl(parsed.toString(), seedUrl)) {
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
 * Extract Madrimasd company entries from listing cards.
 *
 * Uses card title (<h3>) for company name and keeps only canonical detail URLs
 * found inside the same card.
 */
export function extractMadrimasdCompanyEntries(
  html: string,
  seedUrl: string = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD,
): MadrimasdCompanyEntry[] {
  const entries: MadrimasdCompanyEntry[] = [];
  const seenDetailUrls = new Set<string>();

  MADRIMASD_CARD_PATTERN.lastIndex = 0;

  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = MADRIMASD_CARD_PATTERN.exec(html)) !== null) {
    const cardHtml = cardMatch[1];

    const titleMatch = MADRIMASD_TITLE_PATTERN.exec(cardHtml);
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
      const detailUrl = canonicalizeMadrimasdCompanyDetailUrl(
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
 * Fetch companies from Madri+d directory.
 *
 * Strategy:
 * 1. Parse company cards from listing page
 * 2. Keep only canonical Madrimasd detail URLs
 * 3. Fetch each accepted detail page
 * 4. Extract first valid external website
 * 5. Deduplicate by website domain and normalized name
 */
export async function fetchMadrimasdCompanies(): Promise<CompanyInput[]> {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD;
  const { MAX_COMPANIES_PER_SOURCE, DETAIL_FETCH } =
    DIRECTORY_DISCOVERY.TUNABLES;

  logger.debug("Fetching Madrimasd companies", { seedUrl });

  let listingHtml: string;
  try {
    listingHtml = await httpRequest<string>({
      method: "GET",
      url: seedUrl,
      headers: {
        "User-Agent": MADRIMASD_USER_AGENT,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch Madrimasd listing page", {
      seedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const companyEntries = extractMadrimasdCompanyEntries(listingHtml, seedUrl);
  const cappedEntries = companyEntries.slice(0, DETAIL_FETCH.MAX_DETAIL_PAGES);

  logger.debug("Madrimasd company entries extracted from listing", {
    entriesFound: companyEntries.length,
    detailPagesPlanned: cappedEntries.length,
    cappedAt: DETAIL_FETCH.MAX_DETAIL_PAGES,
  });

  const baseHostname = extractWebsiteDomain(seedUrl) ?? MADRIMASD_HOSTNAME;
  const seenDomains = new Set<string>();
  const seenNames = new Set<string>();
  const companies: CompanyInput[] = [];

  for (const companyEntry of cappedEntries) {
    if (companies.length >= MAX_COMPANIES_PER_SOURCE) {
      break;
    }

    let detailHtml: string;
    try {
      detailHtml = await httpRequest<string>({
        method: "GET",
        url: companyEntry.detailUrl,
        headers: {
          "User-Agent": MADRIMASD_USER_AGENT,
        },
      });
    } catch (error) {
      logger.warn("Failed to fetch Madrimasd detail page, skipping", {
        detailUrl: companyEntry.detailUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const normalizedName = normalizeCompanyName(companyEntry.nameRaw);
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
        absoluteUrl = new URL(anchor.href, companyEntry.detailUrl).toString();
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

      if (MADRIMASD_REJECTED_EXTERNAL_DOMAINS.has(websiteDomain)) {
        continue;
      }

      if (seenDomains.has(websiteDomain)) {
        continue;
      }

      seenDomains.add(websiteDomain);
      seenNames.add(normalizedName);

      companies.push({
        name_raw: companyEntry.nameRaw,
        name_display: companyEntry.nameRaw,
        normalized_name: normalizedName,
        website_url: absoluteUrl,
        website_domain: websiteDomain,
      });

      websitesExtracted++;
    }
  }

  logger.debug("Madrimasd companies processed", {
    companyEntriesFound: companyEntries.length,
    companiesReturned: companies.length,
    cappedAt: MAX_COMPANIES_PER_SOURCE,
  });

  return companies;
}

/**
 * Madri+d directory source object
 */
export const madrimasdDirectorySource: CompanyDirectorySource = {
  id: "MADRIMASD",
  seedUrl: DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD,
  fetchCompanies: fetchMadrimasdCompanies,
};
