-- Migration: Refactor companies to global (no provider column) with company_sources
-- Based on docs/M1/03_define_company_id.md and docs/M1/03-2_refactor_company_definition.md

-- This migration converts provider-scoped companies to global companies
-- with separate company_sources table for provider-specific data.
-- Note: Transaction is handled by the migration runner, not in this SQL file

-- Step 1: Rename old companies table to preserve data
ALTER TABLE companies RENAME TO companies_old;

-- Step 2: Create new global companies table (no provider column)
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_raw TEXT,
  name_display TEXT,
  normalized_name TEXT,
  website_url TEXT,
  website_domain TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 3: Create company_sources table for provider-specific data
CREATE TABLE company_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_company_id TEXT,
  provider_company_url TEXT,
  hidden INTEGER,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Step 4: Create indexes and constraints for companies
-- Unique constraint on website_domain when not null (strongest identity signal)
CREATE UNIQUE INDEX uq_companies_website_domain 
  ON companies(website_domain) 
  WHERE website_domain IS NOT NULL;

-- Unique constraint on normalized_name (fallback identity signal)
-- Tradeoff: assumes one global company per normalized name
-- May need adjustment if legitimate duplicates exist
CREATE UNIQUE INDEX uq_companies_normalized_name 
  ON companies(normalized_name) 
  WHERE normalized_name IS NOT NULL;

-- Step 5: Create indexes and constraints for company_sources
-- Unique constraint on (provider, provider_company_id) when provider_company_id exists
CREATE UNIQUE INDEX uq_company_sources_provider_id 
  ON company_sources(provider, provider_company_id) 
  WHERE provider_company_id IS NOT NULL;

-- Index on company_id for lookups
CREATE INDEX idx_company_sources_company_id ON company_sources(company_id);

-- Step 6: Migrate data from old companies to new structure
-- Strategy: Create one global company per unique normalized_name
-- Then create company_sources entries linking back to global companies

-- First, insert unique companies based on normalized_name
INSERT INTO companies (name_raw, name_display, normalized_name, created_at, updated_at)
SELECT 
  name as name_raw,
  name as name_display,
  normalized_name,
  MIN(created_at) as created_at,
  MAX(updated_at) as updated_at
FROM companies_old
WHERE normalized_name IS NOT NULL
GROUP BY normalized_name;

-- Second, create company_sources entries for each old company
-- Link to new global company via normalized_name
INSERT INTO company_sources (company_id, provider, provider_company_id, hidden, created_at, updated_at)
SELECT 
  c.id as company_id,
  co.provider,
  co.provider_company_id,
  co.hidden,
  co.created_at,
  co.updated_at
FROM companies_old co
JOIN companies c ON co.normalized_name = c.normalized_name
WHERE co.normalized_name IS NOT NULL;

-- Step 7: Recreate offers table with updated foreign key to new companies table
-- SQLite doesn't support modifying foreign keys, so we need to recreate the table

-- Drop existing indexes first (they'll be recreated)
DROP INDEX IF EXISTS idx_offers_company;
DROP INDEX IF EXISTS idx_offers_updated;

-- Rename offers to offers_old
ALTER TABLE offers RENAME TO offers_old;

-- Create new offers table with correct foreign key
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

-- Copy data from offers_old, updating company_id references
INSERT INTO offers (
  id, provider, provider_offer_id, provider_url, company_id,
  title, description, min_requirements, desired_requirements,
  requirements_snippet, published_at, updated_at, created_at,
  applications_count, metadata_json, raw_json, ingested_at, last_updated_at
)
SELECT 
  o.id, o.provider, o.provider_offer_id, o.provider_url,
  c.id as company_id,  -- Map to new company id
  o.title, o.description, o.min_requirements, o.desired_requirements,
  o.requirements_snippet, o.published_at, o.updated_at, o.created_at,
  o.applications_count, o.metadata_json, o.raw_json, o.ingested_at, o.last_updated_at
FROM offers_old o
JOIN companies_old co ON o.company_id = co.id
JOIN companies c ON co.normalized_name = c.normalized_name
WHERE co.normalized_name IS NOT NULL;

-- Recreate offers indexes
CREATE INDEX idx_offers_company ON offers(company_id);
CREATE INDEX idx_offers_updated ON offers(updated_at);

-- Step 7b: Recreate matches table to fix foreign key reference
-- When offers was renamed to offers_old, SQLite automatically updated the FK in matches
-- to point to offers_old. We must recreate matches to point to the new offers table.

-- Rename matches to matches_old
ALTER TABLE matches RENAME TO matches_old;

-- Create new matches table with FK pointing to new offers table
CREATE TABLE matches (
  offer_id INTEGER PRIMARY KEY,
  score REAL NOT NULL DEFAULT 0.0,
  matched_keywords_json TEXT NOT NULL,
  reasons TEXT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- Copy all data from matches_old
INSERT INTO matches (offer_id, score, matched_keywords_json, reasons, computed_at)
SELECT offer_id, score, matched_keywords_json, reasons, computed_at
FROM matches_old;

-- Drop old matches table
DROP TABLE matches_old;

-- Drop old offers table
DROP TABLE offers_old;

-- Step 8: Drop old companies table
DROP TABLE companies_old;
