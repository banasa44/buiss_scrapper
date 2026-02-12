-- Add idempotency to company_feedback_events table
-- Ensures same feedback from same sheet row is not duplicated

-- Add sheet_row_index column (nullable to allow existing rows, but new inserts must provide it)
ALTER TABLE company_feedback_events ADD COLUMN sheet_row_index INTEGER;

-- Create unique index to enforce idempotency
-- Includes notes in dedup key to preserve notes changes as separate events
-- NULL and empty string are treated as distinct values
CREATE UNIQUE INDEX idx_company_feedback_events_unique 
ON company_feedback_events(company_id, sheet_row_index, feedback_value, notes);
