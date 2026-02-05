/**
 * Unit tests for Company -> Google Sheets row mapping
 *
 * Tests pure, deterministic mapping logic from DB Company entity to sheet row array
 * No DB, no network, no Google API calls
 */

import { describe, it, expect } from "vitest";
import { mapCompanyToSheetRow } from "@/sheets/companyRowMapper";
import type { Company } from "@/types/db";
import type { CatalogRuntime, CategoryRuntime } from "@/types/catalog";

/**
 * Helper: Create a minimal Company entity for testing
 */
function createTestCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 1,
    name_raw: "Test Company Inc.",
    name_display: "Test Company",
    normalized_name: "test company",
    website_url: "https://example.com",
    website_domain: "example.com",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    max_score: null,
    offer_count: null,
    unique_offer_count: null,
    strong_offer_count: null,
    avg_strong_score: null,
    top_category_id: null,
    top_offer_id: null,
    category_max_scores: null,
    last_strong_at: null,
    ...overrides,
  };
}

/**
 * Helper: Create a minimal CatalogRuntime for testing
 */
function createTestCatalog(categories: CategoryRuntime[] = []): CatalogRuntime {
  return {
    version: "1.0.0",
    categories: new Map(categories.map((cat) => [cat.id, cat])),
    keywords: [],
    phrases: [],
  };
}

describe("mapCompanyToSheetRow", () => {
  describe("column order and structure", () => {
    it("should return 10 columns in correct order", () => {
      const company = createTestCompany({
        id: 42,
        name_display: "Acme Corp",
        max_score: 8.5,
        strong_offer_count: 12,
        unique_offer_count: 15,
        offer_count: 20,
        avg_strong_score: 7.3,
        top_category_id: "cat_cloud",
        last_strong_at: "2026-02-01T10:00:00Z",
      });

      const catalog = createTestCatalog([
        { id: "cat_cloud", name: "Cloud Infrastructure", tier: 3 },
      ]);

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row).toHaveLength(10);
      expect(row[0]).toBe(42); // company_id
      expect(row[1]).toBe("Acme Corp"); // company_name
      expect(row[2]).toBe("PENDING"); // resolution
      expect(row[3]).toBe("8.5"); // max_score
      expect(row[4]).toBe(12); // strong_offers
      expect(row[5]).toBe(15); // unique_offers
      expect(row[6]).toBe(20); // posting_activity
      expect(row[7]).toBe("7.3"); // avg_strong_score
      expect(row[8]).toBe("Cloud Infrastructure"); // top_category
      expect(row[9]).toBe("2026-02-01"); // last_strong_at
    });
  });

  describe("default resolution", () => {
    it("should set resolution to PENDING for new rows", () => {
      const company = createTestCompany();
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[2]).toBe("PENDING");
    });
  });

  describe("numeric formatting", () => {
    it("should format max_score with 1 decimal place", () => {
      const company = createTestCompany({ max_score: 7.0 });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[3]).toBe("7.0");
    });

    it("should format avg_strong_score with 1 decimal place", () => {
      const company = createTestCompany({ avg_strong_score: 6.789 });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[7]).toBe("6.8");
    });

    it("should return empty string for null max_score", () => {
      const company = createTestCompany({ max_score: null });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[3]).toBe("");
    });

    it("should return empty string for null avg_strong_score", () => {
      const company = createTestCompany({ avg_strong_score: null });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[7]).toBe("");
    });
  });

  describe("null handling", () => {
    it("should return empty string for null counts", () => {
      const company = createTestCompany({
        strong_offer_count: null,
        unique_offer_count: null,
        offer_count: null,
      });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[4]).toBe(""); // strong_offers
      expect(row[5]).toBe(""); // unique_offers
      expect(row[6]).toBe(""); // posting_activity
    });

    it("should return empty string for null last_strong_at", () => {
      const company = createTestCompany({ last_strong_at: null });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[9]).toBe("");
    });

    it("should use fallback chain for company name", () => {
      // name_display is preferred
      const company1 = createTestCompany({
        name_display: "Display Name",
        normalized_name: "normalized name",
      });
      expect(mapCompanyToSheetRow(company1, createTestCatalog())[1]).toBe(
        "Display Name",
      );

      // fallback to normalized_name if name_display is null
      const company2 = createTestCompany({
        name_display: null,
        normalized_name: "normalized name",
      });
      expect(mapCompanyToSheetRow(company2, createTestCatalog())[1]).toBe(
        "normalized name",
      );

      // fallback to placeholder if both are null
      const company3 = createTestCompany({
        name_display: null,
        normalized_name: null,
      });
      expect(mapCompanyToSheetRow(company3, createTestCatalog())[1]).toBe(
        "(no name)",
      );
    });
  });

  describe("category label resolution", () => {
    it("should resolve category ID to human-readable label", () => {
      const company = createTestCompany({ top_category_id: "cat_ai" });
      const catalog = createTestCatalog([
        { id: "cat_ai", name: "Artificial Intelligence", tier: 3 },
      ]);

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[8]).toBe("Artificial Intelligence");
    });

    it("should fallback to raw category ID if catalog lookup fails", () => {
      const company = createTestCompany({ top_category_id: "cat_unknown" });
      const catalog = createTestCatalog([
        { id: "cat_ai", name: "AI", tier: 3 },
      ]);

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[8]).toBe("cat_unknown");
    });

    it("should return empty string for null category ID", () => {
      const company = createTestCompany({ top_category_id: null });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[8]).toBe("");
    });
  });

  describe("date formatting", () => {
    it("should format ISO timestamp to YYYY-MM-DD", () => {
      const company = createTestCompany({
        last_strong_at: "2026-01-30T12:34:56Z",
      });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[9]).toBe("2026-01-30");
    });

    it("should extract date from various ISO formats", () => {
      const catalog = createTestCatalog();

      const company1 = createTestCompany({
        last_strong_at: "2026-02-15T00:00:00.000Z",
      });
      expect(mapCompanyToSheetRow(company1, catalog)[9]).toBe("2026-02-15");

      const company2 = createTestCompany({
        last_strong_at: "2026-12-31T23:59:59+00:00",
      });
      expect(mapCompanyToSheetRow(company2, catalog)[9]).toBe("2026-12-31");
    });

    it("should return empty string for invalid timestamp format", () => {
      const catalog = createTestCatalog();

      const company1 = createTestCompany({ last_strong_at: "not-a-date" });
      expect(mapCompanyToSheetRow(company1, catalog)[9]).toBe("");

      const company2 = createTestCompany({ last_strong_at: "2026/01/30" });
      expect(mapCompanyToSheetRow(company2, catalog)[9]).toBe("");
    });

    it("should return empty string for empty timestamp", () => {
      const company = createTestCompany({ last_strong_at: "" });
      const catalog = createTestCatalog();

      const row = mapCompanyToSheetRow(company, catalog);

      expect(row[9]).toBe("");
    });
  });
});
