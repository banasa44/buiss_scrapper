/**
 * Keyword matcher implementation
 *
 * Matches job offers against the compiled catalog to detect USD/FX signals.
 *
 * Current scope (M3.3b):
 * - Single-token and multi-token keyword aliases
 * - Consecutive token sequence matching for multi-token aliases
 * - Phrase boost matching (separate from keyword hits)
 * - Negation annotation (inline at match time)
 * - Token boundary matching via tokenization
 */

import type { CatalogRuntime } from "@/types/catalog";
import type { JobOfferDetail } from "@/types/clients/job_offers";
import type {
  MatchResult,
  MatchHit,
  MatchField,
  PhraseMatchHit,
} from "@/types/matching";
import { normalizeToTokens } from "@/utils/text/textNormalization";
import { isNegated } from "./negation";

/**
 * Matches a single text field against the catalog keywords.
 *
 * Matches both single-token and multi-token keyword aliases using
 * consecutive token sequence matching.
 *
 * Token boundary matching is naturally enforced by tokenization:
 * - Each token is an atomic unit
 * - Single-token: match when token equals alias token exactly
 * - Multi-token: match when consecutive tokens equal alias sequence exactly
 *
 * Optimization: For multi-token aliases, only check full sequence when
 * the first token matches, avoiding unnecessary comparisons.
 *
 * @param tokens - Normalized token array from offer field
 * @param catalog - Compiled runtime catalog
 * @param field - Which offer field these tokens came from
 * @returns Array of match hits for this field
 */
function matchField(
  tokens: string[],
  catalog: CatalogRuntime,
  field: MatchField,
): MatchHit[] {
  const hits: MatchHit[] = [];

  // For each token position in the offer text
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];

    // Check against all keyword aliases
    for (const keyword of catalog.keywords) {
      const aliasTokens = keyword.aliasTokens;
      const aliasLength = aliasTokens.length;

      // Quick check: first token must match
      if (token !== aliasTokens[0]) {
        continue;
      }

      // Single-token alias: we already matched
      if (aliasLength === 1) {
        hits.push({
          keywordId: keyword.id,
          categoryId: keyword.categoryId,
          field,
          tokenIndex,
          matchedTokens: [token],
          isNegated: isNegated(tokens, tokenIndex, 1),
        });
        continue;
      }

      // Multi-token alias: check if we have enough remaining tokens
      if (tokenIndex + aliasLength > tokens.length) {
        continue;
      }

      // Multi-token alias: check consecutive token sequence
      let isMatch = true;
      for (let j = 1; j < aliasLength; j++) {
        if (tokens[tokenIndex + j] !== aliasTokens[j]) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        hits.push({
          keywordId: keyword.id,
          categoryId: keyword.categoryId,
          field,
          tokenIndex,
          matchedTokens: aliasTokens.slice(), // Copy the matched sequence
          isNegated: isNegated(tokens, tokenIndex, aliasLength),
        });
      }
    }
  }

  return hits;
}

/**
 * Matches a single text field against the catalog phrases.
 *
 * Phrases are matched using exact consecutive token sequence matching,
 * similar to multi-token keyword aliases.
 *
 * @param tokens - Normalized token array from offer field
 * @param catalog - Compiled runtime catalog
 * @param field - Which offer field these tokens came from (title or description only)
 * @returns Array of phrase match hits for this field
 */
function matchPhrases(
  tokens: string[],
  catalog: CatalogRuntime,
  field: "title" | "description",
): PhraseMatchHit[] {
  const phraseHits: PhraseMatchHit[] = [];

  // For each token position in the offer text
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];

    // Check against all catalog phrases
    for (const phrase of catalog.phrases) {
      const phraseTokens = phrase.tokens;
      const phraseLength = phraseTokens.length;

      // Quick check: first token must match
      if (token !== phraseTokens[0]) {
        continue;
      }

      // Single-token phrase: we already matched
      if (phraseLength === 1) {
        phraseHits.push({
          phraseId: phrase.id,
          field,
          tokenIndex,
          matchedTokens: [token],
          isNegated: isNegated(tokens, tokenIndex, 1),
        });
        continue;
      }

      // Multi-token phrase: check if we have enough remaining tokens
      if (tokenIndex + phraseLength > tokens.length) {
        continue;
      }

      // Multi-token phrase: check consecutive token sequence
      let isMatch = true;
      for (let j = 1; j < phraseLength; j++) {
        if (tokens[tokenIndex + j] !== phraseTokens[j]) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        phraseHits.push({
          phraseId: phrase.id,
          field,
          tokenIndex,
          matchedTokens: phraseTokens.slice(), // Copy the matched sequence
          isNegated: isNegated(tokens, tokenIndex, phraseLength),
        });
      }
    }
  }

  return phraseHits;
}

/**
 * Matches a job offer against the catalog to detect keyword hits and phrase hits.
 *
 * Current implementation (M3.2c):
 * - Matches title and description only (company name excluded to reduce false positives)
 * - Both single-token and multi-token keyword aliases
 * - Phrase boost matching (separate phraseHits array)
 * - Consecutive token sequence matching for multi-token aliases and phrases
 * - No negation handling
 * - All hits are preserved (no deduplication or aggregation)
 *
 * Deduplication and scoring happen in later pipeline stages.
 *
 * @param offer - Job offer to match against catalog
 * @param catalog - Compiled runtime catalog
 * @returns Match result with all detected keyword hits, phrase hits, and metadata
 */
export function matchOffer(
  offer: JobOfferDetail,
  catalog: CatalogRuntime,
): MatchResult {
  const allHits: MatchHit[] = [];
  const allPhraseHits: PhraseMatchHit[] = [];

  // Match title
  if (offer.title) {
    const titleTokens = normalizeToTokens(offer.title);
    const titleHits = matchField(titleTokens, catalog, "title");
    allHits.push(...titleHits);

    // Match phrases in title
    const titlePhraseHits = matchPhrases(titleTokens, catalog, "title");
    allPhraseHits.push(...titlePhraseHits);
  }

  // Match description
  if (offer.description) {
    const descTokens = normalizeToTokens(offer.description);
    const descHits = matchField(descTokens, catalog, "description");
    allHits.push(...descHits);

    // Match phrases in description
    const descPhraseHits = matchPhrases(descTokens, catalog, "description");
    allPhraseHits.push(...descPhraseHits);
  }

  // Company name matching disabled to reduce false positives
  // (company names often contain keywords like "Stripe", "Salesforce", etc.
  // which are product/service names, not signals of USD exposure)

  // Compute metadata for quick filtering
  const uniqueCategories = new Set(allHits.map((h) => h.categoryId)).size;
  const uniqueKeywords = new Set(allHits.map((h) => h.keywordId)).size;

  return {
    keywordHits: allHits,
    phraseHits: allPhraseHits,
    uniqueCategories,
    uniqueKeywords,
  };
}
