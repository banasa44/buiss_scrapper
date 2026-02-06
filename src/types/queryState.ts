/**
 * Query state type definitions
 *
 * Types for query execution state tracking (M7).
 */

/**
 * Query state status values
 * Represents the operational state of a scheduled query
 */
export type QueryStateStatus = "IDLE" | "RUNNING" | "SUCCESS" | "ERROR";

/**
 * Query state row (database entity)
 * Tracks per-query operational state for scheduled execution
 */
export type QueryStateRow = {
  /** Unique query identifier (format: client:name:hash) */
  query_key: string;

  /** Provider/client identifier (e.g., "infojobs") */
  client: string;

  /** Stable human-readable query name (e.g., "es_generic_all") */
  name: string;

  /** Current operational status */
  status: QueryStateStatus;

  /** Timestamp of last run attempt (ISO 8601 string) */
  last_run_at: string | null;

  /** Timestamp of last successful run (ISO 8601 string) */
  last_success_at: string | null;

  /** Timestamp of last error (ISO 8601 string) */
  last_error_at: string | null;

  /** Last processed date for historical seeding (YYYY-MM-DD) */
  last_processed_date: string | null;

  /** Count of consecutive failures (reset on success) */
  consecutive_failures: number;

  /** Stable error code identifier (e.g., "AUTH", "RATE_LIMIT", "HTTP_5XX") */
  error_code: string | null;

  /** Short error message (avoid large blobs) */
  error_message: string | null;

  /** Last update timestamp (ISO 8601 string) */
  updated_at: string;
};

/**
 * Query state upsert input
 * All fields except query_key are optional to support partial updates
 */
export type QueryStateInput = {
  query_key: string;
  client?: string;
  name?: string;
  status?: QueryStateStatus;
  last_run_at?: string | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_processed_date?: string | null;
  consecutive_failures?: number;
  error_code?: string | null;
  error_message?: string | null;
};

/**
 * Query state list filter options
 */
export type QueryStateListOptions = {
  /** Filter by client (optional) */
  client?: string;
};
