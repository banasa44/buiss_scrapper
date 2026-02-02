/**
 * E2E Test: Full Pipeline - Ingestion → Matching → Scoring → Aggregation
 *
 * Validates the complete data flow from fixtures to aggregated company metrics:
 * Fixtures → ingestOffers → offers + matches in DB → aggregateCompanies → company metrics
 *
 * Tests with real SQLite DB, real migrations, real catalog, and foreign keys ENABLED.
 * No mocks beyond HTTP client (not needed for this test).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../helpers/testDb";
import { runOfferBatchIngestion } from "@/ingestion";
import type { JobOfferDetail } from "@/types";
import * as offersRepo from "@/db/repos/offersRepo";
import * as companiesRepo from "@/db/repos/companiesRepo";
import { STRONG_THRESHOLD } from "@/constants/scoring";

// Import fixtures with strong signals that should trigger matches
import fx01StrongUsd from "../fixtures/infojobs/fx01_strong_usd_signal.json";
import fx02NegationAws from "../fixtures/infojobs/fx02_negation_aws.json";
import fx03UrlOnlyStripe from "../fixtures/infojobs/fx03_url_only_stripe.json";
import fx05PhraseFx from "../fixtures/infojobs/fx05_phrase_boost_fx.json";

describe("E2E: Ingestion → Matching → Scoring → Aggregation", () => {
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

  it("should complete full pipeline: fixtures → ingest → match → score → aggregate → DB metrics", async () => {
    // ========================================================================
    // ARRANGE: Prepare fixtures with known signals
    // ========================================================================

    // fx01: Strong USD signal (tier 3)
    // Expected matches: "USD" keyword, "Google Ads", "Meta", "AWS", "Stripe"
    // Expected strong match (score >= 6)
    const offer1 = fixtureToOffer(fx01StrongUsd, "fx01-strong-usd");

    // fx03: URL with Stripe mention (tier 3)
    // Expected matches: "Stripe" keyword
    // May not be strong depending on catalog scoring
    const offer2 = fixtureToOffer(fx03UrlOnlyStripe, "fx03-url-stripe");

    const offers = [offer1, offer2];

    // ========================================================================
    // ACT: Run full ingestion pipeline
    // ========================================================================

    const result = await runOfferBatchIngestion("infojobs", offers);

    // ========================================================================
    // ASSERT: Pipeline execution
    // ========================================================================

    expect(result.runId).toBeTypeOf("number");
    expect(result.runId).toBeGreaterThan(0);

    // Both offers should be processed and upserted
    expect(result.result.processed).toBe(2);
    expect(result.result.upserted).toBe(2);
    expect(result.result.skipped).toBe(0);
    expect(result.result.failed).toBe(0);

    // At least 1 company should be affected (may be same company for both offers)
    expect(result.result.affectedCompanies).toBeGreaterThanOrEqual(1);

    // Companies should be aggregated
    expect(result.counters.companies_aggregated).toBeGreaterThanOrEqual(1);
    expect(result.counters.companies_failed).toBe(0);

    // ========================================================================
    // ASSERT: Offers table persistence
    // ========================================================================

    const persistedOffer1 = offersRepo.getOfferByProviderId(
      "infojobs",
      "fx01-strong-usd",
    );
    const persistedOffer2 = offersRepo.getOfferByProviderId(
      "infojobs",
      "fx03-url-stripe",
    );

    // Both offers should exist
    expect(persistedOffer1).toBeDefined();
    expect(persistedOffer1?.title).toBe(offer1.title);
    expect(persistedOffer1?.company_id).toBeTypeOf("number");

    expect(persistedOffer2).toBeDefined();
    expect(persistedOffer2?.title).toBe(offer2.title);
    expect(persistedOffer2?.company_id).toBeTypeOf("number");

    // ========================================================================
    // ASSERT: Matches table persistence
    // ========================================================================

    const db = dbHarness.db;

    const match1 = db
      .prepare("SELECT * FROM matches WHERE offer_id = ?")
      .get(persistedOffer1!.id) as any;

    const match2 = db
      .prepare("SELECT * FROM matches WHERE offer_id = ?")
      .get(persistedOffer2!.id) as any;

    // Both offers should have matches with positive scores
    expect(match1).toBeDefined();
    expect(match1.score).toBeTypeOf("number");
    expect(match1.score).toBeGreaterThan(0);
    expect(match1.matched_keywords_json).toBeTypeOf("string");

    expect(match2).toBeDefined();
    expect(match2.score).toBeTypeOf("number");
    expect(match2.score).toBeGreaterThan(0); // Must have positive score

    // fx01 should have strong score (multiple tier 3 signals)
    expect(match1.score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);

    // Parse matched_keywords_json to verify structure
    const match1Data = JSON.parse(match1.matched_keywords_json);
    expect(match1Data).toHaveProperty("score");
    expect(match1Data).toHaveProperty("topCategoryId");
    expect(match1Data.score).toBe(match1.score);

    // ========================================================================
    // ASSERT: Company aggregation metrics
    // ========================================================================

    // Get the company for offer1 (the strong one)
    const companyId1 = persistedOffer1!.company_id;
    const company1 = companiesRepo.getCompanyById(companyId1);

    expect(company1).toBeDefined();

    // max_score should equal the highest offer score (match1 in this case)
    expect(company1!.max_score).toBeTypeOf("number");
    expect(company1!.max_score).toBe(match1.score);
    expect(company1!.max_score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);

    // offer_count should be activity-weighted (1 + repost_count for each canonical)
    expect(company1!.offer_count).toBeTypeOf("number");
    expect(company1!.offer_count).toBeGreaterThan(0);

    // unique_offer_count should count canonical offers only
    expect(company1!.unique_offer_count).toBeTypeOf("number");
    expect(company1!.unique_offer_count).toBeGreaterThan(0);

    // strong_offer_count should be at least 1 (offer1 is strong)
    expect(company1!.strong_offer_count).toBeTypeOf("number");
    expect(company1!.strong_offer_count).toBeGreaterThanOrEqual(1);

    // avg_strong_score should be set when strong offers exist
    expect(company1!.avg_strong_score).toBeTypeOf("number");
    expect(company1!.avg_strong_score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);

    // top_category_id should be set
    expect(company1!.top_category_id).toBeTypeOf("string");
    expect(company1!.top_category_id).toBeTruthy();

    // top_offer_id should point to offer1 (highest scoring offer)
    expect(company1!.top_offer_id).toBeTypeOf("number");
    expect(company1!.top_offer_id).toBe(persistedOffer1!.id);

    // last_strong_at should be set (offer1 is strong)
    expect(company1!.last_strong_at).toBeTypeOf("string");
    expect(company1!.last_strong_at).toBeTruthy();

    // category_max_scores should be valid JSON
    expect(company1!.category_max_scores).toBeTypeOf("string");
    const categoryScores = JSON.parse(company1!.category_max_scores as string);
    expect(typeof categoryScores).toBe("object");
    expect(Object.keys(categoryScores).length).toBeGreaterThan(0);

    // Verify category scores are all numbers
    Object.values(categoryScores).forEach((score) => {
      expect(typeof score).toBe("number");
    });
  });

  it("should maintain idempotency: running same ingestion twice produces identical DB state", async () => {
    // ========================================================================
    // ARRANGE: Prepare offer fixture
    // ========================================================================

    const offer = fixtureToOffer(fx01StrongUsd, "fx01-idempotent-test");
    const offers = [offer];

    // ========================================================================
    // ACT: Run ingestion twice
    // ========================================================================

    const firstRun = await runOfferBatchIngestion("infojobs", offers);
    const secondRun = await runOfferBatchIngestion("infojobs", offers);

    // ========================================================================
    // ASSERT: Both runs complete successfully
    // ========================================================================

    expect(firstRun.runId).toBeGreaterThan(0);
    expect(secondRun.runId).toBeGreaterThan(0);
    expect(secondRun.runId).toBeGreaterThan(firstRun.runId); // Different runs

    // Both should process 1 offer
    expect(firstRun.result.processed).toBe(1);
    expect(secondRun.result.processed).toBe(1);

    // Both should upsert (second is update on conflict)
    expect(firstRun.result.upserted).toBe(1);
    expect(secondRun.result.upserted).toBe(1);

    // ========================================================================
    // ASSERT: Only one offer exists in DB
    // ========================================================================

    const db = dbHarness.db;

    const offerCount = db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE provider = ?")
      .get("infojobs") as { count: number };

    expect(offerCount.count).toBe(1);

    // ========================================================================
    // ASSERT: Offer details unchanged
    // ========================================================================

    const persistedOffer = offersRepo.getOfferByProviderId(
      "infojobs",
      "fx01-idempotent-test",
    );

    expect(persistedOffer).toBeDefined();
    expect(persistedOffer!.title).toBe(offer.title);

    // ========================================================================
    // ASSERT: Match score unchanged (idempotent scoring)
    // ========================================================================

    const match = db
      .prepare("SELECT * FROM matches WHERE offer_id = ?")
      .get(persistedOffer!.id) as any;

    expect(match).toBeDefined();
    expect(match.score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);

    // ========================================================================
    // ASSERT: Company aggregation metrics unchanged
    // ========================================================================

    const companyId = persistedOffer!.company_id;
    const company = companiesRepo.getCompanyById(companyId);

    expect(company).toBeDefined();

    // Key aggregation fields should remain stable
    expect(company!.max_score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);
    expect(company!.offer_count).toBeGreaterThan(0);
    expect(company!.unique_offer_count).toBe(1); // Only 1 canonical offer
    expect(company!.strong_offer_count).toBe(1);
    expect(company!.avg_strong_score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);
    expect(company!.top_offer_id).toBe(persistedOffer!.id);

    // Verify no duplicate companies created
    const companyCount = db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };

    expect(companyCount.count).toBe(1);
  });

  it("should handle multiple offers from different companies correctly", async () => {
    // ========================================================================
    // ARRANGE: Prepare offers from 3 different companies
    // ========================================================================

    // Company 1: Acme Growth SL (fx01)
    const offer1 = fixtureToOffer(fx01StrongUsd, "fx01-multi-company");

    // Company 2: Different company (fx02 - modify company name)
    const offer2Fixture = {
      ...fx02NegationAws,
      profile: { name: "Tech Solutions Inc" },
    };
    const offer2 = fixtureToOffer(offer2Fixture, "fx02-multi-company");

    // Company 3: Another different company (fx05)
    const offer3Fixture = {
      ...fx05PhraseFx,
      profile: { name: "Digital Agency Ltd" },
    };
    const offer3 = fixtureToOffer(offer3Fixture, "fx05-multi-company");

    const offers = [offer1, offer2, offer3];

    // ========================================================================
    // ACT: Run ingestion
    // ========================================================================

    const result = await runOfferBatchIngestion("infojobs", offers);

    // ========================================================================
    // ASSERT: Pipeline execution
    // ========================================================================

    expect(result.result.processed).toBe(3);
    expect(result.result.upserted).toBe(3);

    // Should have 3 different companies affected
    expect(result.result.affectedCompanies).toBe(3);

    // All 3 companies should be aggregated
    expect(result.counters.companies_aggregated).toBe(3);

    // ========================================================================
    // ASSERT: Each company has correct aggregation
    // ========================================================================

    const db = dbHarness.db;

    // Count total companies
    const companyCount = db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };

    expect(companyCount.count).toBe(3);

    // Count total offers
    const offerCount = db
      .prepare("SELECT COUNT(*) as count FROM offers")
      .get() as { count: number };

    expect(offerCount.count).toBe(3);

    // Each company should have exactly 1 offer
    const companiesWithOfferCounts = db
      .prepare(
        `SELECT c.id, c.normalized_name, c.offer_count, c.unique_offer_count
         FROM companies c
         ORDER BY c.id`,
      )
      .all() as any[];

    expect(companiesWithOfferCounts.length).toBe(3);

    companiesWithOfferCounts.forEach((company) => {
      // Each company has 1 offer (activity-weighted = 1 + 0 reposts)
      expect(company.offer_count).toBe(1);
      expect(company.unique_offer_count).toBe(1);
    });

    // ========================================================================
    // ASSERT: All offers have matches
    // ========================================================================

    const matchCount = db
      .prepare("SELECT COUNT(*) as count FROM matches")
      .get() as { count: number };

    expect(matchCount.count).toBe(3);

    // At least one offer should have strong score
    const strongMatches = db
      .prepare("SELECT COUNT(*) as count FROM matches WHERE score >= ?")
      .get(STRONG_THRESHOLD) as { count: number };

    expect(strongMatches.count).toBeGreaterThanOrEqual(1);
  });

  it("should compute correct aggregation when company has mix of strong and weak offers", async () => {
    // ========================================================================
    // ARRANGE: Create 3 offers for same company (2 strong, 1 weak)
    // ========================================================================

    // Strong offer 1: fx01 with multiple tier 3 signals
    const strongOffer1 = fixtureToOffer(fx01StrongUsd, "same-company-strong-1");

    // Strong offer 2: fx05 with phrase boost
    const strongOffer2Fixture = {
      ...fx05PhraseFx,
      profile: { name: "Acme Growth SL" }, // Same company as offer1
    };
    const strongOffer2 = fixtureToOffer(
      strongOffer2Fixture,
      "same-company-strong-2",
    );

    // Weak offer: minimal content (should score low)
    const weakOfferFixture = {
      title: "Junior Developer",
      description: "Basic development work.",
      profile: { name: "Acme Growth SL" }, // Same company
      city: "Madrid",
      country: { value: "España" },
    };
    const weakOffer = fixtureToOffer(weakOfferFixture, "same-company-weak-1");

    const offers = [strongOffer1, strongOffer2, weakOffer];

    // ========================================================================
    // ACT: Run ingestion
    // ========================================================================

    const result = await runOfferBatchIngestion("infojobs", offers);

    // ========================================================================
    // ASSERT: All offers ingested into same company
    // ========================================================================

    expect(result.result.processed).toBe(3);
    expect(result.result.upserted).toBe(3);
    expect(result.result.affectedCompanies).toBe(1); // All same company

    // ========================================================================
    // ASSERT: Company aggregation reflects mix of strong/weak
    // ========================================================================

    const persistedStrongOffer1 = offersRepo.getOfferByProviderId(
      "infojobs",
      "same-company-strong-1",
    );
    const persistedWeakOffer = offersRepo.getOfferByProviderId(
      "infojobs",
      "same-company-weak-1",
    );
    const companyId = persistedStrongOffer1!.company_id;
    const company = companiesRepo.getCompanyById(companyId);

    expect(company).toBeDefined();

    // Verify weak offer actually scores below threshold
    const db = dbHarness.db;
    const weakOfferMatch = db
      .prepare("SELECT score FROM matches WHERE offer_id = ?")
      .get(persistedWeakOffer!.id) as any;

    expect(weakOfferMatch).toBeDefined();
    expect(weakOfferMatch.score).toBeLessThan(STRONG_THRESHOLD);

    // max_score should be from highest scoring offer (one of the strong ones)
    expect(company!.max_score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);

    // unique_offer_count should be 3 (all canonical)
    expect(company!.unique_offer_count).toBe(3);

    // strong_offer_count should count only offers >= STRONG_THRESHOLD
    // Verify by checking actual match scores
    const allMatches = db
      .prepare(
        "SELECT score FROM matches m JOIN offers o ON m.offer_id = o.id WHERE o.company_id = ?",
      )
      .all(companyId) as any[];

    const strongCount = allMatches.filter(
      (m) => m.score >= STRONG_THRESHOLD,
    ).length;
    expect(company!.strong_offer_count).toBe(strongCount);
    expect(strongCount).toBeGreaterThanOrEqual(1); // At least 1 strong offer

    // avg_strong_score should only average the strong offers (not the weak one)
    if (company!.strong_offer_count && company!.strong_offer_count > 0) {
      expect(company!.avg_strong_score).toBeGreaterThanOrEqual(
        STRONG_THRESHOLD,
      );
    }

    // top_offer_id should point to the offer with max_score
    const topOfferMatch = db
      .prepare("SELECT score FROM matches WHERE offer_id = ?")
      .get(company!.top_offer_id) as any;

    expect(topOfferMatch).toBeDefined();
    expect(topOfferMatch.score).toBe(company!.max_score);
    expect(topOfferMatch.score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);

    // last_strong_at should be set (we have strong offers)
    expect(company!.last_strong_at).toBeTypeOf("string");
    expect(company!.last_strong_at).toBeTruthy();
  });
});
