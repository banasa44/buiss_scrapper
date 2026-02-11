/**
 * Greenhouse ATS API type definitions
 *
 * Raw response types from Greenhouse's Job Board API.
 * Documentation: https://developers.greenhouse.io/job-board.html
 *
 * These types represent Greenhouse's API payloads and must NOT be re-exported from
 * the global types barrel. They are internal to the Greenhouse client and should be
 * mapped to canonical types (JobOfferSummary, JobOfferDetail) for ingestion.
 */

/**
 * Greenhouse job location object
 */
export type GreenhouseLocation = {
  /** Location name/city */
  name?: string;
};

/**
 * Greenhouse job (job offer) from API response
 *
 * Minimal subset of fields needed for mapping to canonical types.
 * Greenhouse's actual response includes more fields - only core fields are typed here.
 */
export type GreenhouseJob = {
  /** Unique job ID */
  id: number;
  /** Job title/position name */
  title: string;
  /** Public URL to job posting */
  absolute_url: string;
  /** Timestamp when job was last updated (ISO 8601) */
  updated_at?: string;
  /** Location information */
  location?: GreenhouseLocation;
  /** Job description and content fields (only present with content=true) */
  content?: string;
  /** Additional metadata fields */
  metadata?: Array<{
    name: string;
    value: string | string[];
  }>;
};

/**
 * Greenhouse API response for jobs list
 *
 * Object with jobs array returned by GET /v1/boards/{token}/jobs
 */
export type GreenhouseJobsResponse = {
  jobs: GreenhouseJob[];
};
