/**
 * LIVE Integration Test — Google Sheets Feedback Loop Application
 *
 * This test validates the complete M6 feedback loop (NO MOCKS):
 * 1. Read feedback from real Google Sheets
 * 2. Build and validate change plan
 * 3. Apply changes to DB
 * 4. Verify DB side effects
 *
 * Only runs when LIVE_SHEETS_TEST=1 is set.
 *
 * Validates two lifecycle transitions:
 * - ACTIVE -> RESOLVED: deletes offers
 * - RESOLVED -> ACTIVE: preserves offers
 *
 * Requirements (via .env or environment):
 * - LIVE_SHEETS_TEST=1
 * - GOOGLE_SHEETS_SPREADSHEET_ID=<your-test-sheet-id>
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
 * - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<service-account-private-key>
 *
 * Test Independence: Uses distinct company IDs (920001-920002) from LIVE-1,
 * ensuring no cross-test pollution. No cleanup needed.
 */

// Load .env for local development convenience
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { processSheetsFeedback } from "@/sheets/processSheetsFeedback";
import { applyValidatedFeedbackPlanToDb } from "@/sheets/feedbackPersistence";
import { syncCompaniesToSheet } from "@/sheets/syncCompaniesToSheet";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import type { CatalogRuntime } from "@/types/catalog";
import { COMPANY_SHEET_NAME } from "@/constants";

// Skip test if not explicitly enabled
const isLiveTestEnabled = process.env.LIVE_SHEETS_TEST === "1";
const describeIf = isLiveTestEnabled ? describe : describe.skip;

