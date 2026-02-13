/**
 * Integration Test — M5 Export: Update Existing Company Metrics
 *
 * P0 invariant: When exporting companies that already exist in the sheet, the system MUST:
 * 1. Match companies by company_id (column A)
 * 2. Update ONLY metric columns (D-J), NOT manual columns (A-C)
 * 3. Preserve manual edits to company_name (column B) and resolution (column C)
 * 4. Return correct counters: updated=1, appended=0, skipped=0
 *
 * This test validates that the M5 export update path respects the column contract:
 * - Columns A-C (ID Empresa, Empresa, Resolución) are never overwritten
 * - Columns D-J (metrics) are updated from DB
 * - Manual human edits in columns B-C are preserved
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { syncCompaniesToSheet } from "@/sheets/syncCompaniesToSheet";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import { COMPANY_SHEET_HEADERS } from "@/constants";
import type { CatalogRuntime } from "@/types/catalog";

describe("Integration: M5 Export Update Existing Row", () => {
  let dbHarness: TestDbHarness;
  const mockFetch = vi.fn();

  // Track metric update calls
  let metricUpdateCalls: Array<{
    range: string;
    values: unknown[][];
  }> = [];

  // Valid PKCS8 private key for testing
  const mockPrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5RZfpcS1qefAR
8s85nGIO6uGpU56NlIvDhm3Bdx/Eryd4ftjrz3T0Y42LfxW2RjfBDSQtUHrQIXzQ
A9hehuVp1BTIc6sFzmwEq26PafdTVpNHdcO2CSQ0kNvHuCTfOGDEzb48qCc+C/vl
lfyBnmiDTmxA0RshPVqQo4shXnrXPHr3xKFD3QOgkaitWIVGpq9BzHC3l9RIn+41
d6APHyjnrW050KVGxLqdsTyOMdvDb+DzY7k9MluJesMOFqJRxp4F2bjRzRgENVDw
5ae1vULmVdIVJ3d2s8kt9q8FjF5GarkxyYC1nyhYCcmVypP3XuSMTUxht8e/Cxx6
PJfqKjpnAgMBAAECggEAALaQH+mlnJV7vyrPI6Zpqo+kXjOdrLVQ4qrTzEglXPwD
cALc+8JW123NzOQX5yCqaZQUgFnj6N45hYwmluJiCqLZkJYL08hqfl9TQFDZwTXY
L/qp5DBa5+4cB62OCY+pYnnvkOnxpyj3QfKKSHO0E84Bu8uzpbo8uusDdEI1zDpJ
xZWCgO3oQFNDtDGeebNvdptSUdGuvrchTCthC5qvLwLIIL6qSgzm7dxF8whaFXnq
IBxXvqcqsPQHhGIf6/HG/vbzZgwH+/WxthlZegGav0pDAOVhTCq68egTlMBKsj0v
DhGFg3oiAnDwcKJX54lPnoV7/qnahbllLiMGPh2VoQKBgQDv5FZ2WI/CcPQpsY+H
+6kSADyG/cNDImv6SO12GutHhIlsvmn4TuS/ZK7667zgAJoXJZ/1XWZz951whSzJ
XxUDYUZpGCCzJF4DeSQOVsGueIb8XbATJosozBAH8Lc7GKmOBgGDcUw//kt1pqJU
Ie12diauA63lqcSpGXKgIBZarwKBgQDFtlrAwWjTFaIOI0za3IJ6RKYBRu67ofYq
/nkMAvMDwmSANmHrg5gJtyBz7tYn4bj7uZxgvBpQdcb1z7Jic9ZrNUOFmfRISsST
TaVDA8l8Zptaw1feSWyBjmYoZ0tq6cA1X0LPVie/Q2zdlrwLGMa84h0BZ7kVE4Fz
lpZmhxkpyQKBgHCzQF+HCbraoAq6bWkANRTM4aK1szdmA35pJo425VQLExjweA58
2gCEx6QAfhJqlfnL5lM6lvhiWyfSmRDdx5x35cFX4Xzn1/cfwW2vGnziCOClDyRg
Fj6LZ/ijASIVWwrrDWj4IE9sI31ZVKfb7Jibt15HQjpEQK0E1JIfoQDnAoGBAK3C
Rt4S3Mpuv77HHVtX4sAMJw0GRvfWLp+4h6+bw/Gw3Vyk7sfqHiujqrzY0ZO5WDa6
+Ik3p7TA3bvY7oCCJ5aO+CmplTwXoc2Hts8/u8s97hkFhurQArGV8Yhex7RNfOQr
NW8826/HVR0lxVvHSZpk6nL6snmoa+OnG8U9xEqpAoGBAMfcSaKlA7vGjetoPHQc
KVWyE8sEmoEoSUj3+mMixDvuNlw/FdhqBxanv5dU6mrLeLDZl7t8YiDsL4fb8seT
7oHZHx0OUzB1bj/m8lmvQmKjraJUuofQHYn9UPUzps8zXVP/KAxNNd4QOy074+yq
X6LloxV8OuZpUXhq0/ihp0JY
-----END PRIVATE KEY-----`;

  beforeEach(() => {
    // Create fresh test DB with migrations
    dbHarness = createTestDbSync();

    // Reset tracking
    metricUpdateCalls = [];

    // Stub global fetch for GoogleSheetsClient
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    // Cleanup: close DB and delete temp file
    dbHarness.cleanup();

    // Restore global fetch
    vi.unstubAllGlobals();
  });

  it("should update ONLY metric columns (D-J) and preserve manual columns (A-C)", async () => {
    // ========================================================================
    // ARRANGE: Seed DB with 1 company with updated metrics
    // ========================================================================

    const companyId = dbHarness.db
      .prepare(
        `
      INSERT INTO companies (
        name_raw, name_display, normalized_name, website_url, website_domain,
        created_at, updated_at, resolution,
        max_score, offer_count, unique_offer_count, strong_offer_count,
        avg_strong_score, top_category_id, last_strong_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "Acme Corporation",
        "ACME Corp",
        "acme corporation",
        "https://acme.example",
        "acme.example",
        "2026-02-06T08:00:00Z",
        "2026-02-06T10:00:00Z",
        "PENDING",
        9.2, // max_score (NEW)
        15, // offer_count (NEW)
        8, // unique_offer_count (NEW)
        5, // strong_offer_count (NEW)
        8.7, // avg_strong_score (NEW)
        "cat_frontend", // top_category_id (NEW)
        "2026-02-06T09:30:00Z", // last_strong_at (NEW)
      ).lastInsertRowid as number;

    // Verify company in DB
    const companiesInDb = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };
    expect(companiesInDb.count).toBe(1);

    // ========================================================================
    // ARRANGE: Mock Google Sheets HTTP responses
    // ========================================================================

    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlString = url.toString();
      const method = options?.method || "GET";

      // OAuth2 token endpoint
      if (urlString.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "mock-access-token-update",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        };
      }

      // Spreadsheet metadata endpoint (for getSheetIdByTitle)
      if (urlString.includes("includeGridData=false") && method === "GET") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            spreadsheetId: "test-spreadsheet-update",
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: "Companies",
                  index: 0,
                },
              },
            ],
          }),
        };
      }

      // Header range read (enforcer check) - now 12 columns (A-L)
      if (
        (urlString.includes("Companies!A1:L1") ||
          urlString.includes("Companies!A1%3AL1")) &&
        method === "GET"
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            range: "Companies!A1:L1",
            majorDimension: "ROWS",
            values: [COMPANY_SHEET_HEADERS], // Header already exists (no write needed)
          }),
        };
      }

      // Spreadsheet batchUpdate endpoint (data validation)
      if (urlString.includes(":batchUpdate") && method === "POST") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            spreadsheetId: "test-spreadsheet-update",
            replies: [{}],
          }),
        };
      }

      // Full sheet read (for building index of existing companies)
      if (
        (urlString.includes("Companies!A:Z") ||
          urlString.includes("Companies%21A%3AZ") ||
          urlString.includes("Companies!A%3AZ")) &&
        method === "GET" &&
        !urlString.includes(":append")
      ) {
        // Return header + 1 data row with OUTDATED metrics
        return {
          ok: true,
          status: 200,
          json: async () => ({
            range: "Companies!A2:J2",
            majorDimension: "ROWS",
            values: [
              COMPANY_SHEET_HEADERS,
              [
                companyId, // Column A: ID Empresa (matches DB)
                "ACME Corp - Manual Edit", // Column B: Empresa (MANUAL EDIT - must be preserved)
                "IN_PROGRESS", // Column C: Resolución (MANUAL EDIT - must be preserved)
                "6.5", // Column D: Score máx. (OLD - should be updated to 9.2)
                2, // Column E: Ofertas fuertes (OLD - should be updated to 5)
                3, // Column F: Ofertas únicas (OLD - should be updated to 8)
                8, // Column G: Actividad publicación (OLD - should be updated to 15)
                "6.0", // Column H: Score medio fuerte (OLD - should be updated to 8.7)
                "Backend", // Column I: Categoría principal (OLD - should be updated to Frontend)
                "2026-02-05", // Column J: Última oferta fuerte (OLD - should be updated to 2026-02-06)
              ],
            ],
          }),
        };
      }

      // NEGATIVE GUARD: Fail fast if attempting to update manual columns (A-C)
      if (
        urlString.includes("/values/Companies!A2") ||
        urlString.includes("/values/Companies!B2") ||
        urlString.includes("/values/Companies!C2") ||
        urlString.includes("/values/Companies%21A2") ||
        urlString.includes("/values/Companies%21B2") ||
        urlString.includes("/values/Companies%21C2")
      ) {
        throw new Error(
          `TEST FAILURE: Exporter attempted to update manual columns (A-C). URL: ${urlString}`,
        );
      }

      // Metric update endpoint (PUT for single range D2:J2)
      // URL patterns to match: /values/Companies!D2:J2 or /values/Companies!D2%3AJ2 or /values/Companies%21D2%3AJ2
      if (
        (urlString.includes("/values/Companies!D2:J2") ||
          urlString.includes("/values/Companies!D2%3AJ2") ||
          urlString.includes("/values/Companies%21D2%3AJ2")) &&
        method === "PUT"
      ) {
        // STRICT VALIDATION: Assert correct HTTP method
        if (method !== "PUT") {
          throw new Error(
            `TEST FAILURE: Expected PUT for metric update, got ${method}`,
          );
        }

        // STRICT VALIDATION: Assert URL contains exact encoded range with RAW valueInputOption
        const expectedRangePattern =
          /values\/Companies[!%21]D2[:%]3AJ2\?valueInputOption=RAW/;
        if (!expectedRangePattern.test(urlString)) {
          throw new Error(
            `TEST FAILURE: URL does not match expected metric range pattern. URL: ${urlString}`,
          );
        }

        const body = JSON.parse(options?.body as string);

        // STRICT VALIDATION: Assert body structure
        if (!body.values || !Array.isArray(body.values)) {
          throw new Error(
            `TEST FAILURE: Body missing 'values' array. Body: ${JSON.stringify(body)}`,
          );
        }

        if (body.values.length !== 1 || !Array.isArray(body.values[0])) {
          throw new Error(
            `TEST FAILURE: Expected values to be [[...]] (single row). Got: ${JSON.stringify(body.values)}`,
          );
        }

        const metricRow = body.values[0];

        // STRICT VALIDATION: Assert exactly 7 metric columns (D-J)
        if (metricRow.length !== 7) {
          throw new Error(
            `TEST FAILURE: Expected 7 metric columns (D-J), got ${metricRow.length}. Values: ${JSON.stringify(metricRow)}`,
          );
        }

        // STRICT VALIDATION: Assert metric values match expected DB state
        // Expected from seeded company:
        // - max_score: "9.2" (formatted)
        // - strong_offer_count: 5
        // - unique_offer_count: 8
        // - posting_activity (offer_count): 15
        // - avg_strong_score: "8.7" (formatted)
        // - top_category: "Frontend" (resolved from cat_frontend)
        // - last_strong_at: "2026-02-06" (date only)
        const expectedMetrics = [
          "9.2",
          5,
          8,
          15,
          "8.7",
          "Frontend",
          "2026-02-06",
        ];

        for (let i = 0; i < expectedMetrics.length; i++) {
          if (metricRow[i] !== expectedMetrics[i]) {
            throw new Error(
              `TEST FAILURE: Metric mismatch at index ${i}. Expected: ${JSON.stringify(expectedMetrics[i])}, Got: ${JSON.stringify(metricRow[i])}. Full row: ${JSON.stringify(metricRow)}`,
            );
          }
        }

        // Extract range from URL
        const rangeMatch = urlString.match(/values\/([^?]+)\?/);
        const encodedRange = rangeMatch ? rangeMatch[1] : "Companies!D2:J2";
        const range = decodeURIComponent(encodedRange);

        // All validations passed - track call and respond
        metricUpdateCalls.push({
          range,
          values: body.values,
        });

        return {
          ok: true,
          status: 200,
          json: async () => ({
            updatedRange: range,
            updatedRows: 1,
            updatedColumns: 7,
            updatedCells: 7,
          }),
        };
      }

      throw new Error(`Unmocked fetch URL: ${method} ${urlString}`);
    });

    // ========================================================================
    // ACT: Execute export
    // ========================================================================

    // Create GoogleSheetsClient with mock fetch
    const client = new GoogleSheetsClient({
      spreadsheetId: "test-spreadsheet-update",
      credentials: {
        clientEmail: "test@example.com",
        privateKey: mockPrivateKey,
      },
    });

    // Minimal catalog with both categories
    const catalog: CatalogRuntime = {
      version: "1.0.0",
      categories: new Map([
        ["cat_backend", { id: "cat_backend", name: "Backend", tier: 3 }],
        ["cat_frontend", { id: "cat_frontend", name: "Frontend", tier: 3 }],
      ]),
      keywords: [],
      phrases: [],
    };

    // Execute sync
    const result = await syncCompaniesToSheet(client, catalog);

    // ========================================================================
    // ASSERT: Verify update behavior
    // ========================================================================

    // 1. Export succeeded
    expect(result.ok).toBe(true);
    expect(result.totalCompanies).toBe(1);
    expect(result.appendedCount).toBe(0); // No appends, only updates
    expect(result.updatedCount).toBe(1); // 1 company updated
    expect(result.skippedCount).toBe(0);

    // 2. Exactly ONE metric update call was made
    expect(metricUpdateCalls.length).toBe(1);

    // 3. Update targeted ONLY metric columns (D2:J2), not A-C
    const updateCall = metricUpdateCalls[0];
    expect(updateCall.range).toBe("Companies!D2:J2");

    // 4. Metric values match DB (not old sheet values)
    const updatedMetrics = updateCall.values[0] as (string | number)[];
    expect(updatedMetrics.length).toBe(7); // 7 metric columns

    expect(updatedMetrics[0]).toBe("9.2"); // max_score (D) - NEW from DB
    expect(updatedMetrics[1]).toBe(5); // strong_offers (E) - NEW from DB
    expect(updatedMetrics[2]).toBe(8); // unique_offers (F) - NEW from DB
    expect(updatedMetrics[3]).toBe(15); // posting_activity (G) - NEW from DB
    expect(updatedMetrics[4]).toBe("8.7"); // avg_strong_score (H) - NEW from DB
    expect(updatedMetrics[5]).toBe("Frontend"); // top_category (I) - NEW from DB
    expect(updatedMetrics[6]).toBe("2026-02-06"); // last_strong_at (J) - NEW from DB

    // 5. DB unchanged (verify company still exists with same data)
    const companiesAfter = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };
    expect(companiesAfter.count).toBe(1);

    // 6. Verify manual columns (A-C) were NOT updated (no PUT/POST to A2:C2)
    // This is implicit: only D2:J2 was updated, so columns A-C preserved
    expect(updateCall.range).not.toContain("A2");
    expect(updateCall.range).not.toContain("B2");
    expect(updateCall.range).not.toContain("C2");
  });
});
