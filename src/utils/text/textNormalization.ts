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
import { removeDiacritics } from "@/utils/text/removeDiacritics";

/**
 * Normalizes text and splits it into tokens.
 *
 * Normalization steps (applied in order):
 * 1. Lowercase the text
 * 2. Remove diacritics (e.g., á → a)
 * 3. Split on whitespace and common separators (see TOKEN_SEPARATOR_PATTERN)
 * 4. Inject currency symbol tokens (Matcher Hardening - Increment 1)
 * 5. Remove empty tokens
 *
 * What this does NOT do:
 * - Stopword removal (including negation tokens like "no", "sin", "not", "without")
 * - Stemming or lemmatization
 * - Language detection or language-specific processing
 *
 * Matcher Hardening - Increment 1:
 * - Currency symbols ($, £, €) inject additional tokens (usd, gbp, eur) for better recall
 * - Unicode punctuation (curly quotes, apostrophes) handled like ASCII equivalents
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
 *
 * normalizeToTokens("Salary $100K USD")
 * // ["salary", "$100k", "usd", "usd"]
 * // Note: $ in token triggers "usd" injection
 */
export function normalizeToTokens(text: string): string[] {
  // Step 1: Lowercase
  const lowercased = text.toLowerCase();

  // Step 2: Remove diacritics
  const normalized = removeDiacritics(lowercased);

  // Step 3: Split on separators
  const tokens = normalized.split(TOKEN_SEPARATOR_PATTERN);

  // Step 4: Inject currency symbol tokens (Matcher Hardening - Increment 1)
  const processedTokens: string[] = [];
  for (const token of tokens) {
    if (token.length === 0) continue;

    processedTokens.push(token);

    // Currency symbol detection - inject additional tokens for better recall
    // Note: $ is ambiguous but acceptable for recall (can match peso, USD, etc.)
    if (token.includes("$")) {
      processedTokens.push("usd");
    }
    if (token.includes("£")) {
      processedTokens.push("gbp");
    }
    if (token.includes("€")) {
      processedTokens.push("eur");
    }
  }

  return processedTokens;
}
