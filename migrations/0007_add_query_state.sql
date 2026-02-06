-- Add query state table for M7 scheduled query execution tracking
-- Stores per-query operational state: run status, timestamps, error tracking

CREATE TABLE query_state (
  query_key TEXT PRIMARY KEY,
  client TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_processed_date TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for filtering queries by client
CREATE INDEX idx_query_state_client ON query_state(client);

-- Index for filtering queries by status
CREATE INDEX idx_query_state_status ON query_state(status);
