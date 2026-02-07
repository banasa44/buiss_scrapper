/**
 * Runner/orchestration constants
 *
 * Configuration for the query execution orchestrator.
 */

/**
 * Maximum retry attempts per query on transient/rate-limit errors
 * FATAL errors (auth, config) do not retry
 */
export const MAX_RETRIES_PER_QUERY = 3;

/**
 * Client pause duration after hitting rate limit (in seconds)
 * Default: 6 hours (21600 seconds)
 */
export const CLIENT_PAUSE_DURATION_SECONDS = 21600;

/**
 * Minimum jitter delay between queries (milliseconds)
 * Helps smooth out request bursts
 */
export const QUERY_JITTER_MIN_MS = 10000; // 10 seconds

/**
 * Maximum jitter delay between queries (milliseconds)
 */
export const QUERY_JITTER_MAX_MS = 60000; // 60 seconds
