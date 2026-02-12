/**
 * Unit tests for offer scorer
 *
 * Tests the scoreOffer function that converts MatchResult into ScoreResult.
 * Constructs MatchResult objects directly without calling the matcher.
 *
 * No DB, no network, no side effects
 */

import { describe, it, expect } from "vitest";
import { scoreOffer } from "@/signal/scorer";
import type { CatalogRuntime } from "@/types/catalog";
import type { MatchResult, MatchHit, PhraseMatchHit } from "@/types/matching";
import {
  TIER_WEIGHTS,
  FIELD_WEIGHTS,
  PHRASE_TIER_WEIGHTS,
  MAX_SCORE,
} from "@/constants/scoring";

/**
 * Minimal test catalog for scoring
 */
function createTestCatalog(): CatalogRuntime {
  return {
    version: "0.0.0-test",
    categories: new Map([
      [
        "cat_tier3",
        {
          id: "cat_tier3",
          name: "Tier 3 Category",
          tier: 3,
        },
      ],
      [
        "cat_tier2",
        {
          id: "cat_tier2",
          name: "Tier 2 Category",
          tier: 2,
        },
      ],
      [
        "cat_tier1",
        {
          id: "cat_tier1",
          name: "Tier 1 Category",
          tier: 1,
        },
      ],
    ]),
    keywords: [],
    phrases: [
      {
        id: "phrase_1",
        tokens: ["usd"],
        tier: 3,
      },
      {
        id: "phrase_2",
        tokens: ["intl"],
        tier: 2,
      },
      {
        id: "phrase_negated",
        tokens: ["no"],
        tier: 3,
      },
      {
        id: "phrase_active",
        tokens: ["yes"],
        tier: 2,
      },
    ],
  };
}

/**
 * Helper to create minimal MatchResult
 */
function createMatchResult(
  keywordHits: MatchHit[] = [],
  phraseHits: PhraseMatchHit[] = [],
): MatchResult {
  const uniqueCategories = new Set(keywordHits.map((h) => h.categoryId)).size;
  const uniqueKeywords = new Set(keywordHits.map((h) => h.keywordId)).size;

  return {
    keywordHits,
    phraseHits,
    uniqueCategories,
    uniqueKeywords,
  };
}

