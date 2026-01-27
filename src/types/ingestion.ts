/**
 * Ingestion type definitions
 *
 * Types for ingestion-related operations and results.
 */

import type {
  JobOfferCompany,
  JobOfferSummary,
  JobOfferDetail,
  Provider,
} from "@/types/clients/job_offers";

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

/**
 * Result of an offer persistence attempt
 */
export type OfferPersistResult =
  | { ok: true; offerId: number }
  | { ok: false; reason: "company_unidentifiable" | "db_error" };

/**
 * Input for persisting an offer
 * Accepts either JobOfferSummary or JobOfferDetail (detail extends summary)
 */
export type PersistOfferInput = {
  offer: JobOfferSummary | JobOfferDetail;
  provider: Provider;
};
