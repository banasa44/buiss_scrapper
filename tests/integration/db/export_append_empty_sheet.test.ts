/**
 * Integration Test — M5 Export: Append New Companies to Empty Sheet
 *
 * P0 invariant: When exporting companies to an empty sheet, the system MUST:
 * 1. Write Spanish header row via enforcer (if missing)
 * 2. Append N company rows in correct 10-column order
 * 3. Leave DB unchanged (export is read-only on DB side)
 *
 * This test validates the complete M5 export path end-to-end:
 * - Mock Google Sheets with empty initial state
 * - Seed DB with 2 companies
 * - Execute syncCompaniesToSheet (includes header enforcement)
 * - Assert header written + companies appended in correct order
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { syncCompaniesToSheet } from "@/sheets/syncCompaniesToSheet";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import { COMPANY_SHEET_HEADERS } from "@/constants";
import type { CatalogRuntime } from "@/types/catalog";

describe("Integration: M5 Export Append to Empty Sheet", () => {
  let dbHarness: TestDbHarness;
  const mockFetch = vi.fn();

  // Track what was written to sheets
  let headerWritten: string[] | null = null;
  let rowsAppended: unknown[][] = [];

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
    headerWritten = null;
    rowsAppended = [];

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

  it("should write Spanish header and append 2 companies in correct order", async () => {
    // ========================================================================
    // ARRANGE: Seed DB with 2 companies
    // ========================================================================

    // Company 1: With full metrics
    const company1Id = dbHarness.db
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
        "Alpha Technologies Inc",
        "Alpha Tech",
        "alpha technologies inc",
        "https://alphatech.example",
        "alphatech.example",
        "2026-02-06T08:00:00Z",
        "2026-02-06T09:00:00Z",
        "PENDING",
        8.5, // max_score
        10, // offer_count
        5, // unique_offer_count
        3, // strong_offer_count
        7.9, // avg_strong_score
        "cat_backend", // top_category_id
        "2026-02-06T08:00:00Z", // last_strong_at
      ).lastInsertRowid as number;

    // Company 2: With minimal metrics (mostly null)
    const company2Id = dbHarness.db
      .prepare(
        `
      INSERT INTO companies (
        name_raw, name_display, normalized_name, website_url, website_domain,
        created_at, updated_at, resolution
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "Beta Solutions Ltd",
        "Beta Solutions",
        "beta solutions ltd",
        "https://beta.example",
        "beta.example",
        "2026-02-06T09:00:00Z",
        "2026-02-06T09:00:00Z",
        "PENDING",
      ).lastInsertRowid as number;

    // Verify companies in DB
    const companiesInDb = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };
    expect(companiesInDb.count).toBe(2);

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
            access_token: "mock-access-token-export",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        };
      }

      // Header range read (enforcer check)
      if (
        (urlString.includes("Companies!A1:J1") ||
          urlString.includes("Companies!A1%3AJ1")) &&
        method === "GET"
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            range: "Companies!A1:J1",
            majorDimension: "ROWS",
            values: [], // Empty - no header exists yet
          }),
        };
      }

      // Header write (enforcer writes Spanish headers)
      if (
        (urlString.includes("Companies!A1:J1") ||
          urlString.includes("Companies!A1%3AJ1")) &&
        method === "PUT"
      ) {
        const body = JSON.parse(options?.body as string);
        headerWritten = body.values[0]; // Track what header was written
        return {
          ok: true,
          status: 200,
          json: async () => ({
            updatedRange: "Companies!A1:J1",
            updatedRows: 1,
            updatedColumns: 10,
            updatedCells: 10,
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
        // Return just the header (no data rows yet - empty sheet)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            range: "Companies!A:Z",
            majorDimension: "ROWS",
            values: [COMPANY_SHEET_HEADERS], // Header only, no data
          }),
        };
      }

      // Append rows endpoint
      if (
        (urlString.includes("/values/Companies!A:Z:append") ||
          urlString.includes("/values/Companies%21A%3AZ:append") ||
          urlString.includes("/values/Companies!A%3AZ:append")) &&
        method === "POST"
      ) {
        const body = JSON.parse(options?.body as string);
        rowsAppended.push(...body.values); // Track appended rows
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tableRange: "Companies!A2:J3",
            updates: {
              updatedRange: "Companies!A2:J3",
              updatedRows: body.values.length,
              updatedColumns: 10,
              updatedCells: body.values.length * 10,
            },
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
      spreadsheetId: "test-spreadsheet-export",
      credentials: {
        clientEmail: "test@example.com",
        privateKey: mockPrivateKey,
      },
    });

    // Minimal catalog (no categories needed for this test)
    const catalog: CatalogRuntime = {
      version: "1.0.0",
      categories: new Map([
        ["cat_backend", { id: "cat_backend", name: "Backend", tier: 3 }],
      ]),
      keywords: [],
      phrases: [],
    };

    // Execute sync
    const result = await syncCompaniesToSheet(client, catalog);

    // ========================================================================
    // ASSERT: Verify export behavior
    // ========================================================================

    // 1. Export succeeded
    expect(result.ok).toBe(true);
    expect(result.totalCompanies).toBe(2);
    expect(result.appendedCount).toBe(2);
    expect(result.updatedCount).toBe(0); // No updates, only appends
    expect(result.skippedCount).toBe(0);

    // 2. Spanish header was written
    expect(headerWritten).not.toBeNull();
    expect(headerWritten).toEqual(COMPANY_SHEET_HEADERS);

    // 3. Exactly 2 rows appended
    expect(rowsAppended.length).toBe(2);

    // 4. First row has correct 10-column order for Company 1
    const row1 = rowsAppended[0] as (string | number)[];
    expect(row1.length).toBe(10);
    expect(row1[0]).toBe(company1Id); // company_id
    expect(row1[1]).toBe("Alpha Tech"); // company_name
    expect(row1[2]).toBe("PENDING"); // resolution
    expect(row1[3]).toBe("8.5"); // max_score (formatted)
    expect(row1[4]).toBe(3); // strong_offers
    expect(row1[5]).toBe(5); // unique_offers
    expect(row1[6]).toBe(10); // posting_activity
    expect(row1[7]).toBe("7.9"); // avg_strong_score (formatted)
    expect(row1[8]).toBe("Backend"); // top_category (resolved label)
    expect(row1[9]).toBe("2026-02-06"); // last_strong_at (date only)

    // 5. Second row has correct 10-column order for Company 2 (nulls → empty)
    const row2 = rowsAppended[1] as (string | number)[];
    expect(row2.length).toBe(10);
    expect(row2[0]).toBe(company2Id); // company_id
    expect(row2[1]).toBe("Beta Solutions"); // company_name
    expect(row2[2]).toBe("PENDING"); // resolution
    expect(row2[3]).toBe(""); // max_score (null → empty)
    expect(row2[4]).toBe(""); // strong_offers (null → empty)
    expect(row2[5]).toBe(""); // unique_offers (null → empty)
    expect(row2[6]).toBe(""); // posting_activity (null → empty)
    expect(row2[7]).toBe(""); // avg_strong_score (null → empty)
    expect(row2[8]).toBe(""); // top_category (null → empty)
    expect(row2[9]).toBe(""); // last_strong_at (null → empty)

    // 6. DB unchanged (verify companies still exist with same data)
    const companiesAfter = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM companies")
      .get() as { count: number };
    expect(companiesAfter.count).toBe(2);
  });
});
