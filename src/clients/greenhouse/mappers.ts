/**
 * Greenhouse API payload mappers — convert Greenhouse raw responses to normalized types
 *
 * These functions map from Greenhouse-specific API shapes to our provider-agnostic
 * JobOfferSummary and JobOfferDetail types.
 */

import type { JobOfferSummary, JobOfferDetail } from "@/types";
import type { GreenhouseJob } from "@/types/clients/greenhouse";
import { GREENHOUSE_LIMITS } from "@/constants";
import * as logger from "@/logger";

/**
 * Extract department/category from Greenhouse metadata
 *
 * @param job - Greenhouse job with optional metadata
 * @returns Department value if found, undefined otherwise
 */
function extractDepartment(job: GreenhouseJob): string | undefined {
  if (!job.metadata || job.metadata.length === 0) {
    return undefined;
  }

  // Look for department in metadata (case-insensitive)
  const deptField = job.metadata.find(
    (meta) => meta.name.toLowerCase() === "department",
  );

  if (deptField) {
    // Handle both string and string[] values
    const value = Array.isArray(deptField.value)
      ? deptField.value[0]
      : deptField.value;
    return value || undefined;
  }

  return undefined;
}

/**
 * Map Greenhouse job to normalized JobOfferSummary
 *
 * @param job - Greenhouse job from API response
 * @param boardToken - Greenhouse board token (used as company name fallback)
 * @returns Normalized job offer summary
 */
export function mapGreenhouseJobToSummary(
  job: GreenhouseJob,
  boardToken: string,
): JobOfferSummary {
  // Extract department for metadata
  const department = extractDepartment(job);

  return {
    ref: {
      provider: "greenhouse",
      id: String(job.id),
      url: job.absolute_url,
    },
    title: job.title,
    company: {
      name: boardToken, // Greenhouse Job Board API doesn't include company name, use board token
    },
    updatedAt: job.updated_at,
    // Greenhouse doesn't provide publishedAt in Job Board API
    location: job.location?.name
      ? {
          city: job.location.name,
        }
      : undefined,
    metadata: department
      ? {
          category: { value: department },
        }
      : undefined,
  };
}

/**
 * Map Greenhouse job to normalized JobOfferDetail
 *
 * Extends summary with full description content from the `content` field.
 * When fetched with content=true, the job includes HTML description.
 * Applies bounded description length limit to prevent excessive content storage.
 *
 * @param job - Greenhouse job from API response
 * @param boardToken - Greenhouse board token
 * @returns Normalized job offer detail with description
 */
export function mapGreenhouseJobToDetail(
  job: GreenhouseJob,
  boardToken: string,
): JobOfferDetail {
  const summary = mapGreenhouseJobToSummary(job, boardToken);

  // Apply bounded description limit
  let description = job.content;
  if (
    description &&
    description.length > GREENHOUSE_LIMITS.MAX_DESCRIPTION_CHARS
  ) {
    description = description.slice(0, GREENHOUSE_LIMITS.MAX_DESCRIPTION_CHARS);
  }

  return {
    ...summary,
    description,
    // Greenhouse doesn't separate min/desired requirements, all in content
    minRequirements: undefined,
    desiredRequirements: undefined,
  };
}
