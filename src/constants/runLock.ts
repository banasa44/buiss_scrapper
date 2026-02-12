/**
 * Run lock constants
 *
 * Configuration for global run lock (prevents concurrent pipeline execution).
 */

/**
 * Global run lock name (single lock for the entire system)
 */
export const RUN_LOCK_NAME = "global";

/**
 * Lock TTL in seconds
 * After this time, a stale lock can be taken over by another process.
 * Default: 1 hour (3600 seconds)
 */
export const RUN_LOCK_TTL_SECONDS = 3600;

/**
 * Lock refresh interval in milliseconds
 *
 * How often to refresh the lock during long-running operations.
 * Set to 1/4 of TTL to provide 3 refresh opportunities within TTL window,
 * giving safety margin for transient failures.
 *
 * Formula: (RUN_LOCK_TTL_SECONDS / 4) * 1000 = 900,000 ms = 15 minutes
 */
export const RUN_LOCK_REFRESH_INTERVAL_MS = (RUN_LOCK_TTL_SECONDS / 4) * 1000;
