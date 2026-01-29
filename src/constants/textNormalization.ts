/**
 * Text normalization constants and tunables
 *
 * These parameters control the deterministic tokenization
 * used across catalog compilation and offer matching.
 */

/**
 * Regular expression pattern for splitting text into tokens.
 *
 * Splits on:
 * - Whitespace (spaces, tabs, newlines)
 * - Common technical separators: / \ | ( ) [ ] { } , ; : . ! ? " '
 * - Hyphens and underscores
 *
 * This pattern preserves meaningful word boundaries while splitting
 * on structural and punctuation characters commonly found in job offers.
 */
export const TOKEN_SEPARATOR_PATTERN = /[\s\/\\|()[\]{},;:.!?"'\-_]+/;
