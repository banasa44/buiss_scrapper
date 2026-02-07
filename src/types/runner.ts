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
 * Client pause state tracking
 *
 * Tracks when a client should be paused due to rate limiting.
 * Key = client/provider name, Value = ISO timestamp when pause expires
 */
export type ClientPauseState = Map<string, string>;
