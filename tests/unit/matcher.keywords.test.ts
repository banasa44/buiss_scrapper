/**
 * Unit tests for keyword matcher (boundary detection + negation)
 *
 * Tests the matchOffer function's keyword detection logic including:
 * - Token boundary protection
 * - Multi-token keyword matching
 * - Negation integration
 * - Field inclusion (title + description)
 *
 * No DB, no network, no side effects
 */

import { describe, it, expect } from "vitest";
import { matchOffer } from "@/signal/matcher";
import type { CatalogRuntime } from "@/types/catalog";
import type { JobOfferDetail } from "@/types/clients/job_offers";

/**
 * Minimal test catalog fixture
 *
 * Contains 2 categories, 3 keywords (including 1 multi-token), 1 phrase
 * Sufficient to verify boundary, negation, and field behavior
 */
function createTestCatalog(): CatalogRuntime {
  return {
    version: "0.0.0-test",
    categories: new Map([
      [
        "cat_cloud",
        {
          id: "cat_cloud",
          name: "Cloud Infrastructure",
          tier: 3,
        },
      ],
      [
        "cat_ads",
        {
          id: "cat_ads",
          name: "Digital Advertising",
          tier: 2,
        },
      ],
    ]),
    keywords: [
      {
        id: "kw_aws",
        categoryId: "cat_cloud",
        canonical: "AWS",
        aliasTokens: ["aws"], // single-token
      },
      {
        id: "kw_gcp",
        categoryId: "cat_cloud",
        canonical: "GCP",
        aliasTokens: ["gcp"], // single-token
      },
      {
        id: "kw_google_ads",
        categoryId: "cat_ads",
        canonical: "Google Ads",
        aliasTokens: ["google", "ads"], // multi-token
      },
    ],
    phrases: [
      {
        id: "phrase_remote",
        tokens: ["remote", "work"],
        tier: 1,
      },
    ],
  };
}

/**
 * Helper to create minimal job offer for testing
 */
