/**
 * Database type definitions
 *
 * Types for database entities and repository interfaces.
 * Aligned with schema in docs/M1/01_define_db_schema.md
 */

/**
 * Company entity (stored in companies table)
 */
export type Company = {
  id: number;
  provider: string;
  provider_company_id: string | null;
  name: string | null;
  normalized_name: string | null;
  hidden: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * Company upsert input (omit auto-generated fields)
 */
export type CompanyInput = {
  provider: string;
  provider_company_id?: string | null;
  name?: string | null;
  normalized_name?: string | null;
  hidden?: number | null;
};

/**
 * Job offer entity (stored in offers table)
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
};

/**
 * Offer upsert input (omit auto-generated fields)
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
};

/**
 * Ingestion run create input
 */
export type IngestionRunInput = {
  provider: string;
  query_fingerprint?: string | null;
};

/**
 * Ingestion run finish/update input
 */
export type IngestionRunUpdate = {
  finished_at?: string;
  status?: string | null;
  pages_fetched?: number | null;
  offers_fetched?: number | null;
  requests_count?: number | null;
  http_429_count?: number | null;
  errors_count?: number | null;
  notes?: string | null;
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
