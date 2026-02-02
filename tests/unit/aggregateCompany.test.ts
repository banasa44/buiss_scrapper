/**
 * Unit tests for company aggregation (pure function)
 *
 * Tests the aggregateCompany function that aggregates scored offers
 * into company-level signals (M4).
 *
 * No DB, no network, no side effects
 */

import { describe, it, expect } from "vitest";
import {
  aggregateCompany,
  type AggregatableOffer,
} from "@/signal/aggregation/aggregateCompany";
import { STRONG_THRESHOLD } from "@/constants/scoring";

/**
 * Helper to create minimal AggregatableOffer
 */
function createOffer(
  overrides: Partial<AggregatableOffer> = {},
): AggregatableOffer {
  const score = overrides.score ?? 0;
  return {
    offerId: 1,
    score,
    categoryId: null,
    isStrong: score >= STRONG_THRESHOLD,
    publishedAt: null,
    updatedAt: null,
    canonicalOfferId: null, // canonical by default
    repostCount: 0,
    ...overrides,
  };
}

describe("aggregateCompany", () => {
  it("should return default metrics when no offers", () => {
    const result = aggregateCompany([]);

    expect(result).toEqual({
      maxScore: 0,
      offerCount: 0,
      uniqueOfferCount: 0,
      strongOfferCount: 0,
      avgStrongScore: null,
      topCategoryId: null,
      topOfferId: null,
      categoryMaxScores: {},
      lastStrongAt: null,
    });
  });

  it("should return default metrics when only duplicate offers", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, canonicalOfferId: 100, score: 8 }),
      createOffer({ offerId: 2, canonicalOfferId: 100, score: 7 }),
    ];

    const result = aggregateCompany(offers);

    // Duplicates are ignored - same as no canonical offers
    expect(result).toEqual({
      maxScore: 0,
      offerCount: 0,
      uniqueOfferCount: 0,
      strongOfferCount: 0,
      avgStrongScore: null,
      topCategoryId: null,
      topOfferId: null,
      categoryMaxScores: {},
      lastStrongAt: null,
    });
  });

  it("should count only canonical offers in uniqueOfferCount", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, canonicalOfferId: null, score: 5 }), // canonical
      createOffer({ offerId: 2, canonicalOfferId: null, score: 6 }), // canonical
      createOffer({ offerId: 3, canonicalOfferId: 1, score: 7 }), // duplicate of 1
      createOffer({ offerId: 4, canonicalOfferId: 1, score: 8 }), // duplicate of 1
    ];

    const result = aggregateCompany(offers);

    expect(result.uniqueOfferCount).toBe(2); // Only canonical offers
  });

  it("should compute activity-weighted offerCount (sum of 1 + repostCount)", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, repostCount: 3, score: 5 }), // contributes 1 + 3 = 4
      createOffer({ offerId: 2, repostCount: 0, score: 6 }), // contributes 1 + 0 = 1
      createOffer({ offerId: 3, repostCount: 2, score: 7 }), // contributes 1 + 2 = 3
    ];

    const result = aggregateCompany(offers);

    expect(result.offerCount).toBe(8); // 4 + 1 + 3 = 8
  });

  it("should count strong offers correctly (score >= STRONG_THRESHOLD)", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, score: 5, isStrong: false }), // not strong
      createOffer({ offerId: 2, score: 6, isStrong: true }), // strong (at threshold)
      createOffer({ offerId: 3, score: 8, isStrong: true }), // strong
      createOffer({ offerId: 4, score: 10, isStrong: true }), // strong
    ];

    const result = aggregateCompany(offers);

    expect(result.strongOfferCount).toBe(3);
  });

  it("should compute avgStrongScore as simple average (not weighted)", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, score: 5, isStrong: false }), // not strong
      createOffer({ offerId: 2, score: 6, isStrong: true, repostCount: 10 }), // strong
      createOffer({ offerId: 3, score: 8, isStrong: true, repostCount: 0 }), // strong
      createOffer({ offerId: 4, score: 10, isStrong: true, repostCount: 5 }), // strong
    ];

    const result = aggregateCompany(offers);

    // avgStrongScore = (6 + 8 + 10) / 3 = 8.0 (simple average, ignores reposts)
    expect(result.avgStrongScore).toBe(8.0);
    expect(result.strongOfferCount).toBe(3);
  });

  it("should return null for avgStrongScore when no strong offers", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, score: 3, isStrong: false }),
      createOffer({ offerId: 2, score: 5, isStrong: false }),
    ];

    const result = aggregateCompany(offers);

    expect(result.strongOfferCount).toBe(0);
    expect(result.avgStrongScore).toBeNull();
  });

  it("should select topOffer with highest score", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, score: 5, categoryId: "cat_tier1" }),
      createOffer({ offerId: 2, score: 9, categoryId: "cat_tier3" }), // highest score
      createOffer({ offerId: 3, score: 7, categoryId: "cat_tier2" }),
    ];

    const result = aggregateCompany(offers);

    expect(result.maxScore).toBe(9);
    expect(result.topOfferId).toBe(2);
    expect(result.topCategoryId).toBe("cat_tier3");
  });

  it("should use most recent timestamp as tie-breaker for topOffer (publishedAt priority)", () => {
    const offers: AggregatableOffer[] = [
      createOffer({
        offerId: 1,
        score: 8,
        categoryId: "cat_a",
        publishedAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-05T00:00:00Z",
      }),
      createOffer({
        offerId: 2,
        score: 8,
        categoryId: "cat_b",
        publishedAt: "2024-01-10T00:00:00Z", // most recent publishedAt
        updatedAt: "2024-01-02T00:00:00Z",
      }),
      createOffer({
        offerId: 3,
        score: 8,
        categoryId: "cat_c",
        publishedAt: "2024-01-03T00:00:00Z",
        updatedAt: "2024-01-15T00:00:00Z", // most recent updatedAt, but publishedAt has priority
      }),
    ];

    const result = aggregateCompany(offers);

    // Offer 2 wins: same score, most recent publishedAt
    expect(result.topOfferId).toBe(2);
    expect(result.topCategoryId).toBe("cat_b");
  });

  it("should fall back to updatedAt when publishedAt is null in tie-breaker", () => {
    const offers: AggregatableOffer[] = [
      createOffer({
        offerId: 1,
        score: 7,
        publishedAt: null,
        updatedAt: "2024-01-01T00:00:00Z",
      }),
      createOffer({
        offerId: 2,
        score: 7,
        publishedAt: null,
        updatedAt: "2024-01-10T00:00:00Z", // most recent updatedAt
      }),
    ];

    const result = aggregateCompany(offers);

    expect(result.topOfferId).toBe(2);
  });

  it("should use first offer when all have null timestamps in tie-breaker", () => {
    const offers: AggregatableOffer[] = [
      createOffer({
        offerId: 100,
        score: 6,
        publishedAt: null,
        updatedAt: null,
      }),
      createOffer({
        offerId: 200,
        score: 6,
        publishedAt: null,
        updatedAt: null,
      }),
    ];

    const result = aggregateCompany(offers);

    // Deterministic fallback: first offer in array
    expect(result.topOfferId).toBe(100);
  });

  it("should compute categoryMaxScores from canonical offers", () => {
    const offers: AggregatableOffer[] = [
      createOffer({ offerId: 1, score: 5, categoryId: "cat_a" }),
      createOffer({ offerId: 2, score: 8, categoryId: "cat_a" }), // max for cat_a
      createOffer({ offerId: 3, score: 7, categoryId: "cat_b" }), // max for cat_b
      createOffer({ offerId: 4, score: 9, categoryId: "cat_c" }), // max for cat_c
      createOffer({ offerId: 5, score: 10, categoryId: null }), // no category
    ];

    const result = aggregateCompany(offers);

    expect(result.categoryMaxScores).toEqual({
      cat_a: 8,
      cat_b: 7,
      cat_c: 9,
    });
  });

  it("should compute lastStrongAt as most recent strong offer timestamp", () => {
    const offers: AggregatableOffer[] = [
      createOffer({
        offerId: 1,
        score: 7,
        isStrong: true,
        publishedAt: "2024-01-01T00:00:00Z",
      }),
      createOffer({
        offerId: 2,
        score: 8,
        isStrong: true,
        publishedAt: "2024-01-15T00:00:00Z", // most recent strong
      }),
      createOffer({
        offerId: 3,
        score: 5,
        isStrong: false,
        publishedAt: "2024-01-20T00:00:00Z", // not strong
      }),
    ];

    const result = aggregateCompany(offers);

    expect(result.lastStrongAt).toBe("2024-01-15T00:00:00Z");
  });

  it("should return null for lastStrongAt when no strong offers or all have null timestamps", () => {
    const offers: AggregatableOffer[] = [
      createOffer({
        offerId: 1,
        score: 7,
        isStrong: true,
        publishedAt: null,
        updatedAt: null,
      }),
    ];

    const result = aggregateCompany(offers);

    expect(result.lastStrongAt).toBeNull();
  });
});
