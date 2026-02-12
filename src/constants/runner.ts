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

/**
 * Minimum sleep between runner cycles (milliseconds)
 * Used in forever mode between runOnce() executions
 */
export const CYCLE_SLEEP_MIN_MS = 300000; // 5 minutes

/**
 * Maximum sleep between runner cycles (milliseconds)
 */
export const CYCLE_SLEEP_MAX_MS = 900000; // 15 minutes

/**
 * Default batch limit for ATS discovery runner
 * Maximum number of companies to process in a single batch
 */
export const ATS_DISCOVERY_BATCH_LIMIT = 100;

/**
 * Default limit for Lever ATS ingestion pipeline
 * Maximum number of Lever company_sources to process in a single run
 */
export const LEVER_INGESTION_DEFAULT_LIMIT = 50;

/**
 * Default limit for Greenhouse ATS ingestion pipeline
 * Maximum number of Greenhouse company_sources to process in a single run
 */
export const GREENHOUSE_INGESTION_DEFAULT_LIMIT = 50;

/**
 * ATS orchestrator provider execution order
 * Defines the sequence in which ATS providers are run
 */
export const ATS_PROVIDER_EXECUTION_ORDER = ["lever", "greenhouse"] as const;
