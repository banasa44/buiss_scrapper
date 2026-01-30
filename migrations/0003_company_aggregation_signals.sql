-- Migration: Add company-level aggregation signals for M4
-- Based on docs/M4/01_define_agg_strategy.md and docs/M4/02_define_offer_freshnes.md
--
-- Adds columns to companies table to persist aggregated scoring signals.
-- These fields are computed during M4 aggregation runs and represent company-level
-- quality indicators derived from offer scores.
--
-- Note: Transaction is handled by the migration runner, not in this SQL file

-- Add core aggregation metrics columns
ALTER TABLE companies ADD COLUMN max_score REAL;
ALTER TABLE companies ADD COLUMN offer_count INTEGER;
ALTER TABLE companies ADD COLUMN unique_offer_count INTEGER;
ALTER TABLE companies ADD COLUMN strong_offer_count INTEGER;
ALTER TABLE companies ADD COLUMN avg_strong_score REAL;

-- Add evidence/explainability columns
ALTER TABLE companies ADD COLUMN top_category_id TEXT;
ALTER TABLE companies ADD COLUMN top_offer_id INTEGER;
ALTER TABLE companies ADD COLUMN category_max_scores TEXT;

-- Add freshness indicator column
ALTER TABLE companies ADD COLUMN last_strong_at TEXT;

-- Add foreign key index for top_offer_id
-- (FK constraint cannot be added to existing table in SQLite, but index improves query performance)
CREATE INDEX idx_companies_top_offer ON companies(top_offer_id) WHERE top_offer_id IS NOT NULL;

-- Add index on max_score for ranking/sorting queries
CREATE INDEX idx_companies_max_score ON companies(max_score) WHERE max_score IS NOT NULL;

-- Add index on last_strong_at for freshness-based queries
CREATE INDEX idx_companies_last_strong_at ON companies(last_strong_at) WHERE last_strong_at IS NOT NULL;
