/**
 * E2E Test: Bad Record Handling - Pipeline Resilience
 *
 * Validates that the ingestion pipeline gracefully handles malformed offers
 * without crashing the entire batch. When one offer in a batch is invalid
 * (e.g., missing company identity), the pipeline should:
 * 1. Skip the invalid offer and log the reason
 * 2. Continue processing valid offers
 * 3. Return proper result counters (processed, upserted, skipped, failed)
 *
 * Tests with real SQLite DB, real migrations, and foreign keys ENABLED.
 * No production code modifications - validates actual error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../helpers/testDb";
import { runOfferBatchIngestion } from "@/ingestion";
import type { JobOfferDetail } from "@/types";
import * as offersRepo from "@/db/repos/offersRepo";
import * as companiesRepo from "@/db/repos/companiesRepo";

// Import fixture with strong signal
import fx01StrongUsd from "../fixtures/infojobs/fx01_strong_usd_signal.json";

describe("E2E: Bad Record Handling - Pipeline Resilience", () => {
  let dbHarness: TestDbHarness;

  beforeEach(async () => {
    // Create fresh test DB with migrations and foreign keys enabled
    dbHarness = await createTestDb();
  });

  afterEach(() => {
    // Cleanup: Close DB and delete temp file
    dbHarness.cleanup();
  });

  /**
   * Helper to convert fixture JSON to JobOfferDetail
   */
  function fixtureToOffer(fixture: any, offerId: string): JobOfferDetail {
    return {
      ref: {
        provider: "infojobs",
        id: offerId,
        url: `https://www.infojobs.net/${offerId}`,
      },
      title: fixture.title,
      company: {
        name: fixture.profile?.name || "Test Company",
        normalizedName:
          fixture.profile?.name?.toLowerCase().replace(/[^a-z0-9\s]/g, "") ||
          "test company",
      },
      location: {
        city: fixture.city,
      },
      description: fixture.description,
      publishedAt: "2024-01-15T10:00:00Z",
    };
  }

  /**
   * Helper to create an unidentifiable offer (missing company identity)
   *
   * An offer is unidentifiable when its company has:
   * - No website_domain (and no websiteUrl to derive from)
   * - No normalized_name (and no name/nameRaw to derive from)
   *
   * This triggers the "company_unidentifiable" skip reason.
   */
  function createUnidentifiableOffer(offerId: string): JobOfferDetail {
    return {
      ref: {
        provider: "infojobs",
        id: offerId,
        url: `https://www.infojobs.net/${offerId}`,
      },
      title: "Test Job with Unidentifiable Company",
      company: {
        // No name, normalizedName, websiteUrl, websiteDomain
        // This makes the company unidentifiable per companyPersistence rules
      },
      location: {
        city: "Madrid",
      },
      description: "Test description for unidentifiable company offer",
      publishedAt: "2024-01-15T10:00:00Z",
    };
  }

  it("should skip unidentifiable offer and continue processing valid offers", async () => {
    // ========================================================================
    // ARRANGE: Create 1 valid + 1 invalid offer
    // ========================================================================

    const validOffer = fixtureToOffer(fx01StrongUsd, "valid-001");
    const invalidOffer = createUnidentifiableOffer("invalid-002");

    const offers = [validOffer, invalidOffer];

    // ========================================================================
    // ACT: Run ingestion with mixed batch
    // ========================================================================

    const result = await runOfferBatchIngestion("infojobs", offers);

    // ========================================================================
    // ASSERT: Verify resilience and proper result counters
    // ========================================================================

    expect(result.runId).toBeTypeOf("number");
    expect(result.result.processed).toBe(2); // Both offers were processed
    expect(result.result.upserted).toBe(1); // Only valid offer was persisted
    expect(result.result.skipped).toBe(1); // Invalid offer was skipped
    expect(result.result.failed).toBe(0); // No DB errors
    expect(result.result.affectedCompanies).toBe(1); // Only valid company was affected

    // Verify only valid offer exists in DB
    const persistedValidOffer = offersRepo.getOfferByProviderId(
      "infojobs",
      "valid-001",
    );
    expect(persistedValidOffer).toBeDefined();
    expect(persistedValidOffer?.company_id).toBeTypeOf("number");

    // Verify invalid offer was NOT persisted
    const persistedInvalidOffer = offersRepo.getOfferByProviderId(
      "infojobs",
      "invalid-002",
    );
    expect(persistedInvalidOffer).toBeUndefined();

    // Verify only 1 offer total in DB
    const db = dbHarness.db;
    const offerCount = db
      .prepare("SELECT COUNT(*) as count FROM offers")
      .get() as { count: number };
    expect(offerCount.count).toBe(1);

    // Verify company aggregation ran (offer_count should be 1)
    const validCompany = companiesRepo.getCompanyById(
      persistedValidOffer!.company_id,
    );
    expect(validCompany).toBeDefined();
    expect(validCompany!.offer_count).toBe(1);
  });

  it("should handle batch with only invalid offers without crashing", async () => {
    // ========================================================================
    // ARRANGE: Create batch with only unidentifiable offers
    // ========================================================================

    const invalidOffer1 = createUnidentifiableOffer("invalid-001");
    const invalidOffer2 = createUnidentifiableOffer("invalid-002");

    const offers = [invalidOffer1, invalidOffer2];

    // ========================================================================
    // ACT: Run ingestion with all-invalid batch
    // ========================================================================

    const result = await runOfferBatchIngestion("infojobs", offers);

    // ========================================================================
    // ASSERT: Verify pipeline completes without throwing
    // ========================================================================

    expect(result.runId).toBeTypeOf("number");
    expect(result.result.processed).toBe(2); // Both offers were processed
    expect(result.result.upserted).toBe(0); // No offers persisted
    expect(result.result.skipped).toBe(2); // Both offers skipped
    expect(result.result.failed).toBe(0); // No DB errors
    expect(result.result.affectedCompanies).toBe(0); // No companies affected

    // Verify DB is empty (no offers or companies from this batch)
    const db = dbHarness.db;
    const offerCount = db
      .prepare("SELECT COUNT(*) as count FROM offers")
      .get() as { count: number };
    expect(offerCount.count).toBe(0);
  });

  it("should continue processing after encountering multiple bad records", async () => {
    // ========================================================================
    // ARRANGE: Create batch with alternating valid/invalid offers
    // ========================================================================

    const validOffer1 = fixtureToOffer(fx01StrongUsd, "valid-001");
    const invalidOffer1 = createUnidentifiableOffer("invalid-001");
    const validOffer2 = fixtureToOffer(fx01StrongUsd, "valid-002");
    const invalidOffer2 = createUnidentifiableOffer("invalid-002");
    const validOffer3 = fixtureToOffer(fx01StrongUsd, "valid-003");

    const offers = [
      validOffer1,
      invalidOffer1,
      validOffer2,
      invalidOffer2,
      validOffer3,
    ];

    // ========================================================================
    // ACT: Run ingestion with interleaved valid/invalid offers
    // ========================================================================

    const result = await runOfferBatchIngestion("infojobs", offers);

    // ========================================================================
    // ASSERT: Verify all valid offers persisted despite invalid ones
    // ========================================================================

    expect(result.runId).toBeTypeOf("number");
    expect(result.result.processed).toBe(5); // All 5 offers processed
    expect(result.result.upserted).toBe(3); // 3 valid offers persisted
    expect(result.result.skipped).toBe(2); // 2 invalid offers skipped
    expect(result.result.failed).toBe(0); // No DB errors
    expect(result.result.affectedCompanies).toBe(1); // All valid offers same company

    // Verify all 3 valid offers exist in DB
    const persistedValidOffer1 = offersRepo.getOfferByProviderId(
      "infojobs",
      "valid-001",
    );
    const persistedValidOffer2 = offersRepo.getOfferByProviderId(
      "infojobs",
      "valid-002",
    );
    const persistedValidOffer3 = offersRepo.getOfferByProviderId(
      "infojobs",
      "valid-003",
    );

    expect(persistedValidOffer1).toBeDefined();
    expect(persistedValidOffer2).toBeDefined();
    expect(persistedValidOffer3).toBeDefined();

    // Verify invalid offers were NOT persisted
    const persistedInvalidOffer1 = offersRepo.getOfferByProviderId(
      "infojobs",
      "invalid-001",
    );
    const persistedInvalidOffer2 = offersRepo.getOfferByProviderId(
      "infojobs",
      "invalid-002",
    );
    expect(persistedInvalidOffer1).toBeUndefined();
    expect(persistedInvalidOffer2).toBeUndefined();

    // Verify exactly 3 offers total in DB
    const db = dbHarness.db;
    const offerCount = db
      .prepare("SELECT COUNT(*) as count FROM offers")
      .get() as { count: number };
    expect(offerCount.count).toBe(3);

    // Verify company aggregation ran correctly (offer_count should be 3)
    const validCompany = companiesRepo.getCompanyById(
      persistedValidOffer1!.company_id,
    );
    expect(validCompany).toBeDefined();
    expect(validCompany!.offer_count).toBe(3);
  });
});
