/**
 * Negation detection for keyword/phrase matches
 *
 * Checks if a match appears in a negated context by looking for
 * negation cue words in a surrounding window.
 */

import {
  NEGATION_CUES,
  NEGATION_WINDOW_BEFORE,
  NEGATION_WINDOW_AFTER,
} from "@/constants/negation";

/**
 * Checks if a match is negated based on surrounding context.
 *
 * A match is considered negated if any negation cue token appears
 * within the specified window around the match.
 *
 * Window: [startIndex - BEFORE, startIndex) ∪ [startIndex + length, startIndex + length + AFTER)
 * The match tokens themselves are excluded from the negation check.
 *
 * @param tokens - Complete normalized token array for the field
 * @param startIndex - Starting position of the match in tokens
 * @param length - Number of tokens in the matched sequence
 * @returns true if match is negated, false otherwise
 *
 * @example
 * // "no aws experience required" → tokens = ["no", "aws", "experience", "required"]
 * isNegated(tokens, 1, 1) // true (aws at index 1, "no" at index 0 is within window)
 *
 * @example
 * // "aws experience required" → tokens = ["aws", "experience", "required"]
 * isNegated(tokens, 0, 1) // false (no negation cues found)
 */
export function isNegated(
  tokens: string[],
  startIndex: number,
  length: number,
): boolean {
  // Define window bounds (clamped to valid indices)
  const windowStart = Math.max(0, startIndex - NEGATION_WINDOW_BEFORE);
  const matchEnd = startIndex + length;
  const windowEnd = Math.min(tokens.length, matchEnd + NEGATION_WINDOW_AFTER);

  // Check for negation cues before the match
  for (let i = windowStart; i < startIndex; i++) {
    if (NEGATION_CUES.includes(tokens[i])) {
      return true;
    }
  }

  // Check for negation cues after the match
  for (let i = matchEnd; i < windowEnd; i++) {
    if (NEGATION_CUES.includes(tokens[i])) {
      return true;
    }
  }

  return false;
}
