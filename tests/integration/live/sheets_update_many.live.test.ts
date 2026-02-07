/**
 * LIVE Integration Test — Google Sheets Multi-Row Metric Update
 *
 * This test validates real multi-row metric updates to Google Sheets (NO MOCKS).
 * Only runs when LIVE_SHEETS_TEST=1 is set.
 *
 * Validates:
 * 1. Precondition: 5 test companies (900001-900005) exist in sheet (from LIVE-1)
 * 2. Captures columns A-C (manual columns) before update
 * 3. Mutates DB metrics for 3 companies (900001, 900003, 900005)
 * 4. Runs sync and verifies columns A-C preserved, D-J updated
 *
 * Requirements (via .env or environment):
 * - LIVE_SHEETS_TEST=1
 * - GOOGLE_SHEETS_SPREADSHEET_ID=<your-test-sheet-id>
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
 * - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<service-account-private-key>
 *
 * Prerequisites: Run LIVE-1 test first to populate the 5 test companies.
 */

// Load .env for local development convenience
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { syncCompaniesToSheet } from "@/sheets/syncCompaniesToSheet";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import type { CatalogRuntime } from "@/types/catalog";
import { COMPANY_SHEET_NAME } from "@/constants";

// Skip test if not explicitly enabled
const isLiveTestEnabled = process.env.LIVE_SHEETS_TEST === "1";
const describeIf = isLiveTestEnabled ? describe : describe.skip;