describe("scoreOffer", () => {
  const catalog = createTestCatalog();

  it("should return score 0 and empty topCategoryId when no hits", () => {
    const matchResult = createMatchResult();
    const result = scoreOffer(matchResult, catalog);

    expect(result.score).toBe(0);
    expect(result.topCategoryId).toBe("");
    expect(result.reasons.rawScore).toBe(0);
  });

  it("should clamp score to MAX_SCORE when raw score exceeds it", () => {
    // Create hits from multiple categories + tier 3 phrase to exceed MAX_SCORE
    const hits: MatchHit[] = [
      {
        keywordId: "kw_tier3",
        categoryId: "cat_tier3",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_tier2",
        categoryId: "cat_tier2",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
      {
        keywordId: "kw_tier1",
        categoryId: "cat_tier1",
        field: "title",
        tokenIndex: 2,
        matchedTokens: ["test3"],
        isNegated: false,
      },
    ];

    // Add tier 3 phrase to bypass no-FX guard
    const phraseHits: PhraseMatchHit[] = [
      {
        phraseId: "phrase_1",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["usd"],
        isNegated: false,
      },
      {
        phraseId: "phrase_2",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["intl"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits, phraseHits);
    const result = scoreOffer(matchResult, catalog);

    expect(result.reasons.rawScore).toBeGreaterThan(MAX_SCORE);
    expect(result.score).toBe(MAX_SCORE);
  });

  it("should compute score using tier weight × field weight formula", () => {
    const hit: MatchHit = {
      keywordId: "kw_test",
      categoryId: "cat_tier3",
      field: "title",
      tokenIndex: 0,
      matchedTokens: ["test"],
      isNegated: false,
    };

    // Add tier 3 phrase to bypass no-FX guard
    const phraseHit: PhraseMatchHit = {
      phraseId: "phrase_1",
      field: "title",
      tokenIndex: 5,
      matchedTokens: ["usd"],
      isNegated: false,
    };

    const matchResult = createMatchResult([hit], [phraseHit]);
    const result = scoreOffer(matchResult, catalog);

    // tier3 × title = TIER_WEIGHTS[3] × FIELD_WEIGHTS.title (category only)
    const expectedCategoryScore = TIER_WEIGHTS[3] * FIELD_WEIGHTS.title;
    expect(result.reasons.categories[0].points).toBe(expectedCategoryScore);
    // Total includes phrase tier 3 in title
    const expectedTotalScore =
      expectedCategoryScore + PHRASE_TIER_WEIGHTS[3] * FIELD_WEIGHTS.title;
    expect(result.score).toBe(Math.round(expectedTotalScore));
  });

  it("should NOT stack points for multiple hits from same category", () => {
    // Create 3 hits from same category with different field weights
    const hits: MatchHit[] = [
      {
        keywordId: "kw_1",
        categoryId: "cat_tier3",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_2",
        categoryId: "cat_tier3",
        field: "description",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
      {
        keywordId: "kw_3",
        categoryId: "cat_tier3",
        field: "description",
        tokenIndex: 2,
        matchedTokens: ["test3"],
        isNegated: false,
      },
    ];

    // Add tier 3 phrase to bypass no-FX guard
    const phraseHit: PhraseMatchHit = {
      phraseId: "phrase_1",
      field: "description",
      tokenIndex: 10,
      matchedTokens: ["usd"],
      isNegated: false,
    };

    const matchResult = createMatchResult(hits, [phraseHit]);
    const result = scoreOffer(matchResult, catalog);

    // Should only count highest category: tier3 × title (not stacked)
    const expectedCategoryScore = TIER_WEIGHTS[3] * FIELD_WEIGHTS.title;
    expect(result.reasons.categories).toHaveLength(1);
    expect(result.reasons.categories[0].hitCount).toBe(3);
    expect(result.reasons.categories[0].points).toBe(expectedCategoryScore);
  });

  it("should sum points from multiple different categories", () => {
    const hits: MatchHit[] = [
      {
        keywordId: "kw_tier3",
        categoryId: "cat_tier3",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_tier2",
        categoryId: "cat_tier2",
        field: "description",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
      {
        keywordId: "kw_tier1",
        categoryId: "cat_tier1",
        field: "description",
        tokenIndex: 2,
        matchedTokens: ["test3"],
        isNegated: false,
      },
    ];

    // Add tier 3 phrase to bypass no-FX guard
    const phraseHit: PhraseMatchHit = {
      phraseId: "phrase_1",
      field: "title",
      tokenIndex: 5,
      matchedTokens: ["usd"],
      isNegated: false,
    };

    const matchResult = createMatchResult(hits, [phraseHit]);
    const result = scoreOffer(matchResult, catalog);

    // (tier3×title) + (tier2×description) + (tier1×description)
    const expectedRaw =
      TIER_WEIGHTS[3] * FIELD_WEIGHTS.title +
      TIER_WEIGHTS[2] * FIELD_WEIGHTS.description +
      TIER_WEIGHTS[1] * FIELD_WEIGHTS.description;
    const expectedScore = Math.min(Math.round(expectedRaw), MAX_SCORE);
    expect(result.reasons.categories).toHaveLength(3);
    expect(result.score).toBe(expectedScore);
  });

  it("should apply phrase boosts without stacking per unique phrase", () => {
    // Same phrase appears 3 times, should only count once
    // phrase_1 is tier 3, title has field weight 1.5
    const phraseHits: PhraseMatchHit[] = [
      {
        phraseId: "phrase_1",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["usd"],
        isNegated: false,
      },
      {
        phraseId: "phrase_1",
        field: "description",
        tokenIndex: 5,
        matchedTokens: ["usd"],
        isNegated: false,
      },
      {
        phraseId: "phrase_1",
        field: "description",
        tokenIndex: 10,
        matchedTokens: ["usd"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult([], phraseHits);
    const result = scoreOffer(matchResult, catalog);

    // phrase_1 is tier 3, best field is title (1.5)
    const expectedPoints = PHRASE_TIER_WEIGHTS[3] * FIELD_WEIGHTS.title;
    expect(result.reasons.phrases).toHaveLength(1);
    expect(result.reasons.phrases[0].hitCount).toBe(3);
    expect(result.reasons.phrases[0].points).toBe(expectedPoints);
    expect(result.score).toBe(Math.round(expectedPoints));
  });

  it("should sum points from multiple different phrases", () => {
    // phrase_1 is tier 3, phrase_2 is tier 2
    const phraseHits: PhraseMatchHit[] = [
      {
        phraseId: "phrase_1",
        field: "description",
        tokenIndex: 0,
        matchedTokens: ["usd"],
        isNegated: false,
      },
      {
        phraseId: "phrase_2",
        field: "description",
        tokenIndex: 5,
        matchedTokens: ["intl"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult([], phraseHits);
    const result = scoreOffer(matchResult, catalog);

    const expectedPoints =
      PHRASE_TIER_WEIGHTS[3] * FIELD_WEIGHTS.description +
      PHRASE_TIER_WEIGHTS[2] * FIELD_WEIGHTS.description;
    expect(result.reasons.phrases).toHaveLength(2);
    expect(result.score).toBe(Math.round(expectedPoints));
  });

  it("should exclude negated hits from scoring (both keywords and phrases)", () => {
    const keywordHits: MatchHit[] = [
      {
        keywordId: "kw_negated",
        categoryId: "cat_tier3",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: true,
      },
      {
        keywordId: "kw_active",
        categoryId: "cat_tier2",
        field: "description",
        tokenIndex: 5,
        matchedTokens: ["test2"],
        isNegated: false,
      },
    ];

    const phraseHits: PhraseMatchHit[] = [
      {
        phraseId: "phrase_negated",
        field: "description",
        tokenIndex: 0,
        matchedTokens: ["usd"],
        isNegated: true,
      },
      {
        phraseId: "phrase_active",
        field: "description",
        tokenIndex: 10,
        matchedTokens: ["intl"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(keywordHits, phraseHits);
    const result = scoreOffer(matchResult, catalog);

    // Should only score active tier2 keyword + active phrase (tier 2)
    const expectedScore = Math.round(
      TIER_WEIGHTS[2] * FIELD_WEIGHTS.description +
        PHRASE_TIER_WEIGHTS[2] * FIELD_WEIGHTS.description,
    );
    expect(result.reasons.negatedKeywordHits).toBe(1);
    expect(result.reasons.negatedPhraseHits).toBe(1);
    expect(result.reasons.categories).toHaveLength(1);
    expect(result.reasons.categories[0].categoryId).toBe("cat_tier2");
    expect(result.reasons.phrases).toHaveLength(1);
    expect(result.score).toBe(expectedScore);
  });

  it("should select category with highest points as topCategoryId", () => {
    const hits: MatchHit[] = [
      {
        keywordId: "kw_tier1",
        categoryId: "cat_tier1",
        field: "description",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_tier3",
        categoryId: "cat_tier3",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, catalog);

    // Tier3 in title has highest points (6.0)
    expect(result.topCategoryId).toBe("cat_tier3");
  });
});
