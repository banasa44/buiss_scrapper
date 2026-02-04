/**
 * Integration tests for fingerprint-based repost detection
 *
 * Tests the end-to-end flow: fingerprint computation → persistence →
 * fast-path repost detection via fingerprint match.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import { runOfferBatchIngestion } from "@/ingestion/runOfferBatch";
import { getOfferById } from "@/db";
import type { JobOfferDetail } from "@/types";

describe("Fingerprint-based Repost Detection (Integration)", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should compute and persist fingerprint for new canonical offers", async () => {
    harness = createTestDbSync();
    const offer: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-1",
        url: "https://example.com/offer-1",
      },
      title: "Senior TypeScript Developer",
      description:
        "We are looking for an experienced TypeScript developer with 5+ years of experience in Node.js and React.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-01T00:00:00Z",
    };

    const result = await runOfferBatchIngestion("infojobs", [offer]);

    expect(result.result.upserted).toBe(1);
    expect(result.result.duplicates).toBe(0);

    // Verify fingerprint was persisted
    const persistedOffer = getOfferById(result.result.upserted);
    expect(persistedOffer).toBeDefined();
    expect(persistedOffer!.content_fingerprint).not.toBeNull();
    expect(persistedOffer!.content_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should detect repost via fingerprint match (fast-path)", async () => {
    harness = createTestDbSync();

    // First ingestion: Create canonical offer
    const offer1: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-1",
        url: "https://example.com/offer-1",
      },
      title: "Senior TypeScript Developer",
      description:
        "We are looking for an experienced TypeScript developer with 5+ years of experience.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-01T00:00:00Z",
    };

    const result1 = await runOfferBatchIngestion("infojobs", [offer1]);
    expect(result1.result.upserted).toBe(1);
    expect(result1.result.duplicates).toBe(0);

    const canonicalOfferId = result1.result.upserted;
    const canonicalOffer = getOfferById(canonicalOfferId);
    expect(canonicalOffer!.repost_count).toBe(0);

    // Second ingestion: Same content, different provider_offer_id
    // Should be detected as repost via fingerprint match
    const offer2: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-2",
        url: "https://example.com/offer-2",
      }, // Different ID
      title: "SENIOR TYPESCRIPT DEVELOPER", // Different casing
      description:
        "We are looking for an experienced TypeScript developer with 5+ years of experience.", // Same content
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-02T00:00:00Z",
    };

    const result2 = await runOfferBatchIngestion("infojobs", [offer2]);

    // Should be detected as duplicate
    expect(result2.result.upserted).toBe(0);
    expect(result2.result.duplicates).toBe(1);

    // Verify repost_count was incremented
    const updatedCanonical = getOfferById(canonicalOfferId);
    expect(updatedCanonical!.repost_count).toBe(1);
    expect(updatedCanonical!.last_seen_at).not.toBeNull();
  });

  it("should detect repost via fingerprint even with whitespace/diacritic variations", async () => {
    harness = createTestDbSync();

    // First ingestion
    const offer1: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-1",
        url: "https://example.com/offer-1",
      },
      title: "Desarrollador Senior",
      description: "Necesitamos experiencia en TypeScript y Node.js.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-01T00:00:00Z",
    };

    const result1 = await runOfferBatchIngestion("infojobs", [offer1]);
    expect(result1.result.upserted).toBe(1);

    // Second ingestion: Same content with diacritics and extra whitespace
    const offer2: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-2",
        url: "https://example.com/offer-2",
      },
      title: "Desarrollador   Sénior", // Extra space and accent
      description: "Necesitamos experiéncia en TypeScript  y   Node.js.", // Accents and extra whitespace
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-02T00:00:00Z",
    };

    const result2 = await runOfferBatchIngestion("infojobs", [offer2]);

    // Should be detected as duplicate via fingerprint
    expect(result2.result.duplicates).toBe(1);
    expect(result2.result.upserted).toBe(0);
  });

  it("should not match fingerprints for different content", async () => {
    harness = createTestDbSync();

    // First ingestion
    const offer1: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-1",
        url: "https://example.com/offer-1",
      },
      title: "Senior TypeScript Developer",
      description: "We need TypeScript experience.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-01T00:00:00Z",
    };

    const result1 = await runOfferBatchIngestion("infojobs", [offer1]);
    expect(result1.result.upserted).toBe(1);

    // Second ingestion: Different title AND description (no match)
    const offer2: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-2",
        url: "https://example.com/offer-2",
      },
      title: "Junior Python Developer", // Different title
      description: "We need Python experience.", // Different description
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-02T00:00:00Z",
    };

    const result2 = await runOfferBatchIngestion("infojobs", [offer2]);

    // Should NOT be detected as duplicate (completely different content)
    expect(result2.result.duplicates).toBe(0);
    expect(result2.result.upserted).toBe(1);
  });

  it("should fallback to similarity-based detection when fingerprint cannot be computed", async () => {
    harness = createTestDbSync();

    // First ingestion: Offer with description (has fingerprint)
    const offer1: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-1",
        url: "https://example.com/offer-1",
      },
      title: "Senior Developer",
      description: "We need an experienced developer.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-01T00:00:00Z",
    };

    const result1 = await runOfferBatchIngestion("infojobs", [offer1]);
    expect(result1.result.upserted).toBe(1);

    // Second ingestion: Offer WITHOUT description (cannot compute fingerprint)
    // Should still detect repost via title match (fallback logic)
    const offer2: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-2",
        url: "https://example.com/offer-2",
      },
      title: "Senior Developer", // Exact same title
      description: "", // No description
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-02T00:00:00Z",
    };

    const result2 = await runOfferBatchIngestion("infojobs", [offer2]);

    // Should be detected as duplicate via title match (fallback)
    expect(result2.result.duplicates).toBe(1);
    expect(result2.result.upserted).toBe(0);
  });

  it("should handle multiple reposts via fingerprint", async () => {
    harness = createTestDbSync();

    // First ingestion
    const offer1: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-1",
        url: "https://example.com/offer-1",
      },
      title: "Backend Developer",
      description: "Experience with Node.js required.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-01T00:00:00Z",
    };

    const result1 = await runOfferBatchIngestion("infojobs", [offer1]);
    const canonicalOfferId = result1.result.upserted;

    // Second repost
    const offer2: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-2",
        url: "https://example.com/offer-2",
      },
      title: "Backend Developer",
      description: "Experience with Node.js required.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-02T00:00:00Z",
    };

    const result2 = await runOfferBatchIngestion("infojobs", [offer2]);
    expect(result2.result.duplicates).toBe(1);

    // Third repost
    const offer3: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "offer-3",
        url: "https://example.com/offer-3",
      },
      title: "BACKEND DEVELOPER", // Different casing
      description: "Experience with Node.js required.",
      company: {
        name: "Tech Corp",
        websiteUrl: "https://techcorp.com",
      },
      publishedAt: "2024-01-03T00:00:00Z",
    };

    const result3 = await runOfferBatchIngestion("infojobs", [offer3]);
    expect(result3.result.duplicates).toBe(1);

    // Verify repost_count incremented twice
    const finalCanonical = getOfferById(canonicalOfferId);
    expect(finalCanonical!.repost_count).toBe(2);
  });
});
