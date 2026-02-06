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
