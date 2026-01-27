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

import type { RunCounters } from "@/types/db";

/**
 * Structural type for run accumulator compatibility
 * Uses Partial<RunCounters> to allow incrementing any subset of counters
 */
export type RunAccumulatorLike = {
  counters: Partial<RunCounters>;
};

/**
 * Input for batch offer ingestion
 */
export type IngestOffersInput = {
  provider: Provider;
  offers: (JobOfferSummary | JobOfferDetail)[];
  acc?: RunAccumulatorLike;
};

/**
 * Result of batch offer ingestion
 */
export type IngestOffersResult = {
  processed: number;
  upserted: number;
  skipped: number;
  failed: number;
};

/**
 * Result of a run-wrapped batch ingestion
 */
export type RunOfferBatchResult = {
  runId: number;
  result: IngestOffersResult;
  counters: Partial<RunCounters>;
};
