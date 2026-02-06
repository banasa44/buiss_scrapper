/**
 * LIVE Integration Test — Google Sheets Connectivity Smoke Test
 *
 * This test validates real Google Sheets connectivity (NO MOCKS).
 * Only runs when LIVE_SHEETS_TEST=1 is set.
 *
 * Validates:
 * 1. Service account authentication works
 * 2. Header enforcement works on real sheet
 * 3. Append/update a sentinel company (idempotent)
 *
 * Requirements (via .env or environment):
 * - LIVE_SHEETS_TEST=1
 * - GOOGLE_SHEETS_SPREADSHEET_ID=<your-test-sheet-id>
 * - GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL=<service-account-email>
 * - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<service-account-private-key>
 *
 * Idempotent: Can be run multiple times without growing rows forever.
 * Uses sentinel company_id=999999 for test data.
 */

// Load .env for local development convenience
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { syncCompaniesToSheet } from "@/sheets/syncCompaniesToSheet";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import type { CatalogRuntime } from "@/types/catalog";

// Skip test if not explicitly enabled
const isLiveTestEnabled = process.env.LIVE_SHEETS_TEST === "1";
const describeIf = isLiveTestEnabled ? describe : describe.skip;

describeIf("LIVE: Google Sheets Connectivity", () => {
  let dbHarness: TestDbHarness;

  // Sentinel company ID for test data
  const SENTINEL_COMPANY_ID = 999999;

  beforeEach(() => {
    // Create fresh test DB with migrations
    dbHarness = createTestDbSync();
  });

  afterEach(() => {
    // Cleanup: close DB and delete temp file
    dbHarness.cleanup();
  });

  it("should authenticate, enforce header, and append/update sentinel company", async () => {
    // ========================================================================
    // ARRANGE: Validate required env vars
    // ========================================================================

    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    if (!spreadsheetId) {
      throw new Error(
        "GOOGLE_SHEETS_SPREADSHEET_ID not set. Add it to your .env file or set as environment variable.",
      );
    }

    if (!clientEmail) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL not set. Add it to your .env file or set as environment variable.",
      );
    }

    if (!privateKey) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set. Add it to your .env file or set as environment variable.",
      );
    }

    // ========================================================================
    // ARRANGE: Seed DB with sentinel company
    // ========================================================================

    const companyId = dbHarness.db
      .prepare(
        `
      INSERT INTO companies (
        id,
        name_raw, name_display, normalized_name, website_url, website_domain,
        created_at, updated_at, resolution,
        max_score, offer_count, unique_offer_count, strong_offer_count,
        avg_strong_score, top_category_id, last_strong_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        SENTINEL_COMPANY_ID, // Fixed ID for idempotency
        "Test Company [LIVE SMOKE TEST]",
        "Test Co [LIVE]",
        "test company live smoke test",
        "https://test.example",
        "test.example",
        "2026-02-06T10:00:00Z",
        "2026-02-06T10:00:00Z",
        "PENDING",
        7.5, // max_score
        5, // offer_count
        3, // unique_offer_count
        2, // strong_offer_count
        7.0, // avg_strong_score
        "cat_test", // top_category_id
        "2026-02-06T09:00:00Z", // last_strong_at
      ).lastInsertRowid as number;

    // Verify company in DB
    expect(companyId).toBe(SENTINEL_COMPANY_ID);

    const companiesInDb = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };
    expect(companiesInDb.count).toBe(1);

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

    // Minimal catalog
    const catalog: CatalogRuntime = {
      version: "1.0.0",
      categories: new Map([
        ["cat_test", { id: "cat_test", name: "Test Category", tier: 3 }],
      ]),
      keywords: [],
      phrases: [],
    };

    // ========================================================================
    // ACT: Execute real sync (NO MOCKS)
    // ========================================================================

    const result = await syncCompaniesToSheet(client, catalog);

    // ========================================================================
    // ASSERT: Verify sync succeeded
    // ========================================================================

    // 1. Sync completed successfully
    expect(result.ok).toBe(true);
    expect(result.totalCompanies).toBe(1);

    // 2. Either appended (first run) or updated (subsequent runs)
    const operationCount = result.appendedCount + result.updatedCount;
    expect(operationCount).toBe(1);

    // 3. No skips or errors
    expect(result.skippedCount).toBe(0);
    expect(result.errors).toBeUndefined();

    // 4. DB unchanged (export is read-only on DB side)
    const companiesAfter = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };
    expect(companiesAfter.count).toBe(1);

    // ========================================================================
    // SUCCESS: Test passed
    // ========================================================================
    console.log("✅ LIVE: Google Sheets connectivity verified");
    console.log(`   - Spreadsheet ID: ${spreadsheetId}`);
    console.log(
      `   - Operation: ${result.appendedCount > 0 ? "APPEND" : "UPDATE"}`,
    );
    console.log(`   - Sentinel company ID: ${SENTINEL_COMPANY_ID}`);
  });
});

// Print skip message when not enabled
if (!isLiveTestEnabled) {
  console.log(
    "⏭️  LIVE Google Sheets tests skipped (set LIVE_SHEETS_TEST=1 to enable)",
  );
}
