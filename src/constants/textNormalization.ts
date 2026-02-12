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
 * - Unicode punctuation: curly quotes \u201c\u201d, apostrophes \u2018\u2019
 *
 * This pattern preserves meaningful word boundaries while splitting
 * on structural and punctuation characters commonly found in job offers.
 *
 * Matcher Hardening - Increment 1: Added Unicode punctuation support.
 */
export const TOKEN_SEPARATOR_PATTERN =
  /[\s\/\\|()[\]{},;:.!?"'\-_\u201c\u201d\u2018\u2019]+/;
