/**
 * Integration Test — Feedback Persistence: Destructive Changes
 *
 * Tests the DB persistence contract when applying validated feedback changes
 * that transition companies TO resolved states (ACCEPTED/REJECTED/ALREADY_REVOLUT).
 *
 * Verifies M6 resolution lifecycle guarantee:
 * 1. companies.resolution is updated to the target resolved state
 * 2. All offers for that company are cascade deleted
 * 3. All other company fields (metrics, aggregation signals) remain unchanged
 *
 * Uses real SQLite DB with migrations (no mocks, no network).
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import { applyValidatedFeedbackPlanToDb } from "@/sheets/feedbackPersistence";
import { validateFeedbackChangePlan } from "@/sheets/feedbackValidation";
import { getCompanyById } from "@/db/repos/companiesRepo";
import type { FeedbackChangePlan } from "@/types";

describe("Feedback Persistence — Transition TO Resolved (Destructive)", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should update resolution, delete offers, and preserve all metric fields", () => {
    harness = createTestDbSync();
    const db = harness.db;

    // Verify foreign keys enabled for cascade deletion
    db.pragma("foreign_keys = ON");

    // ARRANGE: Create company with PENDING resolution + metrics
    db.prepare(
      `INSERT INTO companies (
        id, normalized_name, name_raw, website_domain, resolution,
        max_score, offer_count, unique_offer_count, strong_offer_count,
        avg_strong_score, top_category_id, last_strong_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      1,
      "acme corp",
      "Acme Corp",
      "acme.com",
      "PENDING", // Active state
      8.5, // max_score
      3, // offer_count
      2, // unique_offer_count
      2, // strong_offer_count
      8.2, // avg_strong_score
      "cat_abc", // top_category_id
      "2026-02-01T10:00:00Z", // last_strong_at
    );

    // Snapshot metrics BEFORE transition
    const companyBefore = getCompanyById(1);
    expect(companyBefore).toBeDefined();
    expect(companyBefore!.resolution).toBe("PENDING");
    expect(companyBefore!.max_score).toBe(8.5);
    expect(companyBefore!.offer_count).toBe(3);
    expect(companyBefore!.unique_offer_count).toBe(2);
    expect(companyBefore!.strong_offer_count).toBe(2);
    expect(companyBefore!.avg_strong_score).toBe(8.2);
    expect(companyBefore!.top_category_id).toBe("cat_abc");
    expect(companyBefore!.last_strong_at).toBe("2026-02-01T10:00:00Z");

    // Insert 2 offers for this company
    db.prepare(
      `INSERT INTO offers (
        id, provider, provider_offer_id, company_id, title,
        canonical_offer_id, repost_count, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      101,
      "infojobs",
      "ij-offer-1",
      1,
      "Senior Engineer",
      101,
      0,
      "2026-02-01T10:00:00Z",
    );

    db.prepare(
      `INSERT INTO offers (
        id, provider, provider_offer_id, company_id, title,
        canonical_offer_id, repost_count, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      102,
      "infojobs",
      "ij-offer-2",
      1,
      "Backend Developer",
      102,
      0,
      "2026-02-02T10:00:00Z",
    );

    // Verify offers exist before deletion
    const offerCountBefore = db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(1) as { count: number };
    expect(offerCountBefore.count).toBe(2);

    // ACT: Apply validated feedback plan that transitions PENDING -> ACCEPTED
    const changePlan: FeedbackChangePlan = {
      changes: [
        {
          companyId: 1,
          fromResolution: "PENDING",
          toResolution: "ACCEPTED",
        },
      ],
      totalSheetRows: 1,
      knownCompanyIds: 1,
      unknownCompanyIds: 0,
      changesDetected: 1,
      unchanged: 0,
      invalidRows: 0,
    };

    const validatedPlan = validateFeedbackChangePlan(changePlan);
    const result = applyValidatedFeedbackPlanToDb(validatedPlan);

    // ASSERT: Resolution updated
    expect(result.attempted).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.offerDeletionAttempted).toBe(1);
    expect(result.offersDeleted).toBe(2);
    expect(result.offerDeletionsFailed).toBe(0);

    // ASSERT: Resolution changed in DB
    const companyAfter = getCompanyById(1);
    expect(companyAfter).toBeDefined();
    expect(companyAfter!.resolution).toBe("ACCEPTED");

    // ASSERT: Offers cascade deleted
    const offerCountAfter = db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(1) as { count: number };
    expect(offerCountAfter.count).toBe(0);

    // ASSERT: All metrics preserved exactly (no mutations)
    expect(companyAfter!.max_score).toBe(8.5);
    expect(companyAfter!.offer_count).toBe(3); // Historical count preserved
    expect(companyAfter!.unique_offer_count).toBe(2);
    expect(companyAfter!.strong_offer_count).toBe(2);
    expect(companyAfter!.avg_strong_score).toBe(8.2);
    expect(companyAfter!.top_category_id).toBe("cat_abc");
    expect(companyAfter!.last_strong_at).toBe("2026-02-01T10:00:00Z");

    // ASSERT: name/domain fields also preserved (sanity check)
    expect(companyAfter!.normalized_name).toBe("acme corp");
    expect(companyAfter!.name_raw).toBe("Acme Corp");
    expect(companyAfter!.website_domain).toBe("acme.com");
  });
});
