/**
 * Migration 0009: Add client_pause table
 *
 * Persists per-client pause state (e.g., rate limiting) so it survives restarts.
 */

CREATE TABLE IF NOT EXISTS client_pause (
  client TEXT PRIMARY KEY,
  paused_until TEXT NOT NULL,
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
