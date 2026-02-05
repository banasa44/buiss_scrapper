/**
 * Repost/duplicate detection logic
 *
 * Pure deterministic functions for identifying duplicate offers.
 * See: docs/M4/repost_decisions.md
 *
 * Key design decisions:
 * - Fast-path: Exact title match after normalization (no description comparison needed)
 * - Fallback: Multiset token overlap on descriptions with 0.90 threshold
 * - Pure functions: no DB, no side effects, no current time access
 * - Deterministic tie-breaking: similarity → timestamp → id
 */

import { normalizeToTokens } from "@/utils/text/textNormalization";
import { DESC_SIM_THRESHOLD } from "@/constants/repost";
import type { RepostCandidate, DuplicateDecision } from "@/types/repost";

/**
 * Incoming offer data needed for repost detection.
 */
type IncomingOffer = {
  title?: string | null;
  description?: string | null;
};

/**
 * Detects if an incoming offer is a duplicate of any candidate canonical offer.
 *
 * Detection strategy (applied in order):
 * 1. **Exact title match (fast-path):**
 *    - Normalize both titles using normalizeToTokens()
 *    - If token sequences are identical → duplicate (skip description comparison)
 *
 * 2. **Description similarity fallback:**
 *    - If incoming offer has no description → not duplicate
 *    - For each candidate with a description:
 *      - Compute multiset token overlap similarity
 *      - overlap = Σ min(count_incoming[token], count_candidate[token])
 *      - similarity = overlap / max(len_incoming, len_candidate)
 *    - Select best candidate (highest similarity, then most recent, then lowest id)
 *    - If best similarity ≥ DESC_SIM_THRESHOLD (0.90) → duplicate
 *
 * @param incoming - The new offer to check for duplicates
 * @param candidates - Existing canonical offers to compare against
 * @returns Decision indicating if offer is duplicate and why
 *
 * @example
 * // Exact title match
 * detectRepostDuplicate(
 *   { title: "Senior Developer", description: "..." },
 *   [{ id: 1, title: "Senior Developer", ... }]
 * )
 * // => { kind: "duplicate", canonicalOfferId: 1, reason: "exact_title" }
 *
 * @example
 * // Description similarity
 * detectRepostDuplicate(
 *   { title: "Dev", description: "We need a senior developer with 5 years..." },
 *   [{ id: 2, title: "Developer", description: "We need a senior developer with 5 years..." }]
 * )
 * // => { kind: "duplicate", canonicalOfferId: 2, reason: "desc_similarity", similarity: 0.95 }
 */
export function detectRepostDuplicate(
  incoming: IncomingOffer,
  candidates: RepostCandidate[],
): DuplicateDecision {
  // Early exit: no candidates to compare against
  if (candidates.length === 0) {
    return {
      kind: "not_duplicate",
      reason: "no_candidates",
    };
  }

  const incomingTitle = incoming.title?.trim() || "";
  const incomingDescription = incoming.description?.trim() || "";

  // Normalize incoming title once
  const incomingTitleTokens = incomingTitle
    ? normalizeToTokens(incomingTitle)
    : [];

  // Fast-path: Check for exact title matches
  for (const candidate of candidates) {
    const candidateTitle = candidate.title?.trim() || "";
    if (!candidateTitle) continue;

    const candidateTitleTokens = normalizeToTokens(candidateTitle);

    // Check if title token sequences are identical
    if (areTokenSequencesEqual(incomingTitleTokens, candidateTitleTokens)) {
      return {
        kind: "duplicate",
        canonicalOfferId: candidate.id,
        reason: "exact_title",
        matchedCandidateCount: candidates.length,
      };
    }
  }

  // Fallback: Description similarity comparison
  // Only proceed if incoming offer has a description
  if (!incomingDescription) {
    return {
      kind: "not_duplicate",
      reason: "missing_description",
    };
  }

  // Tokenize incoming description once
  const incomingDescTokens = normalizeToTokens(incomingDescription);

  // Build multiset (token count map) for incoming description
  const incomingTokenCounts = buildTokenCountMap(incomingDescTokens);

  // Find best matching candidate by description similarity
  let bestCandidate: RepostCandidate | null = null;
  let bestSimilarity = 0;

  for (const candidate of candidates) {
    const candidateDesc = candidate.description?.trim() || "";
    if (!candidateDesc) continue; // Skip candidates without descriptions

    const candidateDescTokens = normalizeToTokens(candidateDesc);
    const candidateTokenCounts = buildTokenCountMap(candidateDescTokens);

    const similarity = computeMultisetSimilarity(
      incomingTokenCounts,
      candidateTokenCounts,
      incomingDescTokens.length,
      candidateDescTokens.length,
    );

    // Update best candidate if this one is better
    if (
      similarity > bestSimilarity ||
      (similarity === bestSimilarity &&
        bestCandidate &&
        isCandidateBetter(candidate, bestCandidate))
    ) {
      bestCandidate = candidate;
      bestSimilarity = similarity;
    }
  }

  // Check if best similarity meets threshold
  if (bestCandidate && bestSimilarity >= DESC_SIM_THRESHOLD) {
    return {
      kind: "duplicate",
      canonicalOfferId: bestCandidate.id,
      reason: "desc_similarity",
      similarity: bestSimilarity,
      matchedCandidateCount: candidates.length,
    };
  }

  // No match found
  return {
    kind: "not_duplicate",
    reason: bestSimilarity > 0 ? "desc_below_threshold" : "title_mismatch",
  };
}

