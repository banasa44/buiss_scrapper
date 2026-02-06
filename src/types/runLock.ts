/**
 * Run lock type definitions
 *
 * Types for global run lock (prevents concurrent pipeline execution).
 */

/**
 * Run lock row (database entity)
 * Stores lock ownership and expiry information
 */
export type RunLockRow = {
  /** Lock name (typically "global" for single system-wide lock) */
  lock_name: string;

  /** Owner process identifier (UUID) */
  owner_id: string;

  /** When the lock was acquired (ISO 8601 string) */
  acquired_at: string;

  /** When the lock expires (ISO 8601 string) */
  expires_at: string;

  /** Last update timestamp (ISO 8601 string) */
  updated_at: string;
};

/**
 * Lock acquisition result
 */
export type RunLockAcquireResult =
  | { ok: true }
  | { ok: false; reason: "LOCKED" | "DB_NOT_OPEN" | "UNKNOWN" };
