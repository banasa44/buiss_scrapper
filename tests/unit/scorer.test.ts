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
  BUCKET_CAPS,
  FX_CORE_THRESHOLD,
} from "@/constants/scoring";

/**
 * Minimal test catalog for scoring with bucketed categories
 */
function createTestCatalog(): CatalogRuntime {
  return {
    version: "0.0.0-test",
    categories: new Map([
      [
        "cat_fx_currency",
        {
          id: "cat_fx_currency",
          name: "FX Currency (Direct FX)",
          tier: 3,
        },
      ],
      [
        "cat_intl_market",
        {
          id: "cat_intl_market",
          name: "International Market",
          tier: 2,
        },
      ],
      [
        "cat_biz_saas",
        {
          id: "cat_biz_saas",
          name: "Business SaaS",
          tier: 2,
        },
      ],
      [
        "cat_proxy_cloud",
        {
          id: "cat_proxy_cloud",
          name: "Cloud Proxy",
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
    expect(result.reasons.bucketScores).toEqual({
      direct_fx: 0,
      intl_footprint: 0,
      business_model: 0,
      tech_proxy: 0,
    });
    expect(result.reasons.fxCore).toBe(false);
    expect(result.reasons.appliedNoFxGuard).toBe(true);
  });

  it("should clamp score to MAX_SCORE when raw score exceeds it", () => {
    // Create hits from multiple categories + tier 3 phrase to exceed MAX_SCORE
    const hits: MatchHit[] = [
      {
        keywordId: "kw_fx1",
        categoryId: "cat_fx_currency",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_intl",
        categoryId: "cat_intl_market",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
      {
        keywordId: "kw_biz",
        categoryId: "cat_biz_saas",
        field: "title",
        tokenIndex: 2,
        matchedTokens: ["test3"],
        isNegated: false,
      },
    ];

    // Add tier 3 phrases to achieve fxCore and exceed MAX_SCORE
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
    expect(result.reasons.fxCore).toBe(true); // FX category hits present
    expect(result.reasons.appliedNoFxGuard).toBe(false); // fxCore = true, no guard
  });

  it("should compute score using tier weight × field weight formula and bucket it", () => {
    const hit: MatchHit = {
      keywordId: "kw_fx",
      categoryId: "cat_fx_currency",
      field: "title",
      tokenIndex: 0,
      matchedTokens: ["test"],
      isNegated: false,
    };

    const matchResult = createMatchResult([hit]);
    const result = scoreOffer(matchResult, catalog);

    // cat_fx_currency: tier 3 × title = 4.0 × 1.5 = 6.0
    // Should be in direct_fx bucket
    const expectedCategoryScore = TIER_WEIGHTS[3] * FIELD_WEIGHTS.title;
    expect(result.reasons.categories[0].points).toBe(expectedCategoryScore);
    expect(result.reasons.bucketScores?.direct_fx).toBe(expectedCategoryScore);
    expect(result.reasons.fxCore).toBe(true); // 6.0 >= 2.0 threshold
    expect(result.reasons.appliedNoFxGuard).toBe(false);
  });

  it("should NOT stack points for multiple hits from same category", () => {
    // Create 3 hits from same FX category with different field weights
    const hits: MatchHit[] = [
      {
        keywordId: "kw_1",
        categoryId: "cat_fx_currency",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_2",
        categoryId: "cat_fx_currency",
        field: "description",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
      {
        keywordId: "kw_3",
        categoryId: "cat_fx_currency",
        field: "description",
        tokenIndex: 2,
        matchedTokens: ["test3"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, catalog);

    // Should only count highest: tier3 × title (not stacked)
    const expectedCategoryScore = TIER_WEIGHTS[3] * FIELD_WEIGHTS.title;
    expect(result.reasons.categories).toHaveLength(1);
    expect(result.reasons.categories[0].hitCount).toBe(3);
    expect(result.reasons.categories[0].points).toBe(expectedCategoryScore);
    expect(result.reasons.bucketScores?.direct_fx).toBe(expectedCategoryScore);
    expect(result.reasons.fxCore).toBe(true); // 6.0 >= 2.0
  });

  it("should sum points from multiple different categories into buckets", () => {
    const hits: MatchHit[] = [
      {
        keywordId: "kw_fx",
        categoryId: "cat_fx_currency",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_intl",
        categoryId: "cat_intl_market",
        field: "description",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
      {
        keywordId: "kw_proxy",
        categoryId: "cat_proxy_cloud",
        field: "description",
        tokenIndex: 2,
        matchedTokens: ["test3"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, catalog);

    expect(result.reasons.categories).toHaveLength(3);
    // FX category should trigger fxCore
    expect(result.reasons.fxCore).toBe(true);
    expect(result.reasons.appliedNoFxGuard).toBe(false);
    // Check buckets are populated
    expect(result.reasons.bucketScores?.direct_fx).toBeGreaterThan(0);
    expect(result.reasons.bucketScores?.intl_footprint).toBeGreaterThan(0);
    expect(result.reasons.bucketScores?.tech_proxy).toBeGreaterThan(0);
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
        categoryId: "cat_fx_currency",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: true,
      },
      {
        keywordId: "kw_active",
        categoryId: "cat_intl_market",
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

    // Should only score active tier2 keyword (intl_footprint) + active phrase (tier 2)
    const expectedScore = Math.round(
      TIER_WEIGHTS[2] * FIELD_WEIGHTS.description +
        PHRASE_TIER_WEIGHTS[2] * FIELD_WEIGHTS.description,
    );
    expect(result.reasons.negatedKeywordHits).toBe(1);
    expect(result.reasons.negatedPhraseHits).toBe(1);
    expect(result.reasons.categories).toHaveLength(1);
    expect(result.reasons.categories[0].categoryId).toBe("cat_intl_market");
    expect(result.reasons.phrases).toHaveLength(1);
    expect(result.score).toBe(expectedScore);
    // No FX hits, so fxCore should be false
    expect(result.reasons.fxCore).toBe(false);
    expect(result.reasons.appliedNoFxGuard).toBe(true);
  });

  it("should select category with highest points as topCategoryId", () => {
    const hits: MatchHit[] = [
      {
        keywordId: "kw_proxy",
        categoryId: "cat_proxy_cloud",
        field: "description",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_fx",
        categoryId: "cat_fx_currency",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, catalog);

    // FX category in title has highest points (tier 3 × 1.5 = 6.0)
    expect(result.topCategoryId).toBe("cat_fx_currency");
  });

  // New tests for Scoring V2 - Increment 3: Bucketed scoring

  it("should apply bucket caps when category points exceed limits", () => {
    // Create multiple FX hits that would exceed direct_fx cap (7.0)
    const hits: MatchHit[] = [
      {
        keywordId: "kw_fx1",
        categoryId: "cat_fx_currency",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test1"],
        isNegated: false,
      },
      {
        keywordId: "kw_fx2",
        categoryId: "cat_fx_payments",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["test2"],
        isNegated: false,
      },
    ];

    // Add cat_fx_payments to catalog temporarily for this test
    const extendedCatalog = createTestCatalog();
    extendedCatalog.categories.set("cat_fx_payments", {
      id: "cat_fx_payments",
      name: "FX Payments",
      tier: 3,
    });

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, extendedCatalog);

    // Raw FX points = 2 × (4.0 × 1.5) = 12.0
    // Should be capped at BUCKET_CAPS.direct_fx = 7.0
    expect(result.reasons.bucketScores?.direct_fx).toBe(BUCKET_CAPS.direct_fx);
    expect(result.reasons.fxCore).toBe(true); // 12.0 >= 2.0 before cap
  });

  it("should set fxCore=true when direct_fx bucket >= FX_CORE_THRESHOLD", () => {
    const hits: MatchHit[] = [
      {
        keywordId: "kw_fx",
        categoryId: "cat_fx_currency",
        field: "description",
        tokenIndex: 0,
        matchedTokens: ["test"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, catalog);

    // FX in description: 4.0 × 1.0 = 4.0 >= 2.0 threshold
    expect(result.reasons.bucketScores?.direct_fx).toBe(4.0);
    expect(result.reasons.fxCore).toBe(true);
    expect(result.reasons.appliedNoFxGuard).toBe(false);
  });

  it("should set fxCore=false when direct_fx bucket < FX_CORE_THRESHOLD", () => {
    const hits: MatchHit[] = [
      {
        keywordId: "kw_intl",
        categoryId: "cat_intl_market",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["test"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, catalog);

    // Only intl_footprint, no direct_fx
    expect(result.reasons.bucketScores?.direct_fx).toBe(0);
    expect(result.reasons.fxCore).toBe(false);
    expect(result.reasons.appliedNoFxGuard).toBe(true);
    // Score should be capped at 5.0
    expect(result.score).toBeLessThanOrEqual(5);
  });

  it("should apply no-FX guard (cap at 5.0) when fxCore=false", () => {
    // Tech-only offer with multiple proxy categories
    const hits: MatchHit[] = [
      {
        keywordId: "kw_cloud",
        categoryId: "cat_proxy_cloud",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["aws"],
        isNegated: false,
      },
      {
        keywordId: "kw_intl",
        categoryId: "cat_intl_market",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["global"],
        isNegated: false,
      },
      {
        keywordId: "kw_biz",
        categoryId: "cat_biz_saas",
        field: "title",
        tokenIndex: 2,
        matchedTokens: ["saas"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits);
    const result = scoreOffer(matchResult, catalog);

    // No FX bucket hits, so fxCore = false
    expect(result.reasons.fxCore).toBe(false);
    expect(result.reasons.appliedNoFxGuard).toBe(true);
    // Score should be capped at 5.0 even if raw score higher
    expect(result.score).toBeLessThanOrEqual(5);
    expect(result.reasons.rawScore).toBeLessThanOrEqual(5.0);
  });

  it("should NOT apply no-FX guard when fxCore=true", () => {
    const hits: MatchHit[] = [
      {
        keywordId: "kw_fx",
        categoryId: "cat_fx_currency",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["usd"],
        isNegated: false,
      },
      {
        keywordId: "kw_intl",
        categoryId: "cat_intl_market",
        field: "title",
        tokenIndex: 1,
        matchedTokens: ["global"],
        isNegated: false,
      },
    ];

    const phraseHits: PhraseMatchHit[] = [
      {
        phraseId: "phrase_1",
        field: "title",
        tokenIndex: 5,
        matchedTokens: ["usd"],
        isNegated: false,
      },
    ];

    const matchResult = createMatchResult(hits, phraseHits);
    const result = scoreOffer(matchResult, catalog);

    // FX bucket >= 2.0, so fxCore = true
    expect(result.reasons.fxCore).toBe(true);
    expect(result.reasons.appliedNoFxGuard).toBe(false);
    // Score can exceed 5.0
    expect(result.score).toBeGreaterThan(5);
  });
});
