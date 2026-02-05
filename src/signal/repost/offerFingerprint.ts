/**
 * Offer content fingerprinting for deterministic duplicate detection
 *
 * Provides a fast-path for repost detection by computing SHA-256 hashes
 * of normalized offer content. If two offers hash to the same fingerprint,
 * they are considered duplicates immediately without expensive similarity
 * computation.
 *
 * The fingerprint is computed from normalized title + description, ensuring
 * that offers with identical semantic content (after normalization) produce
 * identical hashes, regardless of casing, diacritics, or whitespace variations.
 */

import { createHash } from "node:crypto";
import { normalizeToTokens } from "@/utils/text/textNormalization";
import type { OfferFingerprintInput } from "@/types";

/**
 * Compute a deterministic SHA-256 fingerprint of normalized offer content
 *
 * The fingerprint is computed as follows:
 * 1. Normalize title and description using existing normalizeToTokens()
 * 2. Join title tokens with "\n" separator
 * 3. Join description tokens with "\n" separator
 * 4. Concatenate: `${normalizedTitle}\n\n${normalizedDescription}`
 * 5. Compute SHA-256 hex digest
 *
 * If either title or description is missing/empty after normalization,
 * returns null (no fingerprint).
 *
 * **Key properties:**
 * - Deterministic: Same semantic content always produces same hash
 * - Normalization-aware: Case, diacritics, whitespace variations are handled
 * - Safe: Returns null rather than throwing on missing data
 *
 * @param offer - Offer data with title and optional description
 * @returns SHA-256 hex string (64 chars) or null if insufficient data
 *
 * @example
 * // Same content, different formatting -> same fingerprint
 * computeOfferFingerprint({ title: "Senior Developer", description: "We need..." })
 * computeOfferFingerprint({ title: "SENIOR DEVELOPER", description: "We need..." })
 * // Both produce the same hash
 *
 * @example
 * // Missing description -> null
 * computeOfferFingerprint({ title: "Senior Developer" })
 * // => null
 */
export function computeOfferFingerprint(
  offer: OfferFingerprintInput,
): string | null {
  const title = offer.title?.trim() || "";
  const description = offer.description?.trim() || "";

  // Require both title and description for fingerprinting
  if (!title || !description) {
    return null;
  }

  // Normalize title and description to token arrays
  const titleTokens = normalizeToTokens(title);
  const descTokens = normalizeToTokens(description);

  // If either normalizes to empty, return null
  if (titleTokens.length === 0 || descTokens.length === 0) {
    return null;
  }

  // Build canonical text representation:
  // - Join tokens with newlines (normalized separators)
  // - Separate title and description with double newline
  const normalizedTitle = titleTokens.join("\n");
  const normalizedDescription = descTokens.join("\n");
  const canonicalText = `${normalizedTitle}\n\n${normalizedDescription}`;

  // Compute SHA-256 hash
  const hash = createHash("sha256");
  hash.update(canonicalText, "utf8");
  return hash.digest("hex");
}
