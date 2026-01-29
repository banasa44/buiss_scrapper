/**
 * Negation detection constants
 *
 * Configuration for detecting negated contexts in keyword/phrase matching.
 * Negation detection is matcher-level logic, not scoring logic.
 */

/**
 * Negation cue tokens (normalized form).
 *
 * When these tokens appear near a keyword/phrase match, the match
 * is flagged as negated.
 *
 * Includes common negation words in Spanish and English.
 */
export const NEGATION_CUES: readonly string[] = [
  "no", // Spanish/English: "no"
  "sin", // Spanish: "without"
  "not", // English: "not"
  "without", // English: "without"
];

/**
 * Negation context window: tokens to check BEFORE the match.
 *
 * Checks for negation cues in the range [matchStart - BEFORE, matchStart).
 */
export const NEGATION_WINDOW_BEFORE = 8;

/**
 * Negation context window: tokens to check AFTER the match.
 *
 * Checks for negation cues in the range [matchEnd, matchEnd + AFTER).
 */
export const NEGATION_WINDOW_AFTER = 2;
