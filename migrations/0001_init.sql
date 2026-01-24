-- Initial schema migration
-- Based on docs/M1/01_define_db_schema.md

-- Companies table
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_company_id TEXT,
  name TEXT,
  normalized_name TEXT,
  hidden INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_company_provider_id UNIQUE (provider, provider_company_id),
  CONSTRAINT uq_company_normalized UNIQUE (provider, normalized_name)
);

-- Offers table
CREATE TABLE offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_offer_id TEXT NOT NULL,
  provider_url TEXT,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  min_requirements TEXT,
  desired_requirements TEXT,
  requirements_snippet TEXT,
  published_at TEXT,
  updated_at TEXT,
  created_at TEXT,
  applications_count INTEGER,
  metadata_json TEXT,
  raw_json TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT uq_offer_provider_id UNIQUE (provider, provider_offer_id)
);

-- Matches table (1:1 with offer)
CREATE TABLE matches (
  offer_id INTEGER PRIMARY KEY,
  score REAL NOT NULL DEFAULT 0.0,
  matched_keywords_json TEXT NOT NULL,
  reasons TEXT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- Ingestion runs table
CREATE TABLE ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  query_fingerprint TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT,
  pages_fetched INTEGER,
  offers_fetched INTEGER,
  requests_count INTEGER,
  http_429_count INTEGER,
  errors_count INTEGER,
  notes TEXT
);

-- Indexes
CREATE INDEX idx_offers_company ON offers(company_id);
CREATE INDEX idx_offers_updated ON offers(updated_at);
