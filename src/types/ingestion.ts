/**
 * Ingestion type definitions
 *
 * Types for ingestion-related operations and results.
 */

import type { JobOfferCompany, Provider } from "@/types/clients/job_offers";

/**
 * Result of a company persistence attempt
 */
export type CompanyPersistResult =
  | { ok: true; companyId: number }
  | { ok: false; reason: "insufficient_identity_evidence" };

/**
 * Input for persisting a company and its provider source link
 */
export type PersistCompanyInput = {
  company: JobOfferCompany;
  provider: Provider;
  providerCompanyUrl?: string;
};
