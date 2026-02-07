/**
 * LIVE Integration Test — Google Sheets Multi-Row Append
 *
 * This test validates real multi-row append to Google Sheets (NO MOCKS).
 * Only runs when LIVE_SHEETS_TEST=1 is set.
 *
 * Validates:
 * 1. Provisioning works (header + resolution dropdown)
 * 2. Sync correctly appends N=5 companies
 * 3. Read-back confirms all 5 rows exist with correct structure
 *
 * Requirements (via .env or environment):
 * - LIVE_SHEETS_TEST=1
 * - GOOGLE_SHEETS_SPREADSHEET_ID=<your-test-sheet-id>
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
 * - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<service-account-private-key>
 *
 * Idempotent: Uses fixed company IDs (900001-900005).
 * If rows already exist, treats them as "already appended" (appendedCount may be 0-5).
 */

// Load .env for local development convenience
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { syncCompaniesToSheet } from "@/sheets/syncCompaniesToSheet";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import type { CatalogRuntime } from "@/types/catalog";
import { COMPANY_SHEET_NAME, COMPANY_SHEET_HEADERS } from "@/constants";

// Skip test if not explicitly enabled
const isLiveTestEnabled = process.env.LIVE_SHEETS_TEST === "1";
const describeIf = isLiveTestEnabled ? describe : describe.skip;

describeIf("LIVE: Google Sheets Multi-Row Append", () => {
  let dbHarness: TestDbHarness;

  // Test company IDs (fixed for idempotency)
  // Range: 910001-910005 (LIVE-1 exclusive - no overlap with other tests)
  const TEST_COMPANY_IDS = [910001, 910002, 910003, 910004, 910005];
  const EXPECTED_COUNT = TEST_COMPANY_IDS.length;

  beforeEach(() => {
    // Create fresh test DB with migrations
    dbHarness = createTestDbSync();
  });

  afterEach(() => {
    // Cleanup: close DB and delete temp file
    dbHarness.cleanup();
  });

  it(
    "should append 5 companies and read them back from Google Sheets",
    { timeout: 15000 }, // Increase timeout for live API calls
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
      // ARRANGE: Seed DB with N=5 companies
      // ========================================================================

      const companyData = [
        {
          id: 910001,
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
        },
        {
          id: 910002,
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
        },
        {
          id: 910003,
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
        },
        {
          id: 910004,
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
        },
        {
          id: 910005,
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

      for (const company of companyData) {
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
          "2026-02-07T09:00:00Z",
        );
      }

      // Verify companies in DB
      const companiesInDb = dbHarness.db
        .prepare("SELECT COUNT(*) as count FROM companies")
        .get() as { count: number };
      expect(companiesInDb.count).toBe(EXPECTED_COUNT);

      // ========================================================================
      // ARRANGE: Create real GoogleSheetsClient
      // ========================================================================

      const client = new GoogleSheetsClient({
        spreadsheetId,
        credentials: {
          clientEmail,
          privateKey,
        },
      });

      // Minimal catalog with test categories
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
      // ACT: Execute real sync (NO MOCKS)
      // ========================================================================

      let result;
      try {
        result = await syncCompaniesToSheet(client, catalog);
      } catch (error) {
        // Detect missing "Companies" sheet tab
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("Unable to parse range: Companies") ||
          (errorMessage.includes("INVALID_ARGUMENT") &&
            errorMessage.includes("Companies"))
        ) {
          throw new Error(
            `Spreadsheet '${spreadsheetId}' is missing a sheet tab named 'Companies' (case-sensitive).\n` +
              `Action required:\n` +
              `1. Open: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit\n` +
              `2. Create a new sheet tab and rename it to 'Companies'\n` +
              `3. Re-run this test`,
          );
        }
        // Re-throw other errors unchanged
        throw error;
      }

      // ========================================================================
      // ASSERT: Verify sync succeeded
      // ========================================================================

      // 1. Sync completed successfully
      expect(result.ok).toBe(true);
      expect(result.totalCompanies).toBe(EXPECTED_COUNT);

      // 2. All companies were processed (appended and/or updated)
      // First run: appendedCount=5
      // Subsequent runs: appendedCount=0-5 (depending on what exists)
      expect(result.appendedCount).toBeGreaterThanOrEqual(0);
      expect(result.appendedCount).toBeLessThanOrEqual(EXPECTED_COUNT);

      // 3. No skipped companies (all should be processed)
      expect(result.skippedCount).toBe(0);

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

      expect(readResult.data.values).toBeDefined();
      const sheetValues = readResult.data.values!;

      // ========================================================================
      // ASSERT: Verify read-back structure
      // ========================================================================

      // 1. Sheet has at least header + 5 data rows
      expect(sheetValues.length).toBeGreaterThanOrEqual(EXPECTED_COUNT + 1);

      // 2. Header row matches expected structure
      const headerRow = sheetValues[0];
      expect(headerRow).toEqual(COMPANY_SHEET_HEADERS);

      // 3. Find our test company rows
      const testCompanyRows = sheetValues
        .slice(1) // Skip header
        .filter((row) => {
          const companyId = row[0]; // Column A is ID
          return (
            typeof companyId === "string" &&
            TEST_COMPANY_IDS.includes(parseInt(companyId, 10))
          );
        });

      // 4. All 5 test companies exist in sheet
      expect(testCompanyRows.length).toBe(EXPECTED_COUNT);

      // 5. Each row has correct structure (10 columns)
      for (const row of testCompanyRows) {
        expect(row.length).toBe(10); // A through J

        // Column A: company_id (numeric string)
        const companyId = row[0] as string;
        expect(typeof companyId).toBe("string");
        expect(parseInt(companyId, 10)).toBeGreaterThan(0);

        // Column B: company_name (non-empty string)
        const companyName = row[1] as string;
        expect(typeof companyName).toBe("string");
        expect(companyName.length).toBeGreaterThan(0);

        // Column C: resolution (should be "PENDING" for our test data)
        expect(row[2]).toBe("PENDING");

        // Column D: max_score (numeric string or number)
        expect(row[3]).toBeDefined();

        // Columns E-J: other metrics (defined but may be null/empty)
        expect(row[4]).toBeDefined(); // strong_offers
        expect(row[5]).toBeDefined(); // unique_offers
        expect(row[6]).toBeDefined(); // posting_activity
        expect(row[7]).toBeDefined(); // avg_strong_score
        expect(row[8]).toBeDefined(); // top_category
        expect(row[9]).toBeDefined(); // last_strong_at
      }

      // 6. Verify specific company IDs are present
      const foundCompanyIds = testCompanyRows.map((row) =>
        parseInt(row[0] as string, 10),
      );
      for (const expectedId of TEST_COMPANY_IDS) {
        expect(foundCompanyIds).toContain(expectedId);
      }

      // ========================================================================
      // SUCCESS: Test passed
      // ========================================================================
      console.log("✅ LIVE: Multi-row append verified");
      console.log(`   - Spreadsheet ID: ${spreadsheetId}`);
      console.log(
        `   - Operations: appended=${result.appendedCount}, updated=${result.updatedCount}`,
      );
      console.log(`   - Test company IDs: ${TEST_COMPANY_IDS.join(", ")}`);
      console.log(`   - Rows found in sheet: ${testCompanyRows.length}`);
    },
  );
});

// Print skip message when not enabled
if (!isLiveTestEnabled) {
  console.log(
    "⏭️  LIVE Google Sheets multi-row append test skipped (set LIVE_SHEETS_TEST=1 to enable)",
  );
}
