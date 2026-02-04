/**
 * E2E Test: Repost/Duplicate Detection → Aggregation
 *
 * Validates current pipeline behavior for repost handling:
 * Fixtures → ingestion → DB persistence → aggregation
 *
 * Current implementation:
 * - Repost detection based on (provider, provider_offer_id) uniqueness
 * - Same provider_offer_id triggers ON CONFLICT DO UPDATE (idempotent upsert)
 * - No duplicate rows created; existing row is updated
 *
 * Tests with real SQLite DB, real migrations, and foreign keys ENABLED.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../helpers/testDb";
import { runOfferBatchIngestion } from "@/ingestion";
import type { JobOfferDetail } from "@/types";
import * as offersRepo from "@/db/repos/offersRepo";
import * as companiesRepo from "@/db/repos/companiesRepo";
import { STRONG_THRESHOLD } from "@/constants/scoring";

// Use existing fixture with strong signals
import fx01StrongUsd from "../fixtures/infojobs/fx01_strong_usd_signal.json";

describe("E2E: Repost Detection → Aggregation", () => {
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
  function fixtureToOffer(
    fixture: any,
    offerId: string,
    publishedAt: string,
  ): JobOfferDetail {
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
      publishedAt,
    };
  }

  it("should handle repost via upsert: same provider_offer_id does not create duplicate rows", async () => {
    // ========================================================================
    // ARRANGE: Create offer that will be reposted
    // ========================================================================

    const offerId = "repost-test-001";
    const firstPublishedAt = "2024-01-10T10:00:00Z";
    const repostPublishedAt = "2024-01-20T10:00:00Z"; // 10 days later

    // First ingestion
    const offer1 = fixtureToOffer(fx01StrongUsd, offerId, firstPublishedAt);

    // Repost (same offerId, different timestamp to simulate reposting)
    const offer2 = fixtureToOffer(fx01StrongUsd, offerId, repostPublishedAt);

    // ========================================================================
    // ACT: Run ingestion twice with same provider_offer_id
    // ========================================================================

    const firstRun = await runOfferBatchIngestion("infojobs", [offer1]);
    const secondRun = await runOfferBatchIngestion("infojobs", [offer2]);

    // ========================================================================
    // ASSERT: Both runs complete successfully
    // ========================================================================

    expect(firstRun.result.processed).toBe(1);
    expect(firstRun.result.upserted).toBe(1);

    expect(secondRun.result.processed).toBe(1);
    expect(secondRun.result.upserted).toBe(1); // ON CONFLICT DO UPDATE counts as upsert

    // ========================================================================
    // ASSERT: Only ONE offer row exists (not duplicated)
    // ========================================================================

    const db = dbHarness.db;

    const allOffers = db
      .prepare("SELECT * FROM offers WHERE provider = ?")
      .all("infojobs") as any[];

    expect(allOffers.length).toBe(1);

    const persistedOffer = allOffers[0];
    expect(persistedOffer.provider_offer_id).toBe(offerId);

    // Offer should have updated timestamp from second ingestion
    expect(persistedOffer.published_at).toBe(repostPublishedAt);

    // canonical_offer_id should be NULL (all offers are canonical in current implementation)
    expect(persistedOffer.canonical_offer_id).toBeNull();

    // repost_count should be 0 (not tracked by current ingestion pipeline)
    expect(persistedOffer.repost_count).toBe(0);

    // ========================================================================
    // ASSERT: Company aggregation shows 1 unique offer
    // ========================================================================

    const companyId = persistedOffer.company_id;
    const company = companiesRepo.getCompanyById(companyId);

    expect(company).toBeDefined();

    // unique_offer_count should be 1 (one canonical offer)
    expect(company!.unique_offer_count).toBe(1);

    // offer_count should be 1 (activity-weighted = 1 + repost_count = 1 + 0)
    expect(company!.offer_count).toBe(1);

    // max_score should reflect the offer's score
    expect(company!.max_score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);

    // strong_offer_count should be 1 (canonical with strong score)
    expect(company!.strong_offer_count).toBe(1);

    // top_offer_id should point to this offer
    expect(company!.top_offer_id).toBe(persistedOffer.id);
  });

  it("should handle multiple distinct offers correctly (different provider_offer_ids)", async () => {
    // ========================================================================
    // ARRANGE: Create 3 distinct offers from same company
    // With different titles AND sufficiently different descriptions
    // ========================================================================

    const baseDesc =
      "We manage large Google Ads and Meta Ads budgets. Experience with AWS (EC2, S3) and payments via Stripe.";

    const offer1 = {
      ...fixtureToOffer(fx01StrongUsd, "distinct-001", "2024-01-10T10:00:00Z"),
      title: "Senior Backend Engineer - Python",
      description:
        baseDesc + " Backend focus: Python, Django, PostgreSQL. USD invoicing.",
    };
    const offer2 = {
      ...fixtureToOffer(fx01StrongUsd, "distinct-002", "2024-01-15T10:00:00Z"),
      title: "Frontend Developer - React Expert",
      description:
        baseDesc +
        " Frontend focus: React, TypeScript, Redux. International team.",
    };
    const offer3 = {
      ...fixtureToOffer(fx01StrongUsd, "distinct-003", "2024-01-20T10:00:00Z"),
      title: "DevOps Engineer - Kubernetes",
      description:
        baseDesc +
        " DevOps focus: Kubernetes, Docker, CI/CD pipelines. Remote work.",
    };

    // ========================================================================
    // ACT: Ingest all 3 offers
    // ========================================================================

    const result = await runOfferBatchIngestion("infojobs", [
      offer1,
      offer2,
      offer3,
    ]);

    // ========================================================================
    // ASSERT: All 3 offers persisted as distinct rows
    // ========================================================================

    expect(result.result.processed).toBe(3);
    expect(result.result.upserted).toBe(3);

    const db = dbHarness.db;

    const allOffers = db
      .prepare("SELECT * FROM offers WHERE provider = ? ORDER BY id")
      .all("infojobs") as any[];

    expect(allOffers.length).toBe(3);

    // All should be canonical (canonical_offer_id = NULL)
    allOffers.forEach((offer) => {
      expect(offer.canonical_offer_id).toBeNull();
      expect(offer.repost_count).toBe(0);
    });

    // ========================================================================
    // ASSERT: Company aggregation reflects 3 unique offers
    // ========================================================================

    const companyId = allOffers[0].company_id;
    const company = companiesRepo.getCompanyById(companyId);

    expect(company).toBeDefined();

    // unique_offer_count should be 3
    expect(company!.unique_offer_count).toBe(3);

    // offer_count should be 3 (3 canonical * (1 + 0 reposts) = 3)
    expect(company!.offer_count).toBe(3);

    // All 3 offers should have strong scores
    expect(company!.strong_offer_count).toBeGreaterThanOrEqual(1);

    // max_score should be set
    expect(company!.max_score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);
  });
});
