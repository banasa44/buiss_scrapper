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
} from "@/types/clients/job_offers";

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
export function mapInfoJobsOfferListItemToSummary(raw: unknown): JobOfferSummary | null {
  // Type guard: ensure raw is an object
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item = raw as Record<string, any>;

  // Only id is required - without it we can't identify the offer
  if (!item.id) {
    return null;
  }

  const metadata: JobOfferMetadata = {
    category: mapPDItem(item.category),
    subcategory: mapPDItem(item.subcategory),
    contractType: mapPDItem(item.contractType),
    workDay: mapPDItem(item.workDay),
    experienceMin: mapPDItem(item.experienceMin),
    salary: mapSalary(item),
  };

  return {
    ref: {
      provider: "infojobs",
      id: item.id,
      url: item.link,
    },
    title: item.title || "",
    company: {
      id: item.author?.id,
      name: item.author?.name,
    },
    publishedAt: item.published,
    updatedAt: item.updated,
    location: mapLocation(item),
    metadata: Object.values(metadata).some((v) => v !== undefined)
      ? metadata
      : undefined,
    requirementsSnippet: item.requirementMin,
  };
}

/**
 * Map InfoJobs offer detail to normalized JobOfferDetail
 * 
 * @param raw - Full detail payload from /api/7/offer/{offerId}
 * @returns Normalized job offer detail, or null if required fields are missing
 */
export function mapInfoJobsOfferDetailToDetail(raw: unknown): JobOfferDetail | null {
  // Type guard: ensure raw is an object
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item = raw as Record<string, any>;

  // Only id is required - without it we can't identify the offer
  if (!item.id) {
    return null;
  }

  // Build metadata from detail fields
  const metadata: JobOfferMetadata = {
    category: mapPDItem(item.category),
    subcategory: mapPDItem(item.subcategory),
    contractType: mapPDItem(item.contractType),
    workDay: mapPDItem(item.journey), // detail endpoint uses 'journey' instead of 'workDay'
    experienceMin: mapPDItem(item.experienceMin),
    salary: mapSalary(item),
  };

  return {
    ref: {
      provider: "infojobs",
      id: item.id,
      url: item.link,
    },
    title: item.title || "",
    company: {
      id: item.profile?.id,
      name: item.profile?.name,
      hidden: item.profile?.hidden,
    },
    publishedAt: item.published,
    updatedAt: item.updateDate,
    createdAt: item.creationDate,
    location: mapLocation(item),
    metadata: Object.values(metadata).some((v) => v !== undefined)
      ? metadata
      : undefined,
    requirementsSnippet: item.requirementMin,
    description: item.description,
    minRequirements: item.minRequirements,
    desiredRequirements: item.desiredRequirements,
    applicationsCount: item.applications,
  };
}
