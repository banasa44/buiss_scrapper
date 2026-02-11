/**
 * ATS (Applicant Tracking System) provider type definitions
 *
 * Types specific to ATS-based job sources (Lever, Greenhouse, etc.).
 * These are input/configuration types - output types reuse canonical JobOfferSummary/Detail.
 */

/**
 * ATS tenant identifier
 *
 * Provider-specific identifier for a company's ATS instance:
 * - Lever: company slug (e.g., "acme")
 * - Greenhouse: board token (e.g., "acmecorp")
 *
 * Currently a string alias for documentation. May be refined to a discriminated
 * union if provider-specific validation becomes necessary.
 */
export type AtsTenantKey = string;
