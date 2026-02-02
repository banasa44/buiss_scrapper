/**
 * Integration Test — Company Aggregation Persistence (M4)
 *
 * Tests the full aggregateCompanyAndPersist pipeline using real SQLite DB
 * with real migrations and repos. No mocks for database or repositories.
 *
 * Verifies:
 * 1. Company aggregation metrics computed correctly from offers + matches
 * 2. Aggregation results persisted to companies table
 * 3. Idempotency: running aggregation twice produces same result
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import { aggregateCompanyAndPersist } from "@/signal/aggregation/aggregateCompanyAndPersist";
import { getCompanyById } from "@/db/repos/companiesRepo";
import { STRONG_THRESHOLD } from "@/constants/scoring";

describe("Company Aggregation Persistence", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should compute and persist company aggregation metrics correctly", () => {
    harness = createTestDbSync();
    const db = harness.db;

    // Explicitly verify foreign keys are enabled
    db.pragma("foreign_keys = ON");

    // Arrange: Seed minimal data
    // 1. Create company
    db.prepare(
      `INSERT INTO companies (id, normalized_name, name_raw, website_domain)
       VALUES (?, ?, ?, ?)`,
    ).run(1, "tech corp", "Tech Corp", "techcorp.com");

    // 2. Create offers: 2 canonical + 1 duplicate
    // Canonical offer 1: score=7 (strong), cat_tier3
    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      101,
      "infojobs",
      "offer-1",
      1,
      "Senior Engineer",
      null, // canonical
      2, // 2 reposts
      "2024-01-15T10:00:00Z",
    );

    // Canonical offer 2: score=5 (not strong), cat_tier2
    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      102,
      "infojobs",
      "offer-2",
      1,
      "Junior Developer",
      null, // canonical
      0, // no reposts
      "2024-01-10T10:00:00Z",
      "2024-01-20T10:00:00Z",
    );

    // Duplicate offer (points to canonical 101)
    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      103,
      "infojobs",
      "offer-3",
      1,
      "Senior Engineer (repost)",
      101, // duplicate of offer 101
      0,
      "2024-01-16T10:00:00Z",
    );

    // 3. Create matches for canonical offers (duplicate has no match, as expected)
    // Match for offer 101: strong score (7), topCategoryId = cat_tier3
    db.prepare(
      `INSERT INTO matches (offer_id, score, matched_keywords_json)
       VALUES (?, ?, ?)`,
    ).run(
      101,
      7,
      JSON.stringify({
        score: 7,
        topCategoryId: "cat_tier3",
        reasons: { categories: [{ categoryId: "cat_tier3", points: 7 }] },
      }),
    );

    // Match for offer 102: not strong (5), topCategoryId = cat_tier2
    db.prepare(
      `INSERT INTO matches (offer_id, score, matched_keywords_json)
       VALUES (?, ?, ?)`,
    ).run(
      102,
      5,
      JSON.stringify({
        score: 5,
        topCategoryId: "cat_tier2",
        reasons: { categories: [{ categoryId: "cat_tier2", points: 5 }] },
      }),
    );

    // Act: Run aggregation
    const result = aggregateCompanyAndPersist(1);

    // Assert: Verify returned company has correct aggregation
    expect(result.id).toBe(1);
    expect(result.max_score).toBe(7); // max of canonical offers (7, 5)
    expect(result.offer_count).toBe(4); // (1 + 2) + (1 + 0) = 4 (activity-weighted)
    expect(result.unique_offer_count).toBe(2); // 2 canonical offers
    expect(result.strong_offer_count).toBe(1); // only offer 101 is strong (>= 6)
    expect(result.avg_strong_score).toBe(7); // average of strong scores: 7/1 = 7
    expect(result.top_category_id).toBe("cat_tier3"); // from topOffer (101)
    expect(result.top_offer_id).toBe(101); // offer with max score
    expect(result.last_strong_at).toBe("2024-01-15T10:00:00Z"); // publishedAt of offer 101

    // Verify category_max_scores JSON
    const categoryMaxScores = JSON.parse(
      result.category_max_scores as string,
    ) as Record<string, number>;
    expect(categoryMaxScores).toEqual({
      cat_tier3: 7,
      cat_tier2: 5,
    });

    // Verify DB persistence
    const dbCompany = getCompanyById(1);
    expect(dbCompany).toBeDefined();
    expect(dbCompany?.max_score).toBe(7);
    expect(dbCompany?.offer_count).toBe(4);
    expect(dbCompany?.unique_offer_count).toBe(2);
    expect(dbCompany?.strong_offer_count).toBe(1);
    expect(dbCompany?.avg_strong_score).toBe(7);
    expect(dbCompany?.top_category_id).toBe("cat_tier3");
    expect(dbCompany?.top_offer_id).toBe(101);
    expect(dbCompany?.last_strong_at).toBe("2024-01-15T10:00:00Z");
  });

  it("should be idempotent (running twice produces same result)", () => {
    harness = createTestDbSync();
    const db = harness.db;

    // Explicitly verify foreign keys are enabled
    db.pragma("foreign_keys = ON");

    // Arrange: Seed company and offers
    db.prepare(
      `INSERT INTO companies (id, normalized_name, name_raw)
       VALUES (?, ?, ?)`,
    ).run(1, "test company", "Test Company");

    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      101,
      "infojobs",
      "offer-1",
      1,
      "Test Job",
      null,
      1,
      "2024-01-01T10:00:00Z",
    );

    db.prepare(
      `INSERT INTO matches (offer_id, score, matched_keywords_json)
       VALUES (?, ?, ?)`,
    ).run(
      101,
      8,
      JSON.stringify({
        score: 8,
        topCategoryId: "cat_test",
        reasons: {},
      }),
    );

    // Act: Run aggregation twice
    const firstResult = aggregateCompanyAndPersist(1);
    const secondResult = aggregateCompanyAndPersist(1);

    // Assert: Both runs produce identical results
    expect(firstResult.max_score).toBe(secondResult.max_score);
    expect(firstResult.offer_count).toBe(secondResult.offer_count);
    expect(firstResult.unique_offer_count).toBe(
      secondResult.unique_offer_count,
    );
    expect(firstResult.strong_offer_count).toBe(
      secondResult.strong_offer_count,
    );
    expect(firstResult.avg_strong_score).toBe(secondResult.avg_strong_score);
    expect(firstResult.top_category_id).toBe(secondResult.top_category_id);
    expect(firstResult.top_offer_id).toBe(secondResult.top_offer_id);
    expect(firstResult.last_strong_at).toBe(secondResult.last_strong_at);
    expect(firstResult.category_max_scores).toBe(
      secondResult.category_max_scores,
    );

    // Verify expected values
    expect(firstResult.max_score).toBe(8);
    expect(firstResult.offer_count).toBe(2); // 1 + repost_count(1)
    expect(firstResult.unique_offer_count).toBe(1);
    expect(firstResult.strong_offer_count).toBe(1); // score 8 >= STRONG_THRESHOLD (6)
    expect(firstResult.avg_strong_score).toBe(8);
    expect(firstResult.top_category_id).toBe("cat_test");
    expect(firstResult.top_offer_id).toBe(101);
  });

  it("should handle company with no canonical offers correctly", () => {
    harness = createTestDbSync();
    const db = harness.db;

    // Explicitly verify foreign keys are enabled
    db.pragma("foreign_keys = ON");

    // Arrange: Company with only duplicate offers (no canonical)
    db.prepare(
      `INSERT INTO companies (id, normalized_name, name_raw)
       VALUES (?, ?, ?)`,
    ).run(1, "test company", "Test Company");

    // Create duplicate offer (no canonical)
    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      101,
      "infojobs",
      "offer-dup",
      1,
      "Duplicate Job",
      999,
      0,
      "2024-01-01T10:00:00Z",
    );

    // Act: Run aggregation
    const result = aggregateCompanyAndPersist(1);

    // Assert: All metrics should be default/zero
    expect(result.max_score).toBe(0);
    expect(result.offer_count).toBe(0);
    expect(result.unique_offer_count).toBe(0);
    expect(result.strong_offer_count).toBe(0);
    expect(result.avg_strong_score).toBeNull();
    expect(result.top_category_id).toBeNull();
    expect(result.top_offer_id).toBeNull();
    expect(result.last_strong_at).toBeNull();
    expect(result.category_max_scores).toBe("{}");
  });

  it("should correctly compute lastStrongAt from most recent strong offer", () => {
    harness = createTestDbSync();
    const db = harness.db;

    // Explicitly verify foreign keys are enabled
    db.pragma("foreign_keys = ON");

    // Arrange: Company with multiple strong offers
    db.prepare(
      `INSERT INTO companies (id, normalized_name, name_raw)
       VALUES (?, ?, ?)`,
    ).run(1, "test company", "Test Company");

    // Strong offer 1 (older)
    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      101,
      "infojobs",
      "offer-1",
      1,
      "Job 1",
      null,
      0,
      "2024-01-01T10:00:00Z",
    );

    // Strong offer 2 (newer - should be lastStrongAt)
    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      102,
      "infojobs",
      "offer-2",
      1,
      "Job 2",
      null,
      0,
      "2024-01-15T10:00:00Z",
    );

    // Not strong offer (newer but not strong)
    db.prepare(
      `INSERT INTO offers (id, provider, provider_offer_id, company_id, title, 
                           canonical_offer_id, repost_count, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      103,
      "infojobs",
      "offer-3",
      1,
      "Job 3",
      null,
      0,
      "2024-01-20T10:00:00Z",
    );

    // Matches
    db.prepare(
      `INSERT INTO matches (offer_id, score, matched_keywords_json)
       VALUES (?, ?, ?)`,
    ).run(101, 7, JSON.stringify({ score: 7, topCategoryId: "cat_a" }));

    db.prepare(
      `INSERT INTO matches (offer_id, score, matched_keywords_json)
       VALUES (?, ?, ?)`,
    ).run(102, 8, JSON.stringify({ score: 8, topCategoryId: "cat_a" }));

    db.prepare(
      `INSERT INTO matches (offer_id, score, matched_keywords_json)
       VALUES (?, ?, ?)`,
    ).run(103, 4, JSON.stringify({ score: 4, topCategoryId: "cat_a" }));

    // Act: Run aggregation
    const result = aggregateCompanyAndPersist(1);

    // Assert: lastStrongAt should be from offer 102 (most recent strong)
    expect(result.last_strong_at).toBe("2024-01-15T10:00:00Z");
    expect(result.strong_offer_count).toBe(2); // offers 101 and 102
  });
});
