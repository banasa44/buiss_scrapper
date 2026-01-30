-- Migration: Add offer canonicalization fields for M4 repost/duplicate handling
-- Based on docs/M4/03_define_repost_detection.md
--
-- Adds columns to offers table to support duplicate detection and repost tracking.
-- Canonical offers have canonical_offer_id = NULL and track repost activity.
-- Duplicate offers point to their canonical via canonical_offer_id.
--
-- Note: Transaction is handled by the migration runner, not in this SQL file

-- Add canonicalization tracking columns
ALTER TABLE offers ADD COLUMN canonical_offer_id INTEGER;
ALTER TABLE offers ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offers ADD COLUMN last_seen_at TEXT;
ALTER TABLE offers ADD COLUMN content_fingerprint TEXT;

-- Add index on canonical_offer_id for finding duplicates of a canonical offer
CREATE INDEX idx_offers_canonical ON offers(canonical_offer_id) WHERE canonical_offer_id IS NOT NULL;

-- Add index on content_fingerprint + company_id for duplicate detection
-- Partial index: only index non-null fingerprints (canonical offers only)
CREATE INDEX idx_offers_fingerprint_company ON offers(content_fingerprint, company_id) WHERE content_fingerprint IS NOT NULL;

-- Add index on last_seen_at for freshness queries
CREATE INDEX idx_offers_last_seen ON offers(last_seen_at) WHERE last_seen_at IS NOT NULL;
