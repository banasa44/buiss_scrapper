/**
 * Runner/orchestration type definitions
 *
 * Types for the query execution orchestrator.
 */

/**
 * Error classification for query execution failures
 *
 * - RATE_LIMIT: HTTP 429 or provider-specific rate limit signals
 *   - Should retry with backoff
 *   - Should pause client to prevent further rate limits
 *
 * - TRANSIENT: Timeouts, 5xx errors, network failures
 *   - Should retry (may succeed on next attempt)
 *   - Does not require client pause
 *
 * - FATAL: Missing credentials, invalid config, schema mismatch
 *   - Should NOT retry (will fail again)
 *   - Requires manual intervention
 */
export type ErrorClassification = "RATE_LIMIT" | "TRANSIENT" | "FATAL";

/**
 * Status of a single step (provider) within a runner sequence
 *
 * - DONE: Step completed successfully
 * - PAUSED: Step was skipped due to pause state (e.g., rate limit)
 * - ERROR: Step encountered a fatal error
 */
export type RunnerStepStatus = "DONE" | "PAUSED" | "ERROR";

/**
 * Result of a single runner step (provider execution)
 */
export type RunnerStepResult = {
  /** Provider identifier */
  provider: string;
  /** Step status */
  status: RunnerStepStatus;
  /** Run ID (if pipeline executed) */
  runId?: number;
  /** Arbitrary counters (offers processed, sources checked, etc.) */
  counters?: Record<string, number>;
  /** Optional note (error message, status detail, etc.) */
  note?: string;
};

/**
 * Result of a sequential runner execution (multiple providers)
 */
export type RunnerSequenceResult = {
  /** Total number of providers attempted */
  total: number;
  /** Number of providers that completed successfully */
  success: number;
  /** Number of providers that were skipped (paused) */
  skipped: number;
  /** Number of providers that encountered errors */
  failed: number;
  /** Detailed results for each provider */
  providerResults: RunnerStepResult[];
};

/**
 * Result of a single ATS provider runner execution
 * Alias for RunnerStepResult specialized to ATS providers
 * Note: AtsProvider type is imported from atsDiscovery.ts
 */
export type AtsRunnerResult = RunnerStepResult & {
  provider: import("./atsDiscovery").AtsProvider;
};
