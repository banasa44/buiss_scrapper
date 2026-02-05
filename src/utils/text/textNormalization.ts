/**
 * Text normalization and tokenization utilities
 *
 * Provides deterministic text processing for catalog compilation
 * and offer matching. The normalization is minimal and does NOT
 * include stopword removal, stemming, or lemmatization.
 *
 * Key design decisions:
 * - Preserves negation tokens (no, sin, not, without) - required for later negation handling
 * - Uses Unicode normalization (NFD) for diacritic removal
 * - Splits on whitespace and common technical separators
 * - No linguistic analysis or language detection
 */

import { TOKEN_SEPARATOR_PATTERN } from "@/constants/textNormalization";

/**
 * Removes diacritics from a string using Unicode normalization.
 *
 * Uses NFD (Canonical Decomposition) to separate base characters from
 * combining diacritical marks, then removes the marks (U+0300-U+036F).
 * This approach is more comprehensive than manual mapping.
 *
 * @param text - Input text with potential diacritics
 * @returns Text with diacritics replaced by ASCII characters
 *
 * @example
 * removeDiacritics("café") // "cafe"
 * removeDiacritics("niño") // "nino"
 * removeDiacritics("José") // "Jose"
 */
function removeDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalizes text and splits it into tokens.
 *
 * Normalization steps (applied in order):
 * 1. Lowercase the text
 * 2. Remove diacritics (e.g., á → a)
 * 3. Split on whitespace and common separators (see TOKEN_SEPARATOR_PATTERN)
 * 4. Remove empty tokens
 *
 * What this does NOT do:
 * - Stopword removal (including negation tokens like "no", "sin", "not", "without")
 * - Stemming or lemmatization
 * - Language detection or language-specific processing
 *
 * @param text - Input text to normalize and tokenize
 * @returns Array of normalized tokens (lowercased, no diacritics, no empty strings)
 *
 * @example
 * normalizeToTokens("Full-Stack Developer (C++/Python)")
 * // ["full", "stack", "developer", "c++", "python"]
 *
 * normalizeToTokens("Desarrollador sin experiencia")
 * // ["desarrollador", "sin", "experiencia"]
 * // Note: "sin" (without) is preserved as a negation token
 *
 * normalizeToTokens("José, café, niño")
 * // ["jose", "cafe", "nino"]
 */
export function normalizeToTokens(text: string): string[] {
  // Step 1: Lowercase
  const lowercased = text.toLowerCase();

  // Step 2: Remove diacritics
  const normalized = removeDiacritics(lowercased);

  // Step 3: Split on separators
  const tokens = normalized.split(TOKEN_SEPARATOR_PATTERN);

  // Step 4: Remove empty tokens
  return tokens.filter((token) => token.length > 0);
}
