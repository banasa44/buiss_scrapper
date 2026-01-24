/**
 * Database type definitions
 *
 * Types for database entities and repository interfaces.
 * Aligned with schema in migrations/0002_company_sources_and_global_companies.sql
 */

/**
 * Company entity (global, no provider column)
 * Stored in companies table
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