/**
 * Checks if two token sequences are exactly equal (same length, same order, same tokens).
 */
function areTokenSequencesEqual(tokens1: string[], tokens2: string[]): boolean {
  if (tokens1.length !== tokens2.length) return false;

  for (let i = 0; i < tokens1.length; i++) {
    if (tokens1[i] !== tokens2[i]) return false;
  }

  return true;
}

/**
 * Builds a map of token counts (multiset representation).
 *
 * @param tokens - Array of tokens
 * @returns Map from token to count
 */
function buildTokenCountMap(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return counts;
}

/**
 * Computes multiset similarity between two token count maps.
 *
 * Formula: overlap / max(len1, len2)
 * where overlap = Σ min(count1[token], count2[token]) for all tokens
 *
 * @param counts1 - Token counts for first text
 * @param counts2 - Token counts for second text
 * @param len1 - Total token count for first text
 * @param len2 - Total token count for second text
 * @returns Similarity score between 0 and 1
 */
function computeMultisetSimilarity(
  counts1: Map<string, number>,
  counts2: Map<string, number>,
  len1: number,
  len2: number,
): number {
  if (len1 === 0 && len2 === 0) return 1; // Both empty → identical
  if (len1 === 0 || len2 === 0) return 0; // One empty → no similarity

  let overlap = 0;

  // Iterate over all tokens in the first map
  for (const [token, count1] of counts1) {
    const count2 = counts2.get(token) || 0;
    overlap += Math.min(count1, count2);
  }

  const maxLen = Math.max(len1, len2);
  return overlap / maxLen;
}

/**
 * Deterministic tie-breaking: determines if candidate A is better than candidate B.
 *
 * Precedence (in order):
 * 1. Most recent timestamp (lastSeenAt > publishedAt > updatedAt)
 * 2. Smallest id (stable tie-breaker)
 *
 * @param a - First candidate
 * @param b - Second candidate
 * @returns true if A is better than B
 */
function isCandidateBetter(a: RepostCandidate, b: RepostCandidate): boolean {
  // Get most recent timestamp for each candidate
  const timestampA = getMostRecentTimestamp(a);
  const timestampB = getMostRecentTimestamp(b);

  // Compare timestamps (more recent is better)
  if (timestampA && timestampB) {
    const comparison = timestampA.localeCompare(timestampB);
    if (comparison !== 0) {
      return comparison > 0; // A is more recent
    }
  } else if (timestampA) {
    return true; // A has timestamp, B doesn't
  } else if (timestampB) {
    return false; // B has timestamp, A doesn't
  }

  // Tie-break by smallest id
  return a.id < b.id;
}

/**
 * Gets the most recent timestamp from a candidate's available timestamps.
 *
 * Priority: lastSeenAt > publishedAt > updatedAt
 *
 * @param candidate - Candidate to extract timestamp from
 * @returns Most recent timestamp or null if none available
 */
function getMostRecentTimestamp(candidate: RepostCandidate): string | null {
  return (
    candidate.lastSeenAt || candidate.publishedAt || candidate.updatedAt || null
  );
}