describeIf("LIVE: Google Sheets Feedback Loop Application", () => {
  let dbHarness: TestDbHarness;

  // Test company IDs - distinct range from LIVE-1 to avoid cross-test pollution
  // Range: 920001-920002 (LIVE-3 exclusive)
  const COMPANY_ID_ACTIVE_TO_RESOLVED = 920001; // Company A (feedback test)
  const COMPANY_ID_RESOLVED_TO_ACTIVE = 920002; // Company B (feedback test)

  beforeEach(() => {
    // Create fresh test DB with migrations
    dbHarness = createTestDbSync();
  });

  afterEach(() => {
    // Cleanup: close DB and delete temp file
    dbHarness.cleanup();
  });

  it(
    "should apply feedback transitions and verify DB side effects",
    { timeout: 30000 }, // Increase timeout for live API calls
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
      // ARRANGE: Create GoogleSheetsClient
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
        ]),
        keywords: [],
        phrases: [],
      };

      // ========================================================================
      // ARRANGE: Seed DB with 2 companies in initial states
      // ========================================================================

      // Company A: Active -> Resolved (will delete offers)
      const companyAId = dbHarness.db
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
          COMPANY_ID_ACTIVE_TO_RESOLVED,
          "Beta Solutions [LIVE TEST]",
          "Beta Solutions",
          "beta solutions live test",
          "https://beta-test.example",
          "beta-test.example",
          "2026-02-07T10:00:00Z",
          "2026-02-07T10:00:00Z",
          "IN_PROGRESS", // Active state
          7.2,
          8,
          4,
          2,
          7.0,
          "cat_frontend",
          "2026-02-07T08:00:00Z",
        ).lastInsertRowid as number;

      // Company B: Resolved -> Active (will NOT delete offers)
      const companyBId = dbHarness.db
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
          COMPANY_ID_RESOLVED_TO_ACTIVE,
          "Delta Systems [LIVE TEST]",
          "Delta Systems",
          "delta systems live test",
          "https://delta-test.example",
          "delta-test.example",
          "2026-02-07T10:00:00Z",
          "2026-02-07T10:00:00Z",
          "ACCEPTED", // Resolved state
          6.5,
          5,
          3,
          1,
          6.5,
          "cat_backend",
          "2026-02-07T07:00:00Z",
        ).lastInsertRowid as number;

      expect(companyAId).toBe(COMPANY_ID_ACTIVE_TO_RESOLVED);
      expect(companyBId).toBe(COMPANY_ID_RESOLVED_TO_ACTIVE);

      // Snapshot metrics before apply
      type CompanyMetrics = {
        max_score: number;
        offer_count: number;
        unique_offer_count: number;
        strong_offer_count: number;
        avg_strong_score: number;
        top_category_id: string;
        last_strong_at: string;
      };

      const getCompanyMetrics = (companyId: number): CompanyMetrics => {
        return dbHarness.db
          .prepare(
            `SELECT max_score, offer_count, unique_offer_count, strong_offer_count,
                    avg_strong_score, top_category_id, last_strong_at
             FROM companies WHERE id = ?`,
          )
          .get(companyId) as CompanyMetrics;
      };

      const companyAMetricsBefore = getCompanyMetrics(
        COMPANY_ID_ACTIVE_TO_RESOLVED,
      );
      const companyBMetricsBefore = getCompanyMetrics(
        COMPANY_ID_RESOLVED_TO_ACTIVE,
      );

      // Seed 2 offers for Company A
      dbHarness.db
        .prepare(
          `
        INSERT INTO offers (
          id, company_id, provider, provider_offer_id, provider_url,
          title, published_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          90000201,
          COMPANY_ID_ACTIVE_TO_RESOLVED,
          "infojobs",
          "ij_a1",
          "https://example.com/a1",
          "Test Offer A1",
          "2026-02-07T09:00:00Z",
          "2026-02-07T09:00:00Z",
        );

      dbHarness.db
        .prepare(
          `
        INSERT INTO offers (
          id, company_id, provider, provider_offer_id, provider_url,
          title, published_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          90000202,
          COMPANY_ID_ACTIVE_TO_RESOLVED,
          "infojobs",
          "ij_a2",
          "https://example.com/a2",
          "Test Offer A2",
          "2026-02-07T09:00:00Z",
          "2026-02-07T09:00:00Z",
        );

      // Seed 2 offers for Company B
      dbHarness.db
        .prepare(
          `
        INSERT INTO offers (
          id, company_id, provider, provider_offer_id, provider_url,
          title, published_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          90000401,
          COMPANY_ID_RESOLVED_TO_ACTIVE,
          "infojobs",
          "ij_b1",
          "https://example.com/b1",
          "Test Offer B1",
          "2026-02-07T09:00:00Z",
          "2026-02-07T09:00:00Z",
        );

      dbHarness.db
        .prepare(
          `
        INSERT INTO offers (
          id, company_id, provider, provider_offer_id, provider_url,
          title, published_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          90000402,
          COMPANY_ID_RESOLVED_TO_ACTIVE,
          "infojobs",
          "ij_b2",
          "https://example.com/b2",
          "Test Offer B2",
          "2026-02-07T09:00:00Z",
          "2026-02-07T09:00:00Z",
        );

      // Verify offers seeded
      const offersA = dbHarness.db
        .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
        .get(COMPANY_ID_ACTIVE_TO_RESOLVED) as { count: number };
      expect(offersA.count).toBe(2);

      const offersB = dbHarness.db
        .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
        .get(COMPANY_ID_RESOLVED_TO_ACTIVE) as { count: number };
      expect(offersB.count).toBe(2);

      // ========================================================================
      // ARRANGE: Sync test companies to Google Sheets (self-contained)
      // ========================================================================

      const syncResult = await syncCompaniesToSheet(client, catalog);
      expect(syncResult.ok).toBe(true);

      // Verify our 2 test companies exist in sheet
      const verifyResult = await client.readRange(`${COMPANY_SHEET_NAME}!A:J`);
      if (!verifyResult.ok) {
        throw new Error(
          `Failed to verify sheet after sync: ${verifyResult.error?.message}`,
        );
      }

      const sheetValues = verifyResult.data.values || [];
      const dataRows = sheetValues.slice(1); // Skip header

      const testCompanyIds = [
        COMPANY_ID_ACTIVE_TO_RESOLVED,
        COMPANY_ID_RESOLVED_TO_ACTIVE,
      ];

      const existingTestCompanies = dataRows.filter((row) => {
        const companyId = parseInt(row[0] as string, 10);
        return testCompanyIds.includes(companyId);
      });

      expect(existingTestCompanies.length).toBe(2);

      // ========================================================================
      // ARRANGE: Update Google Sheets column C for the 2 test companies
      // ========================================================================

      // Find row numbers for our test companies
      const companyARow = dataRows.findIndex(
        (row) =>
          parseInt(row[0] as string, 10) === COMPANY_ID_ACTIVE_TO_RESOLVED,
      );
      const companyBRow = dataRows.findIndex(
        (row) =>
          parseInt(row[0] as string, 10) === COMPANY_ID_RESOLVED_TO_ACTIVE,
      );

      expect(companyARow).toBeGreaterThanOrEqual(0);
      expect(companyBRow).toBeGreaterThanOrEqual(0);

      // Row indices in Google Sheets are 1-based, +1 for header, +1 for 0-based offset
      const companyASheetRow = companyARow + 2;
      const companyBSheetRow = companyBRow + 2;

      // Update Company A: IN_PROGRESS -> ACCEPTED (resolved)
      const updateAResult = await client.batchUpdate(
        [["ACCEPTED"]],
        `${COMPANY_SHEET_NAME}!C${companyASheetRow}`,
      );
      expect(updateAResult.ok).toBe(true);

      // Update Company B: ACCEPTED -> PENDING (active)
      const updateBResult = await client.batchUpdate(
        [["PENDING"]],
        `${COMPANY_SHEET_NAME}!C${companyBSheetRow}`,
      );
      expect(updateBResult.ok).toBe(true);

      // ========================================================================
      // ACT: Process feedback and apply to DB
      // ========================================================================

      // Use a time within feedback window (04:00 Europe/Madrid)
      const now = new Date("2026-02-07T03:00:00Z"); // 04:00 Madrid time (UTC+1)

      // Process feedback (read sheet + build plan)
      const processResult = await processSheetsFeedback(client, now);

      expect(processResult.ok).toBe(true);
      expect(processResult.skipped).toBe(false);
      expect(processResult.validatedPlan).toBeDefined();

      const plan = processResult.validatedPlan!;

      // Apply validated plan to DB
      const applyResult = applyValidatedFeedbackPlanToDb(plan);

      // ========================================================================
      // ASSERT: Verify plan structure
      // ========================================================================

      // Should have 1 destructive change (A: active->resolved)
      expect(plan.destructiveChanges.length).toBe(1);
      expect(plan.destructiveChanges[0].companyId).toBe(
        COMPANY_ID_ACTIVE_TO_RESOLVED,
      );
      expect(plan.destructiveChanges[0].toResolution).toBe("ACCEPTED");

      // Should have 1 reversal change (B: resolved->active)
      expect(plan.reversalChanges.length).toBe(1);
      expect(plan.reversalChanges[0].companyId).toBe(
        COMPANY_ID_RESOLVED_TO_ACTIVE,
      );
      expect(plan.reversalChanges[0].toResolution).toBe("PENDING");

      // ========================================================================
      // ASSERT: Verify apply result counters
      // ========================================================================

      expect(applyResult.attempted).toBe(2);
      expect(applyResult.updated).toBe(2);
      expect(applyResult.failed).toBe(0);

      // Offer deletion: only for Company A (destructive change)
      expect(applyResult.offerDeletionAttempted).toBe(1);
      expect(applyResult.offersDeleted).toBe(2); // 2 offers deleted for Company A
      expect(applyResult.offerDeletionsFailed).toBe(0);

      // ========================================================================
      // ASSERT: Verify DB state for Company A (active -> resolved)
      // ========================================================================

      const companyAAfter = dbHarness.db
        .prepare("SELECT resolution FROM companies WHERE id = ?")
        .get(COMPANY_ID_ACTIVE_TO_RESOLVED) as { resolution: string };
      expect(companyAAfter.resolution).toBe("ACCEPTED");

      // Offers should be deleted
      const offersAAfter = dbHarness.db
        .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
        .get(COMPANY_ID_ACTIVE_TO_RESOLVED) as { count: number };
      expect(offersAAfter.count).toBe(0);

      // Metrics should be preserved
      const companyAMetricsAfter = getCompanyMetrics(
        COMPANY_ID_ACTIVE_TO_RESOLVED,
      );
      expect(companyAMetricsAfter.max_score).toBe(
        companyAMetricsBefore.max_score,
      );
      expect(companyAMetricsAfter.offer_count).toBe(
        companyAMetricsBefore.offer_count,
      );
      expect(companyAMetricsAfter.unique_offer_count).toBe(
        companyAMetricsBefore.unique_offer_count,
      );
      expect(companyAMetricsAfter.strong_offer_count).toBe(
        companyAMetricsBefore.strong_offer_count,
      );
      expect(companyAMetricsAfter.avg_strong_score).toBe(
        companyAMetricsBefore.avg_strong_score,
      );
      expect(companyAMetricsAfter.top_category_id).toBe(
        companyAMetricsBefore.top_category_id,
      );
      expect(companyAMetricsAfter.last_strong_at).toBe(
        companyAMetricsBefore.last_strong_at,
      );

      // ========================================================================
      // ASSERT: Verify DB state for Company B (resolved -> active)
      // ========================================================================

      const companyBAfter = dbHarness.db
        .prepare("SELECT resolution FROM companies WHERE id = ?")
        .get(COMPANY_ID_RESOLVED_TO_ACTIVE) as { resolution: string };
      expect(companyBAfter.resolution).toBe("PENDING");

      // Offers should NOT be deleted
      const offersBAfter = dbHarness.db
        .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
        .get(COMPANY_ID_RESOLVED_TO_ACTIVE) as { count: number };
      expect(offersBAfter.count).toBe(2);

      // Metrics should be preserved
      const companyBMetricsAfter = getCompanyMetrics(
        COMPANY_ID_RESOLVED_TO_ACTIVE,
      );
      expect(companyBMetricsAfter.max_score).toBe(
        companyBMetricsBefore.max_score,
      );
      expect(companyBMetricsAfter.offer_count).toBe(
        companyBMetricsBefore.offer_count,
      );
      expect(companyBMetricsAfter.unique_offer_count).toBe(
        companyBMetricsBefore.unique_offer_count,
      );
      expect(companyBMetricsAfter.strong_offer_count).toBe(
        companyBMetricsBefore.strong_offer_count,
      );
      expect(companyBMetricsAfter.avg_strong_score).toBe(
        companyBMetricsBefore.avg_strong_score,
      );
      expect(companyBMetricsAfter.top_category_id).toBe(
        companyBMetricsBefore.top_category_id,
      );
      expect(companyBMetricsAfter.last_strong_at).toBe(
        companyBMetricsBefore.last_strong_at,
      );

      // ========================================================================
      // SUCCESS: Test passed
      // ========================================================================
      console.log("✅ LIVE: Feedback loop application verified");
      console.log(`   - Spreadsheet ID: ${spreadsheetId}`);
      console.log(
        `   - Company A (${COMPANY_ID_ACTIVE_TO_RESOLVED}): IN_PROGRESS -> ACCEPTED`,
      );
      console.log(
        `   - Offers deleted for Company A: ${applyResult.offersDeleted}`,
      );
      console.log(
        `   - Company B (${COMPANY_ID_RESOLVED_TO_ACTIVE}): ACCEPTED -> PENDING`,
      );
      console.log(`   - Offers preserved for Company B: ${offersBAfter.count}`);
      console.log("   - Metrics preserved for both companies: ✓");
    },
  );
});

// Print skip message when not enabled
if (!isLiveTestEnabled) {
  console.log(
    "⏭️  LIVE Google Sheets feedback application test skipped (set LIVE_SHEETS_TEST=1 to enable)",
  );
}
