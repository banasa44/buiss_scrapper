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
 *
 * companyId is included in all cases to support tracking affected companies
 * for M4 aggregation (even when offer upsert fails).
 */
export type OfferPersistResult =
  | { ok: true; offerId: number; companyId: number }
  | { ok: false; reason: "company_unidentifiable" }
  | { ok: false; reason: "company_resolved"; companyId: number }
  | { ok: false; reason: "db_error"; companyId: number }
  | {
      ok: true;
      reason: "repost_duplicate";
      canonicalOfferId: number;
      companyId: number;
      detectionReason: "exact_title" | "desc_similarity";
      similarity?: number;
    };

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
  /** Optional set to collect affected company IDs (for M4 aggregation) */
  affectedCompanyIds?: Set<number>;
};

/**
 * Result of batch offer ingestion
 */
export type IngestOffersResult = {
  processed: number;
  upserted: number;
  skipped: number;
  failed: number;
  /** Number of offers detected as repost duplicates (not inserted) */
  duplicates: number;
  /** Number of unique companies affected during ingestion */
  affectedCompanies: number;
};

/**
 * Result of a run-wrapped batch ingestion
 */
export type RunOfferBatchResult = {
  runId: number;
  result: IngestOffersResult;
  counters: Partial<RunCounters>;
};

/**
 * Input for InfoJobs pipeline
 * Supports dependency injection for testing
 */
export type RunInfojobsPipelineInput = {
  /** Optional preconfigured InfoJobsClient for testing */
  client?: {
    readonly provider: Provider;
    searchOffers(
      query: import("@/types/clients/job_offers").SearchOffersQuery,
    ): Promise<import("@/types/clients/job_offers").SearchOffersResult>;
  };
  /** Text search query (optional) */
  text?: string;
  /** Filter by update date (ISO 8601 string) */
  updatedSince?: string;
  /** Maximum number of pages to fetch (default from constants) */
  maxPages?: number;
  /** Maximum number of offers to fetch (default from constants) */
  maxOffers?: number;
  /** Optional query key from query registry (for M7 scheduling) */
  queryKey?: string;
};

/**
 * Result of InfoJobs pipeline execution
 */
export type RunInfojobsPipelineResult = {
  /** Run ID from lifecycle */
  runId: number;
  /** Ingestion result (processed, upserted, skipped, failed) */
  ingestResult: IngestOffersResult;
  /** Final counters snapshot */
  counters: Partial<RunCounters>;
};
