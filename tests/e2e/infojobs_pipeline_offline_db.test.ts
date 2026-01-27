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
});
