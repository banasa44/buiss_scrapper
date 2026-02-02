/**
 * Unit tests for phrase matcher
 *
 * Tests the phrase detection logic in matchOffer including:
 * - Consecutive token sequence matching
 * - Case normalization
 * - Negation integration
 * - Field inclusion (title + description only)
 *
 * No DB, no network, no side effects
 */

import { describe, it, expect } from "vitest";
import { matchOffer } from "@/signal/matcher";
import type { CatalogRuntime } from "@/types/catalog";
import type { JobOfferDetail } from "@/types/clients/job_offers";

/**
 * Minimal test catalog fixture for phrase testing
 *
 * Contains 2 phrases and 1 keyword to test coexistence
 */
function createTestCatalog(): CatalogRuntime {
  return {
    version: "0.0.0-test",
    categories: new Map([
      [
        "cat_fintech",
        {
          id: "cat_fintech",
          name: "Fintech",
          tier: 3,
        },
      ],
    ]),
    keywords: [
      {
        id: "kw_stripe",
        categoryId: "cat_fintech",
        canonical: "Stripe",
        aliasTokens: ["stripe"],
      },
    ],
    phrases: [
      {
        id: "phrase_intl_payments",
        tokens: ["international", "payments"],
        tier: 2,
      },
      {
        id: "phrase_usd_payments",
        tokens: ["usd", "payments"],
        tier: 3,
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
    },
    publishedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("matchOffer - phrase detection", () => {
  const catalog = createTestCatalog();

  describe("phrase matches in description", () => {
    it("should match phrase in description", () => {
      const offer = createTestOffer({
        title: "Backend Engineer",
        description: "Experience with international payments required",
      });

      const result = matchOffer(offer, catalog);

      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_intl_payments",
      );
      expect(phraseHit).toBeDefined();
      expect(phraseHit).toMatchObject({
        phraseId: "phrase_intl_payments",
        field: "description",
        matchedTokens: ["international", "payments"],
        isNegated: false,
      });
    });
  });

  describe("phrase matches in title", () => {
    it("should match phrase in title", () => {
      const offer = createTestOffer({
        title: "International Payments Engineer",
        description: "Backend role",
      });

      const result = matchOffer(offer, catalog);

      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_intl_payments",
      );
      expect(phraseHit).toBeDefined();
      expect(phraseHit?.field).toBe("title");
    });
  });

  describe("case-insensitivity via normalization", () => {
    it("should match phrase regardless of case", () => {
      const offer = createTestOffer({
        description: "INTERNATIONAL PAYMENTS system needed",
      });

      const result = matchOffer(offer, catalog);

      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_intl_payments",
      );
      expect(phraseHit).toBeDefined();
      expect(phraseHit?.matchedTokens).toEqual(["international", "payments"]);
    });

    it("should match phrase with mixed case", () => {
      const offer = createTestOffer({
        description: "Work on InTeRnAtIoNaL pAyMeNtS infrastructure",
      });

      const result = matchOffer(offer, catalog);

      expect(result.phraseHits).toHaveLength(1);
      expect(result.phraseHits[0].phraseId).toBe("phrase_intl_payments");
    });
  });

  describe("consecutive token requirement", () => {
    it("should match when tokens are consecutive", () => {
      const offer = createTestOffer({
        description: "USD payments processing",
      });

      const result = matchOffer(offer, catalog);

      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_usd_payments",
      );
      expect(phraseHit).toBeDefined();
    });

    it("should NOT match when tokens are separated", () => {
      const offer = createTestOffer({
        description: "USD based system for processing payments globally",
      });

      const result = matchOffer(offer, catalog);

      // "usd" and "payments" are not consecutive, should not match
      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_usd_payments",
      );
      expect(phraseHit).toBeUndefined();
    });
  });

  describe("punctuation and separator handling", () => {
    it("should match when separated by hyphen (tokens split)", () => {
      const offer = createTestOffer({
        description: "usd-payments integration",
      });

      const result = matchOffer(offer, catalog);

      // Hyphen splits into separate tokens ["usd", "payments"]
      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_usd_payments",
      );
      expect(phraseHit).toBeDefined();
    });

    it("should match when separated by slash (tokens split)", () => {
      const offer = createTestOffer({
        description: "international/payments platform",
      });

      const result = matchOffer(offer, catalog);

      // Slash splits into separate tokens ["international", "payments"]
      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_intl_payments",
      );
      expect(phraseHit).toBeDefined();
    });
  });

  describe("repeated phrase occurrences", () => {
    it("should preserve all hits when phrase appears multiple times", () => {
      const offer = createTestOffer({
        title: "International Payments Lead",
        description:
          "Work on international payments systems. Our international payments platform is global.",
      });

      const result = matchOffer(offer, catalog);

      // Should have 3 hits: 1 in title, 2 in description
      const phraseHits = result.phraseHits.filter(
        (h) => h.phraseId === "phrase_intl_payments",
      );
      expect(phraseHits).toHaveLength(3);

      const titleHits = phraseHits.filter((h) => h.field === "title");
      const descHits = phraseHits.filter((h) => h.field === "description");

      expect(titleHits).toHaveLength(1);
      expect(descHits).toHaveLength(2);
    });
  });

  describe("negation integration", () => {
    it("should mark phrase as negated when preceded by negation cue", () => {
      const offer = createTestOffer({
        description: "No international payments experience required",
      });

      const result = matchOffer(offer, catalog);

      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_intl_payments",
      );
      expect(phraseHit).toBeDefined();
      expect(phraseHit?.isNegated).toBe(true);
    });

    it("should NOT mark phrase as negated when no negation cue present", () => {
      const offer = createTestOffer({
        description: "International payments experience preferred",
      });

      const result = matchOffer(offer, catalog);

      const phraseHit = result.phraseHits.find(
        (h) => h.phraseId === "phrase_intl_payments",
      );
      expect(phraseHit).toBeDefined();
      expect(phraseHit?.isNegated).toBe(false);
    });
  });

  describe("coexistence with keywords", () => {
    it("should match both keyword and phrase without interference", () => {
      const offer = createTestOffer({
        description: "Stripe integration for USD payments processing",
      });

      const result = matchOffer(offer, catalog);

      // Should have 1 keyword hit (stripe)
      expect(result.keywordHits).toHaveLength(1);
      expect(result.keywordHits[0].keywordId).toBe("kw_stripe");

      // Should have 1 phrase hit (usd payments)
      expect(result.phraseHits).toHaveLength(1);
      expect(result.phraseHits[0].phraseId).toBe("phrase_usd_payments");
    });
  });
});
