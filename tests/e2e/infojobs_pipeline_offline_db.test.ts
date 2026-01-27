/**
 * E2E Test: Full InfoJobs Pipeline (Offline - Mock HTTP + Real DB)
 *
 * Validates the complete data flow:
 * Mock HTTP → InfoJobsClient → runInfojobsPipeline → Ingestion → SQLite DB
 *
 * This is the highest-confidence test for the ingestion pipeline.
 * No live network calls. Real database. Real migrations. No mocks beyond HTTP.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runInfojobsPipeline } from "@/ingestion";
import { InfoJobsClient } from "@/clients/infojobs";
import { createMockHttp } from "../helpers/mockHttp";
import { createTestDb, type TestDbHarness } from "../helpers/testDb";
import * as offersRepo from "@/db/repos/offersRepo";
import * as companiesRepo from "@/db/repos/companiesRepo";
import * as runsRepo from "@/db/repos/runsRepo";
import sampleSearchResponse from "../fixtures/infojobs/sample_search_response.json";

describe("E2E: InfoJobs Pipeline (Offline - Mock HTTP + Real DB)", () => {
  let dbHarness: TestDbHarness;
  const mockHttp = createMockHttp();

  beforeEach(async () => {
    // Arrange: Create fresh test DB with migrations
    dbHarness = await createTestDb();

    // Reset HTTP mocks
    mockHttp.reset();
  });

  afterEach(() => {
    // Cleanup: Close DB and delete temp file
    dbHarness.cleanup();
  });

  it("should run full pipeline: mock HTTP → client → ingestion → DB persistence", async () => {
    // ========================================================================
    // ARRANGE: Mock HTTP routes
    // ========================================================================

    // Mock InfoJobs search endpoint (returns fixture)
    mockHttp.on(
      "GET",
      "https://api.infojobs.net/api/9/offer",
      sampleSearchResponse,
    );

    // Create InfoJobsClient with mocked HTTP and test credentials
    const client = new InfoJobsClient({
      httpRequest: mockHttp.request,
      credentials: {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
    });

    // ========================================================================
    // ACT: Run the full pipeline
    // ========================================================================

    const result = await runInfojobsPipeline({
      client,
      maxPages: 1, // Only fetch 1 page (matches fixture)
      text: "test", // Query parameter (not critical for mock test)
    });

    // ========================================================================
    // ASSERT: Pipeline result
    // ========================================================================

    // 1. Pipeline should return a numeric run ID
    expect(result.runId).toBeTypeOf("number");
    expect(result.runId).toBeGreaterThan(0);

    // 2. Ingestion result should show at least 1 offer processed
    expect(result.ingestResult.processed).toBeGreaterThan(0);
    expect(result.ingestResult.upserted).toBeGreaterThan(0);

    // From fixture: we expect exactly 1 offer
    expect(result.ingestResult.processed).toBe(1);

    // ========================================================================
    // ASSERT: Offer persistence (DB query)
    // ========================================================================

    // Fixture has 1 offer with id: "0bb014b42f407ca6e988dc789f5a5a"
    const expectedOfferId = "0bb014b42f407ca6e988dc789f5a5a";

    const persistedOffer = offersRepo.getOfferByProviderId(
      "infojobs",
      expectedOfferId,
    );

    // Offer should exist in DB
    expect(persistedOffer).toBeDefined();
    expect(persistedOffer).not.toBeNull();

    // Verify key fields
    expect(persistedOffer!.provider).toBe("infojobs");
    expect(persistedOffer!.provider_offer_id).toBe(expectedOfferId);
    expect(persistedOffer!.title).toBe("Offer Test");

    // Should have a company_id (foreign key)
    expect(persistedOffer!.company_id).toBeTypeOf("number");
    expect(persistedOffer!.company_id).toBeGreaterThan(0);

    // ========================================================================
    // ASSERT: Company linkage (DB query)
    // ========================================================================

    const companyId = persistedOffer!.company_id;
    const persistedCompany = companiesRepo.getCompanyById(companyId);

    // Company should exist
    expect(persistedCompany).toBeDefined();
    expect(persistedCompany).not.toBeNull();

    // Company should have at least one identity evidence field populated
    // Fixture author.name = "Improven Consultores" → normalizes to "improven consultores"
    const hasWebsiteDomain = !!persistedCompany!.website_domain;
    const hasNormalizedName = !!persistedCompany!.normalized_name;

    expect(hasWebsiteDomain || hasNormalizedName).toBe(true);

    // If normalized_name is present (likely from fixture), verify it
    if (hasNormalizedName) {
      expect(persistedCompany!.normalized_name).toBe("improven consultores");
    }

    // ========================================================================
    // ASSERT: Run lifecycle (DB query)
    // ========================================================================

    const persistedRun = runsRepo.getRunById(result.runId);

    // Run should exist
    expect(persistedRun).toBeDefined();
    expect(persistedRun).not.toBeNull();

    // Run should be associated with InfoJobs provider
    expect(persistedRun!.provider).toBe("infojobs");

    // Run should have finished_at timestamp (completed)
    expect(persistedRun!.finished_at).toBeDefined();
    expect(persistedRun!.finished_at).not.toBeNull();

    // Run status should not be "in_progress" (if status field exists)
    // Current schema may not have status, so this is defensive
    if ("status" in persistedRun!) {
      expect(persistedRun!.status).not.toBe("in_progress");
    }

    // ========================================================================
    // ASSERT: Counters (sanity check)
    // ========================================================================

    // Counters should show at least 1 offer upserted
    expect(result.counters.offers_upserted).toBeGreaterThanOrEqual(1);

    // Counters should match ingestion result (if present - counters are Partial<RunCounters>)
    expect(result.counters.offers_upserted).toBe(result.ingestResult.upserted);

    // offers_skipped may not be present if 0 (Partial type allows undefined)
    if (result.counters.offers_skipped !== undefined) {
      expect(result.counters.offers_skipped).toBe(result.ingestResult.skipped);
    }
  });

  it("should skip offers with insufficient company identity (invalid record in batch)", async () => {
    // ========================================================================
    // ARRANGE: Mock HTTP with mixed valid/invalid offers
    // ========================================================================

    // Clone the sample response and add a second offer with missing company identity
    const mixedBatchResponse = {
      ...sampleSearchResponse,
      currentResults: 2,
      offers: [
        // Offer 1: Valid (from fixture)
        sampleSearchResponse.offers[0],
        // Offer 2: Invalid (no author name → no identity evidence)
        {
          id: "invalid-offer-no-identity",
          title: "Invalid Offer - Missing Company Identity",
          province: { id: 28, value: "Madrid" },
          city: "Madrid",
          link: "https://www.infojobs.net/invalid-offer",
          category: { id: 1, value: "Tech" },
          contractType: { id: 1, value: "Indefinido" },
          workDay: { id: 1, value: "Completa" },
          published: "2024-01-01T00:00:00.000Z",
          updated: "2024-01-01T00:00:00.000Z",
          author: {
            id: "company-no-name",
            // name is missing/empty → no normalizedName can be derived
            // No websiteUrl/websiteDomain → insufficient identity evidence
            uri: "http://www.infojobs.net/company-no-name",
          },
          requirementMin: "Some requirements",
          bold: false,
          urgent: false,
          applications: "0",
        },
      ],
    };

    // Mock the search endpoint with mixed batch
    mockHttp.on(
      "GET",
      "https://api.infojobs.net/api/9/offer",
      mixedBatchResponse,
    );

    // Create client with mocked HTTP
    const client = new InfoJobsClient({
      httpRequest: mockHttp.request,
      credentials: {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
      },
    });

    // ========================================================================
    // ACT: Run pipeline with mixed batch
    // ========================================================================

    const result = await runInfojobsPipeline({
      client,
      maxPages: 1,
      text: "test",
    });

    // ========================================================================
    // ASSERT: Pipeline completes successfully
    // ========================================================================

    // Run should complete with runId
    expect(result.runId).toBeTypeOf("number");
    expect(result.runId).toBeGreaterThan(0);

    // ========================================================================
    // ASSERT: Ingestion result shows both processed, one skipped
    // ========================================================================

    // Both offers should be processed
    expect(result.ingestResult.processed).toBe(2);

    // Only valid offer should be upserted
    expect(result.ingestResult.upserted).toBe(1);

    // Invalid offer should be skipped (not failed)
    expect(result.ingestResult.skipped).toBe(1);
    expect(result.ingestResult.failed).toBe(0);

    // ========================================================================
    // ASSERT: Valid offer persisted, invalid offer NOT persisted
    // ========================================================================

    const validOfferId = "0bb014b42f407ca6e988dc789f5a5a";
    const invalidOfferId = "invalid-offer-no-identity";

    // Valid offer should exist in DB
    const validOffer = offersRepo.getOfferByProviderId(
      "infojobs",
      validOfferId,
    );
    expect(validOffer).toBeDefined();
    expect(validOffer).not.toBeNull();
    expect(validOffer!.title).toBe("Offer Test");

    // Invalid offer should NOT exist in DB
    const invalidOffer = offersRepo.getOfferByProviderId(
      "infojobs",
      invalidOfferId,
    );
    expect(invalidOffer).toBeUndefined();

    // ========================================================================
    // ASSERT: Run lifecycle completed
    // ========================================================================

    const persistedRun = runsRepo.getRunById(result.runId);
    expect(persistedRun).toBeDefined();
    expect(persistedRun!.finished_at).toBeDefined();
    expect(persistedRun!.finished_at).not.toBeNull();

    // ========================================================================
    // ASSERT: Counters reflect skip behavior
    // ========================================================================

    // At least 1 offer upserted (the valid one)
    expect(result.counters.offers_upserted).toBeGreaterThanOrEqual(1);
    expect(result.counters.offers_upserted).toBe(1);

    // Skipped counter may be undefined if 0, but should be present here
    // Prefer checking ingestResult first (always fully populated)
    expect(result.ingestResult.skipped).toBe(1);

    // If counters.offers_skipped is present, it should match
    if (result.counters.offers_skipped !== undefined) {
      expect(result.counters.offers_skipped).toBe(1);
    }
  });
});
