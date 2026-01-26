/**
 * InfoJobs API payload mappers — convert InfoJobs raw responses to normalized types
 *
 * These functions map from InfoJobs-specific API shapes to our provider-agnostic
 * JobOfferSummary and JobOfferDetail types.
 */

import type {
  JobOfferSummary,
  JobOfferDetail,
  PDItem,
  JobOfferLocation,
  JobOfferMetadata,
  JobOfferSalary,
  InfoJobsOfferListItem,
  InfoJobsOfferDetail,
} from "@/types";
import {
  normalizeCompanyName,
  pickCompanyWebsiteUrl,
  extractWebsiteDomain,
} from "@/utils";
import { debug } from "@/logger";

/**
 * Map InfoJobs PD (Program Data) / DictionaryItem to normalized PDItem
 * InfoJobs returns objects with id/value or id/key patterns
 */
function mapPDItem(raw: any): PDItem | undefined {
  if (!raw) return undefined;

  return {
    id: raw.id,
    value: raw.value,
    key: raw.key,
  };
}

/**
 * Map InfoJobs salary fields to normalized salary object
 */
function mapSalary(raw: any): JobOfferSalary | undefined {
  if (!raw) return undefined;

  const salary: JobOfferSalary = {};

  if (raw.salaryMin) {
    salary.min = mapPDItem(raw.salaryMin);
  }
  if (raw.salaryMax) {
    salary.max = mapPDItem(raw.salaryMax);
  }
  if (raw.salaryPeriod) {
    salary.period = mapPDItem(raw.salaryPeriod);
  }
  if (raw.salaryDescription) {
    salary.description = raw.salaryDescription;
  }

  // Also handle minPay/maxPay from detail endpoint
  if (raw.minPay) {
    salary.min = mapPDItem(raw.minPay);
  }
  if (raw.maxPay) {
    salary.max = mapPDItem(raw.maxPay);
  }

  return Object.keys(salary).length > 0 ? salary : undefined;
}

/**
 * Map InfoJobs location fields to normalized location
 */
function mapLocation(raw: any): JobOfferLocation | undefined {
  if (!raw) return undefined;

  const location: JobOfferLocation = {};

  if (raw.city) {
    location.city = raw.city;
  }
  if (raw.province) {
    location.province = mapPDItem(raw.province);
  }

  return Object.keys(location).length > 0 ? location : undefined;
}

/**
 * Map InfoJobs offer list item to normalized JobOfferSummary
 *
 * @param raw - One element from /api/9/offer response offers[] array
 * @returns Normalized job offer summary, or null if required fields are missing
 */
export function mapInfoJobsOfferListItemToSummary(
  raw: InfoJobsOfferListItem,
): JobOfferSummary | null {
  // Only id is required - without it we can't identify the offer
  if (!raw.id) {
    return null;
  }

  const metadata: JobOfferMetadata = {
    category: mapPDItem(raw.category),
    subcategory: mapPDItem(raw.subcategory),
    contractType: mapPDItem(raw.contractType),
    workDay: mapPDItem(raw.workDay),
    experienceMin: mapPDItem(raw.experienceMin),
    salary: mapSalary(raw),
  };

  return {
    ref: {
      provider: "infojobs",
      id: raw.id,
      url: raw.link,
    },
    title: raw.title || "",
    company: {
      id: raw.author?.id,
      name: raw.author?.name,
      nameRaw: raw.author?.name,
      normalizedName: raw.author?.name
        ? normalizeCompanyName(raw.author?.name)
        : undefined,
      // List endpoint doesn't provide website fields - leave undefined
    },
    publishedAt: raw.published,
    updatedAt: raw.updated,
    location: mapLocation(raw),
    metadata: Object.values(metadata).some((v) => v !== undefined)
      ? metadata
      : undefined,
    requirementsSnippet: raw.requirementMin,
  };
}

/**
 * Map InfoJobs offer detail to normalized JobOfferDetail
 *
 * @param raw - Full detail payload from /api/7/offer/{offerId}
 * @returns Normalized job offer detail, or null if required fields are missing
 */
export function mapInfoJobsOfferDetailToDetail(
  raw: InfoJobsOfferDetail,
): JobOfferDetail | null {
  // Only id is required - without it we can't identify the offer
  if (!raw.id) {
    return null;
  }

  // Build metadata from detail fields
  const metadata: JobOfferMetadata = {
    category: mapPDItem(raw.category),
    subcategory: mapPDItem(raw.subcategory),
    contractType: mapPDItem(raw.contractType),
    workDay: mapPDItem(raw.journey), // detail endpoint uses 'journey' instead of 'workDay'
    experienceMin: mapPDItem(raw.experienceMin),
    salary: mapSalary(raw),
  };

  // Extract company website URL and domain (detail endpoint only)
  const rawWebsiteUrl = raw.profile
    ? pickCompanyWebsiteUrl({
        corporateWebsiteUrl: raw.profile.corporateWebsiteUrl,
        websiteUrl: raw.profile.websiteUrl,
        web: raw.profile.web,
      })
    : null;

  // Extract domain and filter out InfoJobs internal domains
  let websiteDomain = rawWebsiteUrl
    ? extractWebsiteDomain(rawWebsiteUrl)
    : null;

  // InfoJobs-specific: reject internal InfoJobs domains (not useful for company identity)
  if (websiteDomain && websiteDomain.includes("infojobs.")) {
    debug("InfoJobs mapper: filtering out internal InfoJobs domain", {
      offerId: raw.id,
      domain: websiteDomain,
    });
    websiteDomain = null;
  }

  // Log when website URL is present but domain extraction fails
  if (rawWebsiteUrl && !websiteDomain) {
    debug("InfoJobs mapper: website URL filtered out (malformed or internal)", {
      offerId: raw.id,
      url: rawWebsiteUrl,
    });
  }

  return {
    ref: {
      provider: "infojobs",
      id: raw.id,
      url: raw.link,
    },
    title: raw.title || "",
    company: {
      id: raw.profile?.id,
      name: raw.profile?.name,
      nameRaw: raw.profile?.name,
      normalizedName: raw.profile?.name
        ? normalizeCompanyName(raw.profile.name)
        : undefined,
      websiteUrl: rawWebsiteUrl || undefined,
      websiteDomain: websiteDomain || undefined,
      hidden: raw.profile?.hidden,
    },
    publishedAt: raw.published,
    updatedAt: raw.updateDate,
    createdAt: raw.creationDate,
    location: mapLocation(raw),
    metadata: Object.values(metadata).some((v) => v !== undefined)
      ? metadata
      : undefined,
    requirementsSnippet: raw.requirementMin,
    description: raw.description,
    minRequirements: raw.minRequirements,
    desiredRequirements: raw.desiredRequirements,
    applicationsCount: raw.applications,
  };
}