describeIf("LIVE: Google Sheets Multi-Row Metric Update", () => {
  let dbHarness: TestDbHarness;

  // Test company IDs (same as LIVE-1)
  const TEST_COMPANY_IDS = [900001, 900002, 900003, 900004, 900005];
  const MUTATED_COMPANY_IDS = [900001, 900003, 900005]; // 3 companies to mutate
  const UNCHANGED_COMPANY_IDS = [900002, 900004]; // 2 companies left unchanged

  beforeEach(() => {
    // Create fresh test DB with migrations
    dbHarness = createTestDbSync();
  });

  afterEach(() => {
    // Cleanup: close DB and delete temp file
    dbHarness.cleanup();
  });

  it(
    "should update metric columns (D-J) while preserving manual columns (A-C)",
    { timeout: 20000 }, // Increase timeout for live API calls
    async () => {
      // ========================================================================
      // ARRANGE: Validate required env vars
      // ========================================================================

      const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
      const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

      if (!spreadsheetId) {
        throw new Error(
          "GOOGLE_SHEETS_SPREADSHEET_ID not set. Add it to your .env file or set as environment variable.",
        );
      }

      if (!clientEmail) {
        throw new Error(
          "GOOGLE_SERVICE_ACCOUNT_EMAIL not set. Add it to your .env file or set as environment variable.",
        );
      }

      if (!privateKey) {
        throw new Error(
          "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set. Add it to your .env file or set as environment variable.",
        );
      }

      // ========================================================================
      // ARRANGE: Create GoogleSheetsClient and verify precondition
      // ========================================================================

      const client = new GoogleSheetsClient({
        spreadsheetId,
        credentials: {
          clientEmail,
          privateKey,
        },
      });

      // Read sheet to verify test companies exist
      const preCheckResult = await client.readRange(
        `${COMPANY_SHEET_NAME}!A:J`,
      );
      if (!preCheckResult.ok) {
        throw new Error(
          `Failed to read sheet for precondition check: ${preCheckResult.error?.message}`,
        );
      }

      const preCheckValues = preCheckResult.data.values || [];
      const preCheckDataRows = preCheckValues.slice(1); // Skip header

      // Find test company rows
      const existingTestCompanies = preCheckDataRows.filter((row) => {
        const companyId = row[0] as string;
        return TEST_COMPANY_IDS.includes(parseInt(companyId, 10));
      });

      if (existingTestCompanies.length !== TEST_COMPANY_IDS.length) {
        throw new Error(
          `Precondition failed: Expected ${TEST_COMPANY_IDS.length} test companies in sheet, found ${existingTestCompanies.length}.\n` +
            `Test company IDs: ${TEST_COMPANY_IDS.join(", ")}\n` +
            `Action required: Run LIVE-1 test first to populate test companies.`,
        );
      }

      // ========================================================================
      // ARRANGE: Capture columns A-C (manual columns) before update
      // ========================================================================

      type ManualColumns = {
        companyId: string;
        companyName: string;
        resolution: string;
      };

      const manualColumnsBefore = new Map<number, ManualColumns>();

      for (const row of existingTestCompanies) {
        const companyId = parseInt(row[0] as string, 10);
        manualColumnsBefore.set(companyId, {
          companyId: row[0] as string,
          companyName: row[1] as string,
          resolution: row[2] as string,
        });
      }

      // ========================================================================
      // ARRANGE: Seed DB with all 5 companies (initial state)
      // ========================================================================

      const initialCompanyData = [
        {
          id: 900001,
          name: "Alpha Corp [LIVE TEST]",
          display: "Alpha Corp",
          normalized: "alpha corp live test",
          website: "https://alpha-test.example",
          domain: "alpha-test.example",
          max_score: 8.5,
          offer_count: 12,
          unique_offer_count: 6,
          strong_offer_count: 4,
          avg_strong_score: 8.0,
          top_category: "cat_backend",
          last_strong_at: "2026-02-07T09:00:00Z",
        },
        {
          id: 900002,
          name: "Beta Solutions [LIVE TEST]",
          display: "Beta Solutions",
          normalized: "beta solutions live test",
          website: "https://beta-test.example",
          domain: "beta-test.example",
          max_score: 7.2,
          offer_count: 8,
          unique_offer_count: 4,
          strong_offer_count: 2,
          avg_strong_score: 7.0,
          top_category: "cat_frontend",
          last_strong_at: "2026-02-07T08:00:00Z",
        },
        {
          id: 900003,
          name: "Gamma Industries [LIVE TEST]",
          display: "Gamma Industries",
          normalized: "gamma industries live test",
          website: "https://gamma-test.example",
          domain: "gamma-test.example",
          max_score: 9.1,
          offer_count: 15,
          unique_offer_count: 8,
          strong_offer_count: 6,
          avg_strong_score: 8.8,
          top_category: "cat_devops",
          last_strong_at: "2026-02-07T10:00:00Z",
        },
        {
          id: 900004,
          name: "Delta Systems [LIVE TEST]",
          display: "Delta Systems",
          normalized: "delta systems live test",
          website: "https://delta-test.example",
          domain: "delta-test.example",
          max_score: 6.5,
          offer_count: 5,
          unique_offer_count: 3,
          strong_offer_count: 1,
          avg_strong_score: 6.5,
          top_category: "cat_backend",
          last_strong_at: "2026-02-07T07:00:00Z",
        },
        {
          id: 900005,
          name: "Epsilon Labs [LIVE TEST]",
          display: "Epsilon Labs",
          normalized: "epsilon labs live test",
          website: "https://epsilon-test.example",
          domain: "epsilon-test.example",
          max_score: 7.8,
          offer_count: 10,
          unique_offer_count: 5,
          strong_offer_count: 3,
          avg_strong_score: 7.5,
          top_category: "cat_data",
          last_strong_at: "2026-02-07T11:00:00Z",
        },
      ];

      const insertCompany = dbHarness.db.prepare(`
        INSERT INTO companies (
          id,
          name_raw, name_display, normalized_name, website_url, website_domain,
          created_at, updated_at, resolution,
          max_score, offer_count, unique_offer_count, strong_offer_count,
          avg_strong_score, top_category_id, last_strong_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const company of initialCompanyData) {
        insertCompany.run(
          company.id,
          company.name,
          company.display,
          company.normalized,
          company.website,
          company.domain,
          "2026-02-07T10:00:00Z",
          "2026-02-07T10:00:00Z",
          "PENDING",
          company.max_score,
          company.offer_count,
          company.unique_offer_count,
          company.strong_offer_count,
          company.avg_strong_score,
          company.top_category,
          company.last_strong_at,
        );
      }

      // ========================================================================
      // ARRANGE: Mutate DB metrics for 3 companies (900001, 900003, 900005)
      // ========================================================================

      const mutatedMetrics = {
        900001: {
          max_score: 9.5, // Changed from 8.5
          offer_count: 20, // Changed from 12
          unique_offer_count: 10, // Changed from 6
          strong_offer_count: 8, // Changed from 4
          avg_strong_score: 9.2, // Changed from 8.0
          top_category: "cat_frontend", // Changed from cat_backend
          last_strong_at: "2026-02-07T15:00:00Z", // Changed
        },
        900003: {
          max_score: 8.0, // Changed from 9.1
          offer_count: 10, // Changed from 15
          unique_offer_count: 5, // Changed from 8
          strong_offer_count: 3, // Changed from 6
          avg_strong_score: 7.5, // Changed from 8.8
          top_category: "cat_backend", // Changed from cat_devops
          last_strong_at: "2026-02-07T14:00:00Z", // Changed
        },
        900005: {
          max_score: 9.9, // Changed from 7.8
          offer_count: 25, // Changed from 10
          unique_offer_count: 12, // Changed from 5
          strong_offer_count: 10, // Changed from 3
          avg_strong_score: 9.5, // Changed from 7.5
          top_category: "cat_devops", // Changed from cat_data
          last_strong_at: "2026-02-07T16:00:00Z", // Changed
        },
      };

      const updateMetrics = dbHarness.db.prepare(`
        UPDATE companies
        SET max_score = ?,
            offer_count = ?,
            unique_offer_count = ?,
            strong_offer_count = ?,
            avg_strong_score = ?,
            top_category_id = ?,
            last_strong_at = ?,
            updated_at = ?
        WHERE id = ?
      `);

      for (const companyId of MUTATED_COMPANY_IDS) {
        const metrics =
          mutatedMetrics[companyId as keyof typeof mutatedMetrics];
        updateMetrics.run(
          metrics.max_score,
          metrics.offer_count,
          metrics.unique_offer_count,
          metrics.strong_offer_count,
          metrics.avg_strong_score,
          metrics.top_category,
          metrics.last_strong_at,
          "2026-02-07T12:00:00Z",
          companyId,
        );
      }

      // Verify DB mutations
      for (const companyId of MUTATED_COMPANY_IDS) {
        const company = dbHarness.db
          .prepare("SELECT max_score FROM companies WHERE id = ?")
          .get(companyId) as { max_score: number };
        const expected =
          mutatedMetrics[companyId as keyof typeof mutatedMetrics].max_score;
        expect(company.max_score).toBe(expected);
      }

      // ========================================================================
      // ARRANGE: Create catalog with test categories
      // ========================================================================

      const catalog: CatalogRuntime = {
        version: "1.0.0",
        categories: new Map([
          ["cat_backend", { id: "cat_backend", name: "Backend", tier: 1 }],
          ["cat_frontend", { id: "cat_frontend", name: "Frontend", tier: 1 }],
          ["cat_devops", { id: "cat_devops", name: "DevOps", tier: 2 }],
          ["cat_data", { id: "cat_data", name: "Data", tier: 2 }],
        ]),
        keywords: [],
        phrases: [],
      };

      // ========================================================================
      // ACT: Execute sync (update phase should run)
      // ========================================================================

      const result = await syncCompaniesToSheet(client, catalog);

      // ========================================================================
      // ASSERT: Verify sync result
      // ========================================================================

      // 1. Sync completed successfully
      expect(result.ok).toBe(true);
      expect(result.totalCompanies).toBe(TEST_COMPANY_IDS.length);

      // 2. No new appends (companies already exist)
      expect(result.appendedCount).toBe(0);

      // 3. At least 3 companies updated (the mutated ones)
      // Note: Implementation may update all 5 if it doesn't detect unchanged rows
      expect(result.updatedCount).toBeGreaterThanOrEqual(
        MUTATED_COMPANY_IDS.length,
      );
      expect(result.updatedCount).toBeLessThanOrEqual(TEST_COMPANY_IDS.length);

      // 4. No errors
      expect(result.errors).toBeUndefined();

      // ========================================================================
      // ACT: Read back from Google Sheets
      // ========================================================================

      const readResult = await client.readRange(`${COMPANY_SHEET_NAME}!A:J`);

      if (!readResult.ok) {
        throw new Error(
          `Failed to read back from Google Sheets: ${readResult.error?.message}`,
        );
      }

      const sheetValues = readResult.data.values || [];
      const dataRows = sheetValues.slice(1); // Skip header

      const testCompanyRows = dataRows.filter((row) => {
        const companyId = parseInt(row[0] as string, 10);
        return TEST_COMPANY_IDS.includes(companyId);
      });

      expect(testCompanyRows.length).toBe(TEST_COMPANY_IDS.length);

      // ========================================================================
      // ASSERT: Verify columns A-C preserved for ALL 5 companies
      // ========================================================================

      for (const row of testCompanyRows) {
        const companyId = parseInt(row[0] as string, 10);
        const beforeValues = manualColumnsBefore.get(companyId);

        expect(beforeValues).toBeDefined();

        // Column A: company_id (unchanged)
        expect(row[0]).toBe(beforeValues!.companyId);

        // Column B: company_name (unchanged)
        expect(row[1]).toBe(beforeValues!.companyName);

        // Column C: resolution (unchanged)
        expect(row[2]).toBe(beforeValues!.resolution);
      }

      // ========================================================================
      // ASSERT: Verify columns D-J updated for MUTATED companies
      // ========================================================================

      for (const companyId of MUTATED_COMPANY_IDS) {
        const row = testCompanyRows.find(
          (r) => parseInt(r[0] as string, 10) === companyId,
        );
        expect(row).toBeDefined();

        const metrics =
          mutatedMetrics[companyId as keyof typeof mutatedMetrics];

        // Column D: max_score (compare as numbers, Google Sheets may format with trailing zeros)
        expect(parseFloat(row![3] as string)).toBe(metrics.max_score);

        // Column E: strong_offers (strong_offer_count)
        expect(row![4]).toBe(metrics.strong_offer_count.toString());

        // Column F: unique_offers
        expect(row![5]).toBe(metrics.unique_offer_count.toString());

        // Column G: posting_activity (offer_count)
        expect(row![6]).toBe(metrics.offer_count.toString());

        // Column H: avg_strong_score (compare as numbers)
        expect(parseFloat(row![7] as string)).toBe(metrics.avg_strong_score);

        // Column I: top_category (resolved label)
        const expectedCategory = catalog.categories.get(metrics.top_category);
        expect(row![8]).toBe(expectedCategory?.name || "");

        // Column J: last_strong_at (formatted as YYYY-MM-DD)
        const expectedDate = metrics.last_strong_at.split("T")[0];
        expect(row![9]).toBe(expectedDate);
      }

      // ========================================================================
      // ASSERT: Verify columns D-J unchanged for UNCHANGED companies
      // ========================================================================

      for (const companyId of UNCHANGED_COMPANY_IDS) {
        const row = testCompanyRows.find(
          (r) => parseInt(r[0] as string, 10) === companyId,
        );
        expect(row).toBeDefined();

        // Get original metrics from initialCompanyData
        const originalData = initialCompanyData.find((c) => c.id === companyId);
        expect(originalData).toBeDefined();

        // Column D: max_score (compare as numbers)
        expect(parseFloat(row![3] as string)).toBe(originalData!.max_score);

        // Column E: strong_offers
        expect(row![4]).toBe(originalData!.strong_offer_count.toString());

        // Column F: unique_offers
        expect(row![5]).toBe(originalData!.unique_offer_count.toString());

        // Column G: posting_activity
        expect(row![6]).toBe(originalData!.offer_count.toString());

        // Column H: avg_strong_score (compare as numbers)
        expect(parseFloat(row![7] as string)).toBe(
          originalData!.avg_strong_score,
        );

        // Column I: top_category
        const expectedCategory = catalog.categories.get(
          originalData!.top_category,
        );
        expect(row![8]).toBe(expectedCategory?.name || "");

        // Column J: last_strong_at
        const expectedDate = originalData!.last_strong_at.split("T")[0];
        expect(row![9]).toBe(expectedDate);
      }

      // ========================================================================
      // SUCCESS: Test passed
      // ========================================================================
      console.log("✅ LIVE: Multi-row metric update verified");
      console.log(`   - Spreadsheet ID: ${spreadsheetId}`);
      console.log(
        `   - Operations: appended=${result.appendedCount}, updated=${result.updatedCount}`,
      );
      console.log(
        `   - Mutated company IDs: ${MUTATED_COMPANY_IDS.join(", ")}`,
      );
      console.log(
        `   - Unchanged company IDs: ${UNCHANGED_COMPANY_IDS.join(", ")}`,
      );
      console.log("   - Manual columns (A-C) preserved: ✓");
      console.log("   - Metric columns (D-J) updated correctly: ✓");
    },
  );
});

// Print skip message when not enabled
if (!isLiveTestEnabled) {
  console.log(
    "⏭️  LIVE Google Sheets multi-row update test skipped (set LIVE_SHEETS_TEST=1 to enable)",
  );
}
