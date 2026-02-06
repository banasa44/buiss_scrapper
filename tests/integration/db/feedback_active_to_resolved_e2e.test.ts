/**
 * Integration Test — M6 Feedback: Active → Resolved (Complete E2E with Spanish Headers)
 *
 * P0 invariant: When sheet feedback transitions a company to RESOLVED state,
 * the system MUST:
 * 1. Update companies.resolution to the target resolved value
 * 2. Delete ALL offers for that company (cascade)
 * 3. Preserve all other company fields (identity, metrics) unchanged
 *
 * This test validates the complete M6 persistence contract end-to-end:
 * - Mock Google Sheets with Spanish headers (enforcer validation)
 * - Process feedback through real pipeline (processSheetsFeedback)
 * - Apply persistence through real applyValidatedFeedbackPlanToDb
 * - Assert DB state matches contract guarantees
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { processSheetsFeedback } from "@/sheets/processSheetsFeedback";
import { applyValidatedFeedbackPlanToDb } from "@/sheets/feedbackPersistence";
import { createTestDbSync, type TestDbHarness } from "../../helpers/testDb";
import * as offersRepo from "@/db/repos/offersRepo";
import * as companiesRepo from "@/db/repos/companiesRepo";
import { COMPANY_SHEET_HEADERS } from "@/constants";

describe("Integration: M6 Feedback Active → Resolved (Spanish Headers)", () => {
  let dbHarness: TestDbHarness;
  const mockFetch = vi.fn();

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

    // Enable foreign keys for cascade deletion
    dbHarness.db.pragma("foreign_keys = ON");

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

  it("should update company.resolution, delete offers, and preserve all metrics", async () => {
    // ========================================================================
    // ARRANGE: Insert test company with ACTIVE resolution + metrics + offers
    // ========================================================================

    // Insert company with IN_PROGRESS (ACTIVE) resolution
    const companyId = dbHarness.db
      .prepare(
        `
      INSERT INTO companies (
        name_raw, name_display, normalized_name, website_url, website_domain,
        created_at, updated_at, resolution,
        max_score, offer_count, unique_offer_count, strong_offer_count, avg_strong_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "TechCorp Industries",
        "TechCorp",
        "techcorp industries",
        "https://techcorp.example",
        "techcorp.example",
        "2026-02-05T08:00:00Z",
        "2026-02-05T09:00:00Z",
        "IN_PROGRESS", // ACTIVE resolution
        7.8, // max_score
        5, // offer_count
        3, // unique_offer_count
        2, // strong_offer_count
        8.1, // avg_strong_score
      ).lastInsertRowid as number;

    // Snapshot company state BEFORE feedback
    const companyBefore = companiesRepo.getCompanyById(companyId);
    expect(companyBefore).toBeDefined();
    expect(companyBefore!.resolution).toBe("IN_PROGRESS");
    expect(companyBefore!.max_score).toBe(7.8);
    expect(companyBefore!.offer_count).toBe(5);
    expect(companyBefore!.unique_offer_count).toBe(3);
    expect(companyBefore!.strong_offer_count).toBe(2);
    expect(companyBefore!.avg_strong_score).toBe(8.1);
    expect(companyBefore!.name_display).toBe("TechCorp");
    expect(companyBefore!.website_domain).toBe("techcorp.example");

    // Insert 2 offers for this company
    offersRepo.upsertOffer({
      provider: "infojobs",
      provider_offer_id: "techcorp-offer-1",
      provider_url: "https://example.com/techcorp-1",
      company_id: companyId,
      title: "Senior Backend Engineer",
      description: "Backend development role",
      min_requirements: null,
      desired_requirements: null,
      requirements_snippet: null,
      published_at: "2026-02-05T08:00:00Z",
      updated_at: "2026-02-05T08:00:00Z",
      created_at: "2026-02-05T08:00:00Z",
      applications_count: null,
      metadata_json: null,
      raw_json: null,
    });

    offersRepo.upsertOffer({
      provider: "infojobs",
      provider_offer_id: "techcorp-offer-2",
      provider_url: "https://example.com/techcorp-2",
      company_id: companyId,
      title: "DevOps Engineer",
      description: "DevOps infrastructure role",
      min_requirements: null,
      desired_requirements: null,
      requirements_snippet: null,
      published_at: "2026-02-05T08:30:00Z",
      updated_at: "2026-02-05T08:30:00Z",
      created_at: "2026-02-05T08:30:00Z",
      applications_count: null,
      metadata_json: null,
      raw_json: null,
    });

    // Verify offers exist
    const offersBefore = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(companyId) as { count: number };
    expect(offersBefore.count).toBe(2);

    // ========================================================================
    // ARRANGE: Mock Google Sheets HTTP responses with SPANISH HEADERS
    // ========================================================================

    mockFetch.mockImplementation(async (url: string) => {
      const urlString = url.toString();

      // OAuth2 token endpoint
      if (urlString.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "mock-access-token-test",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        };
      }

      // Sheets header range read (for enforcer)
      if (urlString.includes("Companies!A1:J1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            range: "Companies!A1:J1",
            majorDimension: "ROWS",
            values: [COMPANY_SHEET_HEADERS], // Spanish headers
          }),
        };
      }

      // Sheets data range read (for feedback reader)
      if (
        urlString.includes("Companies!A:Z") ||
        urlString.includes("/values/Companies")
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            range: "Companies!A:Z",
            majorDimension: "ROWS",
            values: [
              // Header row with Spanish labels (matches COMPANY_SHEET_HEADERS)
              COMPANY_SHEET_HEADERS,
              // Data row: company transitions to ACCEPTED (RESOLVED)
              [
                String(companyId), // ID Empresa
                "TechCorp", // Empresa
                "ACCEPTED", // Resolución (RESOLVED state)
                "7.8", // Score máx.
                "2", // Ofertas fuertes
                "3", // Ofertas únicas
                "5", // Actividad publicaciones
                "8.1", // Score fuerte medio
                "Backend", // Categoría top
                "2026-02-05", // Última señal fuerte
              ],
            ],
          }),
        };
      }

      throw new Error(`Unmocked fetch URL: ${urlString}`);
    });

    // ========================================================================
    // ACT: Execute feedback processing pipeline
    // ========================================================================

    // Create GoogleSheetsClient with mock fetch
    const client = new GoogleSheetsClient({
      spreadsheetId: "test-spreadsheet-spanish",
      credentials: {
        clientEmail: "test@example.com",
        privateKey: mockPrivateKey,
      },
    });

    // Time within feedback window (03:00 Europe/Madrid)
    const nowWithinWindow = new Date("2026-02-06T03:30:00Z");

    // Process feedback (includes header enforcement)
    const feedbackResult = await processSheetsFeedback(client, nowWithinWindow);

    // Verify feedback processing succeeded
    expect(feedbackResult.ok).toBe(true);
    expect(feedbackResult.skipped).toBe(false);
    expect(feedbackResult.validatedPlan).toBeDefined();

    // Extract validated plan
    const validatedPlan = feedbackResult.validatedPlan!;

    // Verify plan classification
    expect(validatedPlan.destructiveChanges.length).toBe(1);
    expect(validatedPlan.destructiveChanges[0].companyId).toBe(companyId);
    expect(validatedPlan.destructiveChanges[0].toResolution).toBe("ACCEPTED");
    expect(validatedPlan.destructiveChanges[0].classification).toBe(
      "destructive",
    );

    // Apply validated feedback plan to DB
    const applyResult = await applyValidatedFeedbackPlanToDb(validatedPlan);

    // Verify persistence succeeded
    expect(applyResult.attempted).toBe(1);
    expect(applyResult.updated).toBe(1);
    expect(applyResult.failed).toBe(0);
    expect(applyResult.offerDeletionAttempted).toBe(1);
    expect(applyResult.offersDeleted).toBe(2);
    expect(applyResult.offerDeletionsFailed).toBe(0);

    // ========================================================================
    // ASSERT: Verify DB state matches M6 contract guarantees
    // ========================================================================

    // 1. Company resolution updated to ACCEPTED
    const companyAfter = companiesRepo.getCompanyById(companyId);
    expect(companyAfter).toBeDefined();
    expect(companyAfter!.resolution).toBe("ACCEPTED");

    // 2. All offers deleted
    const offersAfter = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(companyId) as { count: number };
    expect(offersAfter.count).toBe(0);

    // 3. All other company fields UNCHANGED (identity + metrics)
    expect(companyAfter!.name_display).toBe(companyBefore!.name_display);
    expect(companyAfter!.website_domain).toBe(companyBefore!.website_domain);
    expect(companyAfter!.max_score).toBe(companyBefore!.max_score);
    expect(companyAfter!.offer_count).toBe(companyBefore!.offer_count);
    expect(companyAfter!.unique_offer_count).toBe(
      companyBefore!.unique_offer_count,
    );
    expect(companyAfter!.strong_offer_count).toBe(
      companyBefore!.strong_offer_count,
    );
    expect(companyAfter!.avg_strong_score).toBe(
      companyBefore!.avg_strong_score,
    );
  });
});
