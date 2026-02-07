/**
 * Client pause type definitions
 *
 * Types for persisting per-client pause state (e.g., rate limiting).
 */

/**
 * Client pause row from database
 */
export type ClientPauseRow = {
  /** Client/provider identifier (e.g., "infojobs") */
  client: string;

  /** ISO 8601 timestamp when pause expires */
  paused_until: string;

  /** Reason for pause (e.g., "RATE_LIMIT") */
  reason: string | null;

  /** Last update timestamp */
  updated_at: string;
};
