/**
 * Repost detection constants and thresholds
 *
 * Tunable parameters for duplicate offer detection.
 * See: docs/M4/repost_decisions.md
 */

/**
 * Minimum description similarity threshold to consider an offer a repost.
 *
 * Uses multiset token overlap metric:
 * similarity = overlap / max(len_incoming, len_candidate)
 *
 * Value of 0.90 means that 90% of tokens must overlap (counting repetitions).
 * This is intentionally high to avoid false positives.
 *
 * Applied only when titles don't match exactly.
 */
export const DESC_SIM_THRESHOLD = 0.9;
