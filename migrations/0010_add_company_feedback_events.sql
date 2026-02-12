-- Add company_feedback_events table for model performance feedback
-- Stores client feedback from MODEL_FEEDBACK and MODEL_NOTES columns in Google Sheets

-- Create feedback events table to log model performance feedback
-- Separate from resolution lifecycle - this tracks model quality signals
CREATE TABLE company_feedback_events (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feedback_value TEXT NOT NULL,  -- Value from MODEL_FEEDBACK column
  notes TEXT,                     -- Optional free-text from MODEL_NOTES column
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for querying feedback by company
CREATE INDEX idx_company_feedback_events_company_id ON company_feedback_events(company_id);

-- Index for querying recent feedback
CREATE INDEX idx_company_feedback_events_created_at ON company_feedback_events(created_at DESC);