function createTestOffer(
  overrides: Partial<JobOfferDetail> = {},
): JobOfferDetail {
  return {
    ref: {
      provider: "infojobs",
      id: "test-offer-1",
      url: "https://example.com/job/1",
    },
    title: "Test Job",
    description: "Test description",
    company: {
      id: "test-company",
      name: "Test Company",
      websiteUrl: undefined,
    },
    location: {
      city: "Madrid",
      province: { id: 1, value: "Madrid" },
    },
    metadata: {
      category: { id: 1, value: "Technology" },
      contractType: undefined,
      workDay: undefined,
      experienceMin: undefined,
      salary: undefined,
    },
    publishedAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("matchOffer - keyword detection", () => {
  const catalog = createTestCatalog();

  describe("exact single-token match", () => {
    it("should match exact single-token keyword in title", () => {
      const offer = createTestOffer({
        title: "AWS Engineer",
      });

      const result = matchOffer(offer, catalog);

      expect(result.keywordHits).toHaveLength(1);
      expect(result.keywordHits[0]).toMatchObject({
        keywordId: "kw_aws",
        categoryId: "cat_cloud",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["aws"],
        isNegated: false,
      });
    });

    it("should match exact single-token keyword in description", () => {
      const offer = createTestOffer({
        title: "Backend Engineer",
        description: "Experience with GCP required",
      });

      const result = matchOffer(offer, catalog);

      const gcpHit = result.keywordHits.find((h) => h.keywordId === "kw_gcp");
      expect(gcpHit).toBeDefined();
      expect(gcpHit).toMatchObject({
        keywordId: "kw_gcp",
        categoryId: "cat_cloud",
        field: "description",
        matchedTokens: ["gcp"],
        isNegated: false,
      });
    });
  });

  describe("token boundary protection", () => {
    it("should NOT match substring within larger token", () => {
      const offer = createTestOffer({
        title: "Awesome Engineer", // "awsome" contains "aws" but should NOT match
      });

      const result = matchOffer(offer, catalog);

      // Should have no keyword hits (substring protection works)
      expect(result.keywordHits).toHaveLength(0);
    });

    it("should NOT match when keyword is part of compound word", () => {
      const offer = createTestOffer({
        title: "Developer", // contains "gcp" letters but not as token
        description: "Great company providing solutions",
      });

      const result = matchOffer(offer, catalog);

      // Should have no GCP hits
      const gcpHits = result.keywordHits.filter(
        (h) => h.keywordId === "kw_gcp",
      );
      expect(gcpHits).toHaveLength(0);
    });

    it("should match when separated by punctuation", () => {
      const offer = createTestOffer({
        title: "AWS/GCP Engineer", // Should split into separate tokens
      });

      const result = matchOffer(offer, catalog);

      expect(result.keywordHits).toHaveLength(2);
      const awsHit = result.keywordHits.find((h) => h.keywordId === "kw_aws");
      const gcpHit = result.keywordHits.find((h) => h.keywordId === "kw_gcp");

      expect(awsHit).toBeDefined();
      expect(gcpHit).toBeDefined();
    });
  });

  describe("multi-token keyword matching", () => {
    it("should match multi-token keyword as consecutive sequence", () => {
      const offer = createTestOffer({
        title: "Google Ads Specialist",
      });

      const result = matchOffer(offer, catalog);

      const googleAdsHit = result.keywordHits.find(
        (h) => h.keywordId === "kw_google_ads",
      );
      expect(googleAdsHit).toBeDefined();
      expect(googleAdsHit).toMatchObject({
        keywordId: "kw_google_ads",
        categoryId: "cat_ads",
        field: "title",
        tokenIndex: 0,
        matchedTokens: ["google", "ads"],
        isNegated: false,
      });
    });

    it("should NOT match multi-token keyword with tokens separated", () => {
      const offer = createTestOffer({
        title: "Google Engineer for digital ads", // "google" and "ads" not consecutive
      });

      const result = matchOffer(offer, catalog);

      // Should have no google_ads hit (tokens not consecutive)
      const googleAdsHit = result.keywordHits.find(
        (h) => h.keywordId === "kw_google_ads",
      );
      expect(googleAdsHit).toBeUndefined();
    });

    it("should match multi-token keyword in description", () => {
      const offer = createTestOffer({
        title: "Marketing Specialist",
        description: "Experience with Google Ads platform required",
      });

      const result = matchOffer(offer, catalog);

      const googleAdsHit = result.keywordHits.find(
        (h) => h.keywordId === "kw_google_ads",
      );
      expect(googleAdsHit).toBeDefined();
      expect(googleAdsHit?.field).toBe("description");
    });
  });

  describe("duplicate keyword handling", () => {
    it("should preserve all hits when keyword appears multiple times", () => {
      const offer = createTestOffer({
        title: "AWS Engineer",
        description: "AWS experience required. We use AWS for infrastructure.",
      });

      const result = matchOffer(offer, catalog);

      // Should have 3 AWS hits: 1 in title, 2 in description
      const awsHits = result.keywordHits.filter(
        (h) => h.keywordId === "kw_aws",
      );
      expect(awsHits).toHaveLength(3);

      // Verify one is in title
      const titleHits = awsHits.filter((h) => h.field === "title");
      expect(titleHits).toHaveLength(1);

      // Verify two are in description
      const descHits = awsHits.filter((h) => h.field === "description");
      expect(descHits).toHaveLength(2);
    });
  });

  describe("negation integration", () => {
    it("should mark keyword as negated when preceded by negation cue", () => {
      const offer = createTestOffer({
        title: "Engineer without AWS experience",
      });

      const result = matchOffer(offer, catalog);

      const awsHit = result.keywordHits.find((h) => h.keywordId === "kw_aws");
      expect(awsHit).toBeDefined();
      expect(awsHit?.isNegated).toBe(true);
    });

    it("should mark keyword as negated when preceded by Spanish negation", () => {
      const offer = createTestOffer({
        description: "Desarrollador sin experiencia en AWS",
      });

      const result = matchOffer(offer, catalog);

      const awsHit = result.keywordHits.find((h) => h.keywordId === "kw_aws");
      expect(awsHit).toBeDefined();
      expect(awsHit?.isNegated).toBe(true);
    });

    it("should NOT mark keyword as negated when no negation cue present", () => {
      const offer = createTestOffer({
        title: "AWS Engineer with experience",
      });

      const result = matchOffer(offer, catalog);

      const awsHit = result.keywordHits.find((h) => h.keywordId === "kw_aws");
      expect(awsHit).toBeDefined();
      expect(awsHit?.isNegated).toBe(false);
    });

    it("should handle negation for multi-token keywords", () => {
      const offer = createTestOffer({
        title: "No Google Ads experience required",
      });

      const result = matchOffer(offer, catalog);

      const googleAdsHit = result.keywordHits.find(
        (h) => h.keywordId === "kw_google_ads",
      );
      expect(googleAdsHit).toBeDefined();
      expect(googleAdsHit?.isNegated).toBe(true);
    });
  });

  describe("field inclusion", () => {
    it("should match keywords in both title and description", () => {
      const offer = createTestOffer({
        title: "AWS Engineer",
        description: "Looking for GCP experience",
      });

      const result = matchOffer(offer, catalog);

      // Should have 2 hits: 1 AWS in title, 1 GCP in description
      expect(result.keywordHits).toHaveLength(2);

      const awsHit = result.keywordHits.find((h) => h.keywordId === "kw_aws");
      const gcpHit = result.keywordHits.find((h) => h.keywordId === "kw_gcp");

      expect(awsHit?.field).toBe("title");
      expect(gcpHit?.field).toBe("description");
    });

    it("should handle missing title gracefully", () => {
      const offer = createTestOffer({
        title: "",
        description: "AWS experience required",
      });

      const result = matchOffer(offer, catalog);

      expect(result.keywordHits).toHaveLength(1);
      expect(result.keywordHits[0].field).toBe("description");
    });

    it("should handle missing description gracefully", () => {
      const offer = createTestOffer({
        title: "GCP Engineer",
        description: "",
      });

      const result = matchOffer(offer, catalog);

      expect(result.keywordHits).toHaveLength(1);
      expect(result.keywordHits[0].field).toBe("title");
    });
  });

  describe("metadata computation", () => {
    it("should compute uniqueCategories and uniqueKeywords correctly", () => {
      const offer = createTestOffer({
        title: "AWS and GCP Engineer", // 2 keywords, 1 category (both cloud)
        description: "Google Ads experience nice to have", // 1 keyword, 1 category (ads)
      });

      const result = matchOffer(offer, catalog);

      // 3 keyword hits total
      expect(result.keywordHits).toHaveLength(3);

      // 3 unique keywords (aws, gcp, google_ads)
      expect(result.uniqueKeywords).toBe(3);

      // 2 unique categories (cat_cloud, cat_ads)
      expect(result.uniqueCategories).toBe(2);
    });
  });
});
