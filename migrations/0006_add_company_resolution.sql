-- Add resolution field to companies table for M6 feedback lifecycle
-- Per docs/M6/01_define_client_feedback&lifecycle.md

-- Add resolution column to track company lifecycle state
-- Default: PENDING (active state, no lifecycle action required)
-- Per M6 spec: valid values are PENDING, IN_PROGRESS, HIGH_INTEREST, ALREADY_REVOLUT, ACCEPTED, REJECTED
ALTER TABLE companies ADD COLUMN resolution TEXT NOT NULL DEFAULT 'PENDING';

-- Add index for filtering by resolution (useful for queries like "all resolved companies")
CREATE INDEX idx_companies_resolution ON companies(resolution);
