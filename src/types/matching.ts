/**
 * Matching type definitions
 *
 * Types for keyword matching results produced by the matcher.
 * Matcher detects keyword hits in offer text and produces
 * explainable structured output for downstream scoring.
 */

/**
 * Field in which a keyword match was found.
 *
 * Field ordering matches conceptual priority for scoring:
 * - title: strongest signal (primary offer description)
 * - description: detailed context
 * - company: company-level signal
 */
export type MatchField = "title" | "description" | "company";

/**
 * Single keyword match hit.
 *
 * Records where and how a keyword was detected in the offer text.
 * Contains enough detail for later negation handling and explainability.
 */
export type MatchHit = {
  /** Unique keyword identifier from catalog */
  keywordId: string;
  /** Category this keyword belongs to */
  categoryId: string;
  /** Which offer field contained the match */
  field: MatchField;
  /** Position (index) in the normalized token array where match occurred */
  tokenIndex: number;
  /** Matched token sequence (normalized form) */
  matchedTokens: string[];
  /** Whether this hit appears in a negated context */
  isNegated: boolean;
};

/**
 * Single phrase match hit.
 *
 * Records where and how a phrase was detected in the offer text.
 * Phrases provide scoring boosts independent of keyword category matches.
 */
export type PhraseMatchHit = {
  /** Unique phrase identifier from catalog */
  phraseId: string;
  /** Which offer field contained the match (title or description only) */
  field: "title" | "description";
  /** Position (index) in the normalized token array where match occurred */
  tokenIndex: number;
  /** Matched token sequence (normalized form) */
  matchedTokens: string[];
  /** Whether this hit appears in a negated context */
  isNegated: boolean;
};

/**
 * Complete matching result for a single job offer.
 *
 * Contains all detected keyword hits and phrase hits across all fields.
 * Multiple hits from the same category are preserved (aggregation
 * and deduplication happens in scoring, not matching).
 */
export type MatchResult = {
  /** All keyword hits detected in this offer */
  keywordHits: MatchHit[];
  /** All phrase hits detected in this offer */
  phraseHits: PhraseMatchHit[];
  /** Number of unique categories matched (for quick filtering) */
  uniqueCategories: number;
  /** Number of unique keywords matched (for explainability) */
  uniqueKeywords: number;
};
