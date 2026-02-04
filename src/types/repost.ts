/**
 * Repost/duplicate detection types
 *
 * Types for deterministic repost detection logic.
 * Used by the pure repost detection function to identify duplicate offers.
 */

/**
 * Minimal candidate offer data needed for repost detection comparison.
 *
 * Represents an existing canonical offer that might match an incoming offer.
 * All fields are optional/nullable to handle real-world data quality issues.
 */
export type RepostCandidate = {
  /** Database ID of the candidate offer */
  id: number;

  /** Title of the offer (used for exact match fast-path) */
  title?: string | null;

  /** Description of the offer (used for similarity fallback) */
  description?: string | null;

  /** Last time this offer was seen (used for tie-breaking) */
  lastSeenAt?: string | null;

  /** Original publication timestamp (used for tie-breaking) */
  publishedAt?: string | null;

  /** Last update timestamp (used for tie-breaking) */
  updatedAt?: string | null;
};

/**
 * Result of repost detection analysis.
 *
 * A discriminated union indicating whether an incoming offer is a duplicate
 * of an existing canonical offer, and why.
 */
export type DuplicateDecision =
  | {
      kind: "duplicate";
      /** ID of the canonical offer that the incoming offer duplicates */
      canonicalOfferId: number;
      /** Detection method used */
      reason: "exact_title" | "desc_similarity";
      /** Similarity score (0-1) when using desc_similarity; undefined for exact_title */
      similarity?: number;
      /** Number of candidates evaluated (for debugging/telemetry) */
      matchedCandidateCount?: number;
    }
  | {
      kind: "not_duplicate";
      /** Why the offer was not identified as a duplicate */
      reason:
        | "no_candidates" // No candidates to compare against
        | "missing_description" // Incoming offer lacks description for fallback
        | "desc_below_threshold" // Description similarity below threshold
        | "title_mismatch"; // Titles don't match and no desc comparison applicable
    };

/**
 * Minimal offer data needed to compute a content fingerprint.
 *
 * Used by fingerprint computation to generate deterministic SHA-256 hashes
 * of normalized offer content for fast-path repost detection.
 */
export type OfferFingerprintInput = {
  /** Offer title */
  title?: string | null;
  /** Offer description */
  description?: string | null;
};
