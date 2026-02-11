/**
 * Lever ATS API type definitions
 *
 * Raw response types from Lever's postings API.
 * Documentation: https://github.com/lever/postings-api
 *
 * These types represent Lever's API payloads and must NOT be re-exported from
 * the global types barrel. They are internal to the Lever client and should be
 * mapped to canonical types (JobOfferSummary, JobOfferDetail) for ingestion.
 */

/**
 * Lever posting (job offer) from API response
 *
 * Minimal subset of fields needed for mapping to canonical types.
 * Lever's actual response includes more fields - only core fields are typed here.
 */
export type LeverPosting = {
  /** Unique posting ID */
  id: string;
  /** Posting title/position name */
  text: string;
  /** URL to hosted job posting page */
  hostedUrl: string;
  /** URL to application page */
  applyUrl: string;
  /** Timestamp when posting was created (milliseconds since epoch) */
  createdAt: number;
  /** Categories/tags for the posting (team, location, commitment, etc.) */
  categories: {
    team?: string;
    location?: string;
    commitment?: string;
    level?: string;
    department?: string;
  };
  /** Job description and additional content fields */
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{
    text: string;
    content: string;
  }>;
  additional?: string;
  additionalPlain?: string;
};

/**
 * Lever API response for postings list
 *
 * Array of postings returned by GET /v0/postings/{tenant}
 */
export type LeverPostingsResponse = LeverPosting[];
