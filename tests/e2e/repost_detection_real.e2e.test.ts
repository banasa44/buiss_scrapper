/**
 * E2E Test: Real Repost Detection (Content-Based Duplicate Detection)
 *
 * Validates the REAL repost detection implementation (Task 3):
 * - New provider_offer_id with DUPLICATE CONTENT (exact title OR high description similarity)
 *   does NOT create a new offer row
 * - DOES increment repost_count on the canonical offer
 * - DOES update last_seen_at on the canonical offer
 * - Company aggregation reflects activity-weighted offer counts from repost_count
 *
 * This tests content-based duplicate detection, not just (provider, provider_offer_id) uniqueness.
 *
 * Tests with real SQLite DB, real migrations, and foreign keys ENABLED.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../helpers/testDb";
import { runOfferBatchIngestion } from "@/ingestion";
import type { JobOfferDetail } from "@/types";
import * as offersRepo from "@/db/repos/offersRepo";
import * as companiesRepo from "@/db/repos/companiesRepo";

describe("E2E: Real Repost Detection (Content-Based)", () => {
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
   * Helper to create test offer with specific fields
   */
  function createOffer(
    offerId: string,
    title: string,
    description: string,
    updatedAt: string,
    companyName = "Acme Corp",
  ): JobOfferDetail {
    return {
      ref: {
        provider: "infojobs",
        id: offerId,
        url: `https://www.infojobs.net/${offerId}`,
      },
      title,
      company: {
        name: companyName,
        normalizedName: companyName.toLowerCase().replace(/[^a-z0-9\s]/g, ""),
        websiteUrl: "https://acmecorp.com",
      },
      location: {
        city: "Madrid",
      },
      description,
      publishedAt: "2024-01-10T10:00:00Z",
      updatedAt,
    };
  }

  it("duplicate offer (exact title) does not create a new offer row", async () => {
    // ========================================================================
    // ARRANGE: Create two offers with SAME TITLE, DIFFERENT provider_offer_id
    // ========================================================================

    const canonicalUpdatedAt = "2024-01-10T12:00:00Z";
    const duplicateUpdatedAt = "2024-01-15T14:30:00Z"; // 5 days later

    const offerA = createOffer(
      "offer-canonical-001",
      "Senior Backend Developer", // Title that will match
      "We are looking for a senior backend developer with experience in Node.js and TypeScript.",
      canonicalUpdatedAt,
    );

    const offerB = createOffer(
      "offer-duplicate-002", // DIFFERENT provider_offer_id
      "Senior Backend Developer", // SAME title (exact match after normalization)
      "Different description here, but title matches exactly.",
      duplicateUpdatedAt,
    );

    // ========================================================================
    // ACT: Ingest canonical offer first, then duplicate
    // ========================================================================

    const firstRun = await runOfferBatchIngestion("infojobs", [offerA]);
    const secondRun = await runOfferBatchIngestion("infojobs", [offerB]);

    // ========================================================================
    // ASSERT: First run creates offer, second run detects duplicate
    // ========================================================================

    expect(firstRun.result.processed).toBe(1);
    expect(firstRun.result.upserted).toBe(1);
    expect(firstRun.result.duplicates).toBe(0);

    expect(secondRun.result.processed).toBe(1);
    expect(secondRun.result.upserted).toBe(0); // NOT upserted
    expect(secondRun.result.duplicates).toBe(1); // Detected as duplicate

    // ========================================================================
    // ASSERT: Only ONE canonical offer row exists
    // ========================================================================

    const db = dbHarness.db;

    const canonicalOffers = db
      .prepare(
        "SELECT * FROM offers WHERE provider = ? AND canonical_offer_id IS NULL ORDER BY id",
      )
      .all("infojobs") as any[];

    expect(canonicalOffers.length).toBe(1);

    const canonical = canonicalOffers[0];

    // Canonical offer should be the first one (offer A)
    expect(canonical.provider_offer_id).toBe("offer-canonical-001");

    // ========================================================================
    // ASSERT: Canonical offer has incremented repost_count
    // ========================================================================

    expect(canonical.repost_count).toBe(1);

    // ========================================================================
    // ASSERT: Canonical offer has updated last_seen_at
    // ========================================================================

    // last_seen_at should be from offer B (the duplicate), using its updatedAt
    expect(canonical.last_seen_at).toBe(duplicateUpdatedAt);

    // ========================================================================
    // ASSERT: Offer B was never inserted as a row
    // ========================================================================

    const allOffers = db
      .prepare("SELECT * FROM offers WHERE provider = ?")
      .all("infojobs") as any[];

    expect(allOffers.length).toBe(1); // Only canonical offer exists

    const offerBInDb = offersRepo.getOfferByProviderId(
      "infojobs",
      "offer-duplicate-002",
    );
    expect(offerBInDb).toBeUndefined(); // Offer B was never inserted
  });

  it("aggregation reflects repost activity in offer_count", async () => {
    // ========================================================================
    // ARRANGE: Create canonical offer + duplicate
    // ========================================================================

    const offerA = createOffer(
      "agg-canonical-001",
      "Full Stack Engineer",
      "We need a full stack engineer with React and Node.js experience.",
      "2024-01-10T12:00:00Z",
    );

    const offerB = createOffer(
      "agg-duplicate-002",
      "Full Stack Engineer", // Same title
      "Looking for full stack engineer to join our team.",
      "2024-01-15T14:00:00Z",
    );

    // ========================================================================
    // ACT: Ingest both offers (second is duplicate)
    // ========================================================================

    await runOfferBatchIngestion("infojobs", [offerA]);
    await runOfferBatchIngestion("infojobs", [offerB]);

    // ========================================================================
    // ASSERT: Company aggregation reflects activity
    // ========================================================================

    const db = dbHarness.db;

    const canonical = db
      .prepare(
        "SELECT * FROM offers WHERE provider_offer_id = ? AND provider = ?",
      )
      .get("agg-canonical-001", "infojobs") as any;

    expect(canonical).toBeDefined();
    expect(canonical.repost_count).toBe(1);

    const companyId = canonical.company_id;
    const company = companiesRepo.getCompanyById(companyId);

    expect(company).toBeDefined();

    // ========================================================================
    // ASSERT: Offer counts
    // ========================================================================

    // unique_offer_count = number of canonical offers (canonical_offer_id IS NULL)
    expect(company!.unique_offer_count).toBe(1);

    // offer_count = activity-weighted = 1 canonical + 1 repost = 2
    // Formula: SUM(1 + repost_count) for canonical offers
    expect(company!.offer_count).toBe(2);

    // ========================================================================
    // ASSERT: max_score unchanged (no new offer scored)
    // ========================================================================

    // max_score should be the score from the canonical offer
    const match = db
      .prepare("SELECT score FROM matches WHERE offer_id = ?")
      .get(canonical.id) as any;

    if (match) {
      expect(company!.max_score).toBe(match.score);
    }

    // ========================================================================
    // ASSERT: top_offer_id remains the canonical offer
    // ========================================================================

    expect(company!.top_offer_id).toBe(canonical.id);
  });

  it("same provider_offer_id is update, not repost (repost_count stays 0)", async () => {
    // ========================================================================
    // ARRANGE: Create same offer ingested twice (same provider_offer_id)
    // ========================================================================

    const firstUpdatedAt = "2024-01-10T10:00:00Z";
    const secondUpdatedAt = "2024-01-20T15:00:00Z"; // 10 days later

    const offerV1 = createOffer(
      "same-offer-001",
      "DevOps Engineer",
      "Original description for DevOps role.",
      firstUpdatedAt,
    );

    const offerV2 = createOffer(
      "same-offer-001", // SAME provider_offer_id
      "DevOps Engineer - Updated", // Slightly different title
      "Updated description for DevOps role with more details.",
      secondUpdatedAt,
    );

    // ========================================================================
    // ACT: Ingest same offer twice
    // ========================================================================

    const firstRun = await runOfferBatchIngestion("infojobs", [offerV1]);
    const secondRun = await runOfferBatchIngestion("infojobs", [offerV2]);

    // ========================================================================
    // ASSERT: Both runs succeed, but duplicate counter is 0
    // ========================================================================

    expect(firstRun.result.processed).toBe(1);
    expect(firstRun.result.upserted).toBe(1);
    expect(firstRun.result.duplicates).toBe(0);

    expect(secondRun.result.processed).toBe(1);
    expect(secondRun.result.upserted).toBe(1); // Upsert (update)
    expect(secondRun.result.duplicates).toBe(0); // NOT a repost

    // ========================================================================
    // ASSERT: Only ONE offer row exists
    // ========================================================================

    const db = dbHarness.db;

    const allOffers = db
      .prepare(
        "SELECT * FROM offers WHERE provider = ? AND provider_offer_id = ?",
      )
      .all("infojobs", "same-offer-001") as any[];

    expect(allOffers.length).toBe(1);

    const offer = allOffers[0];

    // ========================================================================
    // ASSERT: repost_count is 0 (not a content duplicate, just an update)
    // ========================================================================

    expect(offer.repost_count).toBe(0);

    // ========================================================================
    // ASSERT: Offer content is updated (second version)
    // ========================================================================

    expect(offer.title).toBe("DevOps Engineer - Updated");
    expect(offer.description).toContain("Updated description");

    // ========================================================================
    // ASSERT: last_seen_at is updated to second ingestion time
    // ========================================================================

    expect(offer.last_seen_at).toBe(secondUpdatedAt);

    // ========================================================================
    // ASSERT: Company aggregation shows 1 unique offer with offer_count = 1
    // ========================================================================

    const companyId = offer.company_id;
    const company = companiesRepo.getCompanyById(companyId);

    expect(company).toBeDefined();
    expect(company!.unique_offer_count).toBe(1);
    expect(company!.offer_count).toBe(1); // 1 + 0 reposts = 1
  });

  it("description similarity detects duplicate (titles differ)", async () => {
    // ========================================================================
    // ARRANGE: Create two offers with DIFFERENT titles, SIMILAR descriptions
    // ========================================================================

    // Long description that will be reused with high overlap
    const sharedDescription = `
      We are seeking an experienced software engineer to join our growing team.
      The ideal candidate will have strong skills in JavaScript, TypeScript, React, and Node.js.
      You will be responsible for building scalable web applications and working closely with our design team.
      Experience with AWS, Docker, and Kubernetes is a plus.
      We offer competitive salary, remote work options, and excellent benefits.
      Join us in building the future of software development.
    `.trim();

    const offerA = createOffer(
      "desc-canonical-001",
      "Software Engineer Position", // Different title
      sharedDescription,
      "2024-01-10T12:00:00Z",
    );

    const offerB = createOffer(
      "desc-duplicate-002",
      "Engineer Role at Tech Company", // Different title (won't match exactly)
      sharedDescription, // SAME description (high similarity)
      "2024-01-15T14:00:00Z",
    );

    // ========================================================================
    // ACT: Ingest both offers
    // ========================================================================

    const firstRun = await runOfferBatchIngestion("infojobs", [offerA]);
    const secondRun = await runOfferBatchIngestion("infojobs", [offerB]);

    // ========================================================================
    // ASSERT: Second offer detected as duplicate via description similarity
    // ========================================================================

    expect(firstRun.result.duplicates).toBe(0);
    expect(secondRun.result.duplicates).toBe(1);

    // ========================================================================
    // ASSERT: Only one canonical offer exists
    // ========================================================================

    const db = dbHarness.db;

    const canonicalOffers = db
      .prepare(
        "SELECT * FROM offers WHERE provider = ? AND canonical_offer_id IS NULL",
      )
      .all("infojobs") as any[];

    expect(canonicalOffers.length).toBe(1);

    const canonical = canonicalOffers[0];
    expect(canonical.provider_offer_id).toBe("desc-canonical-001");
    expect(canonical.repost_count).toBe(1);

    // ========================================================================
    // ASSERT: Offer B was never inserted
    // ========================================================================

    const offerBInDb = offersRepo.getOfferByProviderId(
      "infojobs",
      "desc-duplicate-002",
    );
    expect(offerBInDb).toBeUndefined();
  });

  it("multiple reposts increment repost_count correctly", async () => {
    // ========================================================================
    // ARRANGE: Create 1 canonical + 3 duplicates
    // ========================================================================

    const baseTitle = "Product Manager Role";
    const baseDescription = "Seeking product manager with 5+ years experience.";

    const canonical = createOffer(
      "multi-canonical",
      baseTitle,
      baseDescription,
      "2024-01-10T10:00:00Z",
    );

    const duplicate1 = createOffer(
      "multi-dup-1",
      baseTitle, // Same title
      "Different description 1",
      "2024-01-11T10:00:00Z",
    );

    const duplicate2 = createOffer(
      "multi-dup-2",
      baseTitle, // Same title
      "Different description 2",
      "2024-01-12T10:00:00Z",
    );

    const duplicate3 = createOffer(
      "multi-dup-3",
      baseTitle, // Same title
      "Different description 3",
      "2024-01-13T10:00:00Z",
    );

    // ========================================================================
    // ACT: Ingest all 4 offers
    // ========================================================================

    await runOfferBatchIngestion("infojobs", [canonical]);
    const run2 = await runOfferBatchIngestion("infojobs", [duplicate1]);
    const run3 = await runOfferBatchIngestion("infojobs", [duplicate2]);
    const run4 = await runOfferBatchIngestion("infojobs", [duplicate3]);

    // ========================================================================
    // ASSERT: Each duplicate detected
    // ========================================================================

    expect(run2.result.duplicates).toBe(1);
    expect(run3.result.duplicates).toBe(1);
    expect(run4.result.duplicates).toBe(1);

    // ========================================================================
    // ASSERT: Only 1 canonical offer with repost_count = 3
    // ========================================================================

    const db = dbHarness.db;

    const canonicalOffers = db
      .prepare(
        "SELECT * FROM offers WHERE provider = ? AND canonical_offer_id IS NULL",
      )
      .all("infojobs") as any[];

    expect(canonicalOffers.length).toBe(1);

    const persistedCanonical = canonicalOffers[0];
    expect(persistedCanonical.provider_offer_id).toBe("multi-canonical");
    expect(persistedCanonical.repost_count).toBe(3);

    // ========================================================================
    // ASSERT: last_seen_at is from the last duplicate
    // ========================================================================

    expect(persistedCanonical.last_seen_at).toBe("2024-01-13T10:00:00Z");

    // ========================================================================
    // ASSERT: Company aggregation reflects all activity
    // ========================================================================

    const companyId = persistedCanonical.company_id;
    const company = companiesRepo.getCompanyById(companyId);

    expect(company).toBeDefined();
    expect(company!.unique_offer_count).toBe(1); // 1 canonical
    expect(company!.offer_count).toBe(4); // 1 + 3 reposts = 4
  });

  it("duplicates across different companies are NOT detected", async () => {
    // ========================================================================
    // ARRANGE: Create same-title offers for DIFFERENT companies
    // ========================================================================

    const sharedTitle = "Frontend Developer";

    const offerCompanyA = createOffer(
      "company-a-offer",
      sharedTitle,
      "Frontend role at Company A",
      "2024-01-10T10:00:00Z",
      "TechCorp International", // Distinct company name
    );

    // Modify to ensure company B is actually different
    const offerCompanyB: JobOfferDetail = {
      ref: {
        provider: "infojobs",
        id: "company-b-offer",
        url: "https://www.infojobs.net/company-b-offer",
      },
      title: sharedTitle, // Same title
      company: {
        name: "GlobalSoft Solutions", // DIFFERENT company
        normalizedName: "globalsoft solutions",
        websiteUrl: "https://globalsoft.com", // DIFFERENT website
      },
      location: {
        city: "Barcelona",
      },
      description: "Frontend role at Company B",
      publishedAt: "2024-01-11T10:00:00Z",
      updatedAt: "2024-01-11T10:00:00Z",
    };

    // ========================================================================
    // ACT: Ingest both offers
    // ========================================================================

    const run1 = await runOfferBatchIngestion("infojobs", [offerCompanyA]);
    const run2 = await runOfferBatchIngestion("infojobs", [offerCompanyB]);

    // ========================================================================
    // ASSERT: No duplicates detected (different companies)
    // ========================================================================

    expect(run1.result.duplicates).toBe(0);
    expect(run2.result.duplicates).toBe(0);

    // ========================================================================
    // ASSERT: 2 canonical offers exist (one per company)
    // ========================================================================

    const db = dbHarness.db;

    const canonicalOffers = db
      .prepare(
        "SELECT * FROM offers WHERE provider = ? AND canonical_offer_id IS NULL",
      )
      .all("infojobs") as any[];

    expect(canonicalOffers.length).toBe(2);

    // Each should have repost_count = 0
    canonicalOffers.forEach((offer) => {
      expect(offer.repost_count).toBe(0);
    });

    // Should have different company_ids
    const companyIds = new Set(canonicalOffers.map((o) => o.company_id));
    expect(companyIds.size).toBe(2); // Two distinct companies
  });
});
