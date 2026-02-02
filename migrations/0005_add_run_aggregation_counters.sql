-- Add company aggregation tracking to ingestion_runs table
-- Supports M4.B3.3 batch aggregation at end-of-run

ALTER TABLE ingestion_runs ADD COLUMN companies_aggregated INTEGER;
ALTER TABLE ingestion_runs ADD COLUMN companies_failed INTEGER;
