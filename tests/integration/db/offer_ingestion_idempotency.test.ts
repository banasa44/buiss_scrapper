/**
 * Integration Tests — Offer Ingestion Idempotency & Bad Record Handling
 *
 * Tests using real SQLite DB with real migrations and repos.
 * No mocks for database or repositories.
 *
 * Verifies:
 * 1. Idempotency: same batch twice = no duplicates
 * 2. Overwrite semantics: updated fields overwrite old values
 * 3. Bad record handling: skip invalid records without crashing
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import { runOfferBatchIngestion } from "@/ingestion";
import { getOfferByProviderId } from "@/db";
import type { JobOfferSummary } from "@/types";

describe("Offer Ingestion — Idempotency & Bad Records", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  describe("Idempotency (no duplicates)", () => {
    it("should not create duplicates when ingesting the same batch twice", async () => {
      harness = createTestDbSync();

      // Arrange: Create two offers with stable provider_offer_ids
      const offers: JobOfferSummary[] = [
        {
          ref: {
            provider: "infojobs",
            id: "offer-stable-1",
            url: "https://example.com/offer-1",
          },
          title: "Software Engineer",
          company: {
            id: "company-1",
            name: "Tech Corp",
            nameRaw: "Tech Corp",
            normalizedName: "tech corp", // Explicit normalized name for identity
          },
          publishedAt: "2026-01-01T10:00:00Z",
        },
        {
          ref: {
            provider: "infojobs",
            id: "offer-stable-2",
            url: "https://example.com/offer-2",
          },
          title: "Product Manager",
          company: {
            id: "company-2",
            name: "Business Solutions, S.L.",
            nameRaw: "Business Solutions, S.L.",
            normalizedName: "business solutions", // Explicit normalized name
          },
          publishedAt: "2026-01-02T11:00:00Z",
        },
      ];

      // Act: Ingest the same batch twice
      const firstResult = await runOfferBatchIngestion("infojobs", offers);
      const secondResult = await runOfferBatchIngestion("infojobs", offers);

      // Assert: Both runs processed 2 offers
      expect(firstResult.result.processed).toBe(2);
      expect(secondResult.result.processed).toBe(2);

      // First run should have upserted 2 (new inserts)
      expect(firstResult.result.upserted).toBe(2);
      expect(firstResult.result.skipped).toBe(0);
      expect(firstResult.result.failed).toBe(0);

      // Second run should have upserted 2 (updates on conflict)
      expect(secondResult.result.upserted).toBe(2);
      expect(secondResult.result.skipped).toBe(0);
      expect(secondResult.result.failed).toBe(0);

      // Verify exactly 2 offers exist in DB (no duplicates)
      const offer1 = getOfferByProviderId("infojobs", "offer-stable-1");
      const offer2 = getOfferByProviderId("infojobs", "offer-stable-2");

      expect(offer1).toBeDefined();
      expect(offer1?.title).toBe("Software Engineer");
      expect(offer1?.provider_offer_id).toBe("offer-stable-1");

      expect(offer2).toBeDefined();
      expect(offer2?.title).toBe("Product Manager");
      expect(offer2?.provider_offer_id).toBe("offer-stable-2");

      // Verify total count via direct query
      const totalOffers = harness.db
        .prepare("SELECT COUNT(*) as count FROM offers WHERE provider = ?")
        .get("infojobs") as { count: number };
      expect(totalOffers.count).toBe(2);
    });
  });

  describe("Overwrite semantics on upsert", () => {
    it("should overwrite mutable fields when re-ingesting with same provider+id", async () => {
      harness = createTestDbSync();

      // Arrange: Create initial offer
      const initialOffer: JobOfferSummary = {
        ref: {
          provider: "infojobs",
          id: "offer-overwrite-test",
          url: "https://example.com/original-url",
        },
        title: "Original Title",
        company: {
          name: "Test Company",
          normalizedName: "test company",
        },
        publishedAt: "2026-01-01T10:00:00Z",
        requirementsSnippet: "Original requirements",
      };

      // Act 1: Ingest initial offer
      await runOfferBatchIngestion("infojobs", [initialOffer]);

      // Verify initial values
      const afterFirst = getOfferByProviderId(
        "infojobs",
        "offer-overwrite-test",
      );
      expect(afterFirst?.title).toBe("Original Title");
      expect(afterFirst?.provider_url).toBe("https://example.com/original-url");
      expect(afterFirst?.requirements_snippet).toBe("Original requirements");

      // Act 2: Re-ingest with updated fields
      const updatedOffer: JobOfferSummary = {
        ref: {
          provider: "infojobs",
          id: "offer-overwrite-test", // Same ID
          url: "https://example.com/updated-url", // Updated
        },
        title: "Updated Title", // Updated
        company: {
          name: "Test Company",
          normalizedName: "test company",
        },
        publishedAt: "2026-01-01T10:00:00Z",
        requirementsSnippet: "Updated requirements", // Updated
      };

      await runOfferBatchIngestion("infojobs", [updatedOffer]);

      // Assert: Fields should be overwritten
      const afterSecond = getOfferByProviderId(
        "infojobs",
        "offer-overwrite-test",
      );
      expect(afterSecond?.title).toBe("Updated Title");
      expect(afterSecond?.provider_url).toBe("https://example.com/updated-url");
      expect(afterSecond?.requirements_snippet).toBe("Updated requirements");

      // Verify only one record exists
      const totalOffers = harness.db
        .prepare("SELECT COUNT(*) as count FROM offers WHERE provider = ?")
        .get("infojobs") as { count: number };
      expect(totalOffers.count).toBe(1);
    });

    it("should overwrite nullable field to null when re-ingesting", async () => {
      harness = createTestDbSync();

      // Arrange: Initial offer with requirements_snippet
      const initialOffer: JobOfferSummary = {
        ref: {
          provider: "infojobs",
          id: "offer-null-overwrite",
        },
        title: "Test Offer",
        company: {
          name: "Company",
          normalizedName: "company",
        },
        requirementsSnippet: "Initial requirements text",
      };

      await runOfferBatchIngestion("infojobs", [initialOffer]);

      const afterFirst = getOfferByProviderId(
        "infojobs",
        "offer-null-overwrite",
      );
      expect(afterFirst?.requirements_snippet).toBe(
        "Initial requirements text",
      );

      // Act: Re-ingest with requirements_snippet undefined (becomes null in DB)
      const updatedOffer: JobOfferSummary = {
        ref: {
          provider: "infojobs",
          id: "offer-null-overwrite",
        },
        title: "Test Offer",
        company: {
          name: "Company",
          normalizedName: "company",
        },
        requirementsSnippet: undefined, // Should become null in DB
      };

      await runOfferBatchIngestion("infojobs", [updatedOffer]);

      // Assert: Field should be overwritten to null
      const afterSecond = getOfferByProviderId(
        "infojobs",
        "offer-null-overwrite",
      );
      expect(afterSecond?.requirements_snippet).toBeNull();
    });
  });

  describe("Bad record handling (log + skip, no crash)", () => {
    it("should skip offers with insufficient company identity evidence", async () => {
      harness = createTestDbSync();

      // Arrange: Batch with 1 valid and 1 invalid offer
      const offers: JobOfferSummary[] = [
        // Valid offer: has normalized company name
        {
          ref: {
            provider: "infojobs",
            id: "offer-valid-1",
          },
          title: "Valid Offer",
          company: {
            name: "Valid Company",
            normalizedName: "valid company", // Has identity evidence
          },
        },
        // Invalid offer: no normalized name, no website domain
        {
          ref: {
            provider: "infojobs",
            id: "offer-invalid-no-identity",
          },
          title: "Invalid Offer",
          company: {
            id: "some-id",
            // No name, nameRaw, normalizedName, websiteUrl, or websiteDomain
            // Insufficient identity evidence -> should be skipped
          },
        },
      ];

      // Act: Ingest batch (should not throw)
      const result = await runOfferBatchIngestion("infojobs", offers);

      // Assert: Result shows 2 processed, 1 upserted, 1 skipped
      expect(result.result.processed).toBe(2);
      expect(result.result.upserted).toBe(1);
      expect(result.result.skipped).toBe(1);
      expect(result.result.failed).toBe(0);

      // Verify valid offer exists
      const validOffer = getOfferByProviderId("infojobs", "offer-valid-1");
      expect(validOffer).toBeDefined();
      expect(validOffer?.title).toBe("Valid Offer");

      // Verify invalid offer does NOT exist
      const invalidOffer = getOfferByProviderId(
        "infojobs",
        "offer-invalid-no-identity",
      );
      expect(invalidOffer).toBeUndefined();

      // Verify total count is 1
      const totalOffers = harness.db
        .prepare("SELECT COUNT(*) as count FROM offers WHERE provider = ?")
        .get("infojobs") as { count: number };
      expect(totalOffers.count).toBe(1);
    });

    it("should complete run successfully even with mixed valid/invalid records", async () => {
      harness = createTestDbSync();

      // Arrange: Batch with 3 offers - 2 valid, 1 invalid
      const offers: JobOfferSummary[] = [
        {
          ref: { provider: "infojobs", id: "batch-valid-1" },
          title: "First Valid",
          company: { name: "Company A", normalizedName: "company a" },
        },
        {
          ref: { provider: "infojobs", id: "batch-invalid" },
          title: "Invalid",
          company: {}, // No identity evidence
        },
        {
          ref: { provider: "infojobs", id: "batch-valid-2" },
          title: "Second Valid",
          company: { name: "Company B", normalizedName: "company b" },
        },
      ];

      // Act: Should not throw
      const result = await runOfferBatchIngestion("infojobs", offers);

      // Assert: Counters are correct
      expect(result.result.processed).toBe(3);
      expect(result.result.upserted).toBe(2);
      expect(result.result.skipped).toBe(1);
      expect(result.result.failed).toBe(0);

      // Verify correct offers exist
      expect(getOfferByProviderId("infojobs", "batch-valid-1")).toBeDefined();
      expect(getOfferByProviderId("infojobs", "batch-valid-2")).toBeDefined();
      expect(getOfferByProviderId("infojobs", "batch-invalid")).toBeUndefined();

      // Verify run completed successfully (has runId)
      expect(result.runId).toBeGreaterThan(0);

      // Verify counters in result
      expect(result.counters.offers_fetched).toBe(3);
      expect(result.counters.offers_upserted).toBe(2);
      expect(result.counters.offers_skipped).toBe(1);
    });
  });
});
