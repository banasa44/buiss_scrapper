/**
 * Database type definitions
 *
 * Types for database entities and repository interfaces.
 * Aligned with schema in migrations/0006_add_company_resolution.sql
 */

import type { CompanyResolution } from "./sheets";

/**
 * Company entity (global, no provider column)
 * Stored in companies table
 *
 * Includes M4 aggregation signals (nullable until first aggregation run):
 * - Core metrics: max_score, offer_count, unique_offer_count, strong_offer_count, avg_strong_score
 * - Evidence: top_category_id, top_offer_id, category_max_scores (JSON)
 * - Freshness: last_strong_at
 *
 * Includes M6 feedback lifecycle:
 * - resolution: client decision from Google Sheets (PENDING by default)
 */
export type Company = {
  id: number;
  name_raw: string | null;
  name_display: string | null;
  normalized_name: string | null;
  website_url: string | null;
  website_domain: string | null;
  created_at: string;
  updated_at: string;
  // M4 aggregation signals (nullable)
  max_score: number | null;
  offer_count: number | null;
  unique_offer_count: number | null;
  strong_offer_count: number | null;
  avg_strong_score: number | null;
  top_category_id: string | null;
  top_offer_id: number | null;
  category_max_scores: string | null; // JSON: { [categoryId]: maxScore }
  last_strong_at: string | null;
  // M6 feedback lifecycle
  resolution: CompanyResolution;
};

/**
 * Company upsert input (omit auto-generated fields)
 * Must have either website_domain or normalized_name for identity
 */
export type CompanyInput = {
  name_raw?: string | null;
  name_display?: string | null;
  normalized_name?: string | null;
  website_url?: string | null;
  website_domain?: string | null;
};

/**
 * Company aggregation signals update input
 * Used by M4 aggregation logic to update company-level scores
 *
 * All fields are optional to support partial updates.
 * In practice, aggregation will set all fields atomically.
 *
 * Note: category_max_scores is passed as a plain object and will be
 * JSON-serialized by the repo layer before storage.
 */
export type CompanyAggregationInput = {
  max_score?: number | null;
  offer_count?: number | null;
  unique_offer_count?: number | null;
  strong_offer_count?: number | null;
  avg_strong_score?: number | null;
  top_category_id?: string | null;
  top_offer_id?: number | null;
  category_max_scores?: Record<string, number> | null; // Plain object, serialized as JSON in DB
  last_strong_at?: string | null;
};

/**
 * Company source entity (provider-specific company data)
 * Stored in company_sources table
 */
export type CompanySource = {
  id: number;
  company_id: number;
  provider: string;
  provider_company_id: string | null;
  provider_company_url: string | null;
  hidden: number | null;
  raw_json: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Company source upsert input (omit auto-generated fields)
 */
export type CompanySourceInput = {
  company_id: number;
  provider: string;
  provider_company_id?: string | null;
  provider_company_url?: string | null;
  hidden?: number | null;
  raw_json?: string | null;
};

/**
 * Job offer entity (stored in offers table)
 *
 * Includes M4 canonicalization fields for repost/duplicate handling:
 * - canonical_offer_id: NULL for canonical offers, points to canonical for duplicates
 * - repost_count: tracked on canonical offers only
 * - last_seen_at: updated when duplicates are detected
 * - content_fingerprint: deterministic fingerprint for duplicate detection
 */
export type Offer = {
  id: number;
  provider: string;
  provider_offer_id: string;
  provider_url: string | null;
  company_id: number;
  title: string;
  description: string | null;
  min_requirements: string | null;
  desired_requirements: string | null;
  requirements_snippet: string | null;
  published_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  applications_count: number | null;
  metadata_json: string | null;
  raw_json: string | null;
  ingested_at: string;
  last_updated_at: string;
  // M4 canonicalization fields (nullable)
  canonical_offer_id: number | null;
  repost_count: number;
  last_seen_at: string | null;
  content_fingerprint: string | null;
};

/**
 * Offer upsert input (omit auto-generated fields)
 *
 * Note: Canonicalization fields (canonical_offer_id, content_fingerprint,
 * last_seen_at) are intentionally excluded. These must only be mutated by
 * dedicated M4 dedupe methods, never by generic ingestion upserts.
 */
export type OfferInput = {
  provider: string;
  provider_offer_id: string;
  provider_url?: string | null;
  company_id: number;
  title: string;
  description?: string | null;
  min_requirements?: string | null;
  desired_requirements?: string | null;
  requirements_snippet?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  applications_count?: number | null;
  metadata_json?: string | null;
  raw_json?: string | null;
};

/**
 * Offer canonicalization update input
 * Used by M4 dedupe logic to mark offers as duplicates or update repost tracking
 */
export type OfferCanonicalUpdateInput = {
  canonical_offer_id?: number | null;
  repost_count?: number;
  last_seen_at?: string | null;
  content_fingerprint?: string | null;
};

/**
 * Ingestion run entity (stored in ingestion_runs table)
 */
export type IngestionRun = {
  id: number;
  provider: string;
  query_fingerprint: string | null;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  pages_fetched: number | null;
  offers_fetched: number | null;
  requests_count: number | null;
  http_429_count: number | null;
  errors_count: number | null;
  notes: string | null;
  companies_aggregated: number | null;
  companies_failed: number | null;
};

/**
 * Ingestion run create input
 */
export type IngestionRunInput = {
  provider: string;
  query_fingerprint?: string | null;
};

/**
 * Run status for lifecycle helpers
 */
export type RunStatus = "success" | "failure";

/**
 * Ingestion run finish/update input
 */
export type IngestionRunUpdate = {
  finished_at?: string;
  status?: RunStatus | null;
  pages_fetched?: number | null;
  offers_fetched?: number | null;
  requests_count?: number | null;
  http_429_count?: number | null;
  errors_count?: number | null;
  notes?: string | null;
  companies_aggregated?: number | null;
  companies_failed?: number | null;
};

/**
 * Run counters for lifecycle helpers
 * Subset of IngestionRunUpdate for counter fields only
 * Includes offer-specific counters for runtime tracking
 */
export type RunCounters = {
  pages_fetched?: number | null;
  offers_fetched?: number | null;
  offers_upserted?: number | null;
  offers_skipped?: number | null;
  offers_failed?: number | null;
  offers_duplicates?: number | null;
  errors_count?: number | null;
  companies_aggregated?: number | null;
  companies_failed?: number | null;
};

/**
 * Mutable accumulator for tracking counters during run execution
 * Passed to withRun() callback so counters persist even on failure
 */
export type RunAccumulator = {
  counters: RunCounters;
};

/**
 * Match entity (stored in matches table)
 */
export type Match = {
  offer_id: number;
  score: number;
  matched_keywords_json: string;
  reasons: string | null;
  computed_at: string;
};

/**
 * Match upsert input
 */
export type MatchInput = {
  offer_id: number;
  score: number;
  matched_keywords_json: string;
  reasons?: string | null;
};

/**
 * Company offer row for M4 aggregation
 *
 * Minimal data needed by aggregateCompany() pure function.
 * Joined from offers + matches tables.
 */
export type CompanyOfferAggRow = {
  offerId: number;
  canonicalOfferId: number | null;
  repostCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
  score: number;
  topCategoryId: string | null;
};
