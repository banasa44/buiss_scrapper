/**
 * Lever API payload mappers — convert Lever raw responses to normalized types
 *
 * These functions map from Lever-specific API shapes to our provider-agnostic
 * JobOfferSummary and JobOfferDetail types.
 */

import type { JobOfferSummary, JobOfferDetail } from "@/types";
import type { LeverPosting } from "@/types/clients/lever";
import * as logger from "@/logger";

/**
 * Build full description from Lever posting content fields
 *
 * Lever includes multiple description-like fields:
 * - description: HTML description
 * - descriptionPlain: Plain text version
 * - lists: Additional content sections (requirements, benefits, etc.)
 * - additional: Extra content
 *
 * We prefer plain text for consistency and combine all available content.
 *
 * @param posting - Lever posting with content fields
 * @returns Combined description text, or undefined if no content available
 */
function buildDescription(posting: LeverPosting): string | undefined {
  const parts: string[] = [];

  // Prefer plain text description if available
  if (posting.descriptionPlain) {
    parts.push(posting.descriptionPlain);
  } else if (posting.description) {
    parts.push(posting.description);
  }

  // Add list sections (requirements, benefits, etc.)
  if (posting.lists && posting.lists.length > 0) {
    posting.lists.forEach((list) => {
      if (list.text && list.content) {
        parts.push(`${list.text}:\n${list.content}`);
      }
    });
  }

  // Add additional content if present
  if (posting.additionalPlain) {
    parts.push(posting.additionalPlain);
  } else if (posting.additional) {
    parts.push(posting.additional);
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * Map Lever posting to normalized JobOfferSummary
 *
 * @param posting - Lever posting from API response
 * @param tenantKey - Lever company slug (used as company name fallback)
 * @returns Normalized job offer summary
 */
export function mapLeverPostingToSummary(
  posting: LeverPosting,
  tenantKey: string,
): JobOfferSummary {
  return {
    ref: {
      provider: "lever",
      id: posting.id,
      url: posting.hostedUrl,
    },
    title: posting.text,
    company: {
      name: tenantKey, // Lever API doesn't include company name, use tenant slug
    },
    publishedAt: new Date(posting.createdAt).toISOString(),
    location: posting.categories.location
      ? {
          city: posting.categories.location,
        }
      : undefined,
    metadata: {
      // Store apply URL in metadata for later use
      // Category fields from Lever's taxonomy
      category: posting.categories.department
        ? { value: posting.categories.department }
        : posting.categories.team
          ? { value: posting.categories.team }
          : undefined,
      contractType: posting.categories.commitment
        ? { value: posting.categories.commitment }
        : undefined,
    },
  };
}

/**
 * Map Lever posting to normalized JobOfferDetail
 *
 * Extends summary with full description content. Since Lever's list endpoint
 * includes all content fields, this is a direct mapping without additional fetches.
 *
 * @param posting - Lever posting from API response
 * @param tenantKey - Lever company slug
 * @returns Normalized job offer detail with description
 */
export function mapLeverPostingToDetail(
  posting: LeverPosting,
  tenantKey: string,
): JobOfferDetail {
  const summary = mapLeverPostingToSummary(posting, tenantKey);

  return {
    ...summary,
    description: buildDescription(posting),
    // Lever doesn't separate min/desired requirements, all in description
    minRequirements: undefined,
    desiredRequirements: undefined,
  };
}
