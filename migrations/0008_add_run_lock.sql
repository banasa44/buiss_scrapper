-- Add global run lock table for sequential execution across processes
-- Implements TTL-based lock with automatic expiry to prevent permanent deadlocks

CREATE TABLE run_lock (
  lock_name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
