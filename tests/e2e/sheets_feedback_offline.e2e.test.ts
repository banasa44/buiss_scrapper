/**
 * E2E Test: Google Sheets Feedback Loop (Offline - Mock HTTP + Real DB)
 *
 * Validates the complete M6 feedback processing pipeline:
 * Mock HTTP (OAuth + Sheets API) → processSheetsFeedback → applyValidatedFeedbackPlanToDb → SQLite DB
 *
 * This test proves the end-to-end flow without real network calls or Google credentials.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { processSheetsFeedback } from "@/sheets/processSheetsFeedback";
import { applyValidatedFeedbackPlanToDb } from "@/sheets/feedbackPersistence";
import { createTestDbSync, type TestDbHarness } from "../helpers/testDb";
import * as offersRepo from "@/db/repos/offersRepo";
import * as companiesRepo from "@/db/repos/companiesRepo";

describe("E2E: Google Sheets Feedback Loop (Offline)", () => {
  let dbHarness: TestDbHarness;

  // Mock fetch responses
  const mockFetch = vi.fn();

  beforeEach(() => {
    // Create fresh test DB with migrations
    dbHarness = createTestDbSync();

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

  it("should process feedback loop: read sheet → classify → update DB + delete offers", async () => {
    // ========================================================================
    // ARRANGE: Insert test companies into DB
    // ========================================================================

    // Company A: Active (PENDING) → will transition to ACCEPTED (destructive)
    // Insert directly via SQL to control all fields including aggregation metrics
    const companyAId = dbHarness.db
      .prepare(
        `
      INSERT INTO companies (
        name_raw, name_display, normalized_name, website_url, website_domain,
        created_at, updated_at, max_score, offer_count, unique_offer_count,
        strong_offer_count, avg_strong_score, top_category_id, top_offer_id,
        category_max_scores, last_strong_at, resolution
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "Acme Corporation",
        "Acme Corp",
        "acme corporation",
        "https://acme.com",
        "acme.com",
        "2026-02-01T10:00:00Z",
        "2026-02-01T10:00:00Z",
        8.2,
        2,
        2,
        1,
        7.5,
        "cat_backend",
        null,
        null,
        "2026-02-01T10:00:00Z",
        "PENDING", // Active state
      ).lastInsertRowid as number;

    // Insert 2 offers for Company A (should be deleted on resolution)
    offersRepo.upsertOffer({
      provider: "infojobs",
      provider_offer_id: "acme-offer-1",
      provider_url: "https://example.com/acme-1",
      company_id: companyAId,
      title: "Backend Developer",
      description: "Backend role",
      min_requirements: null,
      desired_requirements: null,
      requirements_snippet: null,
      published_at: "2026-02-01T10:00:00Z",
      updated_at: "2026-02-01T10:00:00Z",
      created_at: "2026-02-01T10:00:00Z",
      applications_count: null,
      metadata_json: null,
      raw_json: null,
    });

    offersRepo.upsertOffer({
      provider: "infojobs",
      provider_offer_id: "acme-offer-2",
      provider_url: "https://example.com/acme-2",
      company_id: companyAId,
      title: "Frontend Developer",
      description: "Frontend role",
      min_requirements: null,
      desired_requirements: null,
      requirements_snippet: null,
      published_at: "2026-02-01T10:00:00Z",
      updated_at: "2026-02-01T10:00:00Z",
      created_at: "2026-02-01T10:00:00Z",
      applications_count: null,
      metadata_json: null,
      raw_json: null,
    });

    // Company B: Resolved (ACCEPTED) → will transition to PENDING (reversal)
    const companyBId = dbHarness.db
      .prepare(
        `
      INSERT INTO companies (
        name_raw, name_display, normalized_name, website_url, website_domain,
        created_at, updated_at, max_score, offer_count, unique_offer_count,
        strong_offer_count, avg_strong_score, top_category_id, top_offer_id,
        category_max_scores, last_strong_at, resolution
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "Beta Limited",
        "Beta Ltd",
        "beta limited",
        "https://beta.com",
        "beta.com",
        "2026-02-01T11:00:00Z",
        "2026-02-01T11:00:00Z",
        null,
        0,
        0,
        0,
        null,
        null,
        null,
        null,
        null,
        "ACCEPTED", // Resolved state
      ).lastInsertRowid as number;

    // Verify initial state
    expect(companiesRepo.getCompanyById(companyAId)?.resolution).toBe(
      "PENDING",
    );
    expect(companiesRepo.getCompanyById(companyBId)?.resolution).toBe(
      "ACCEPTED",
    );

    // Verify offers exist for Company A
    const initialOffersA = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(companyAId) as { count: number };
    expect(initialOffersA.count).toBe(2);

    const initialOffersB = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(companyBId) as { count: number };
    expect(initialOffersB.count).toBe(0);

    // ========================================================================
    // ARRANGE: Mock Google Sheets HTTP responses
    // ========================================================================

    // Valid PKCS8 private key for testing (generated, not used in production)
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

    // Mock OAuth2 token endpoint
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlString = url.toString();

      // OAuth2 token request
      if (urlString.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "mock-access-token-12345",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        };
      }

      // Sheets values read request
      if (
        urlString.includes("sheets.googleapis.com") &&
        urlString.includes("/values/")
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            range: "Companies!A1:C5",
            majorDimension: "ROWS",
            values: [
              // Header row (skipped by feedbackReader)
              ["company_id", "resolution", "company_name"],
              // Company A: PENDING → ACCEPTED (destructive)
              [String(companyAId), "ACCEPTED", "Acme Corp"],
              // Company B: ACCEPTED → PENDING (reversal)
              [String(companyBId), "PENDING", "Beta Ltd"],
              // Unknown company (should be skipped)
              ["999", "REJECTED", "Unknown Company"],
              // Invalid company_id (should be skipped)
              ["invalid_id", "PENDING", "Bad Row"],
            ],
          }),
        };
      }

      throw new Error(`Unmocked fetch URL: ${urlString}`);
    });

    // Create GoogleSheetsClient with test configuration
    const client = new GoogleSheetsClient({
      spreadsheetId: "test-spreadsheet-123",
      credentials: {
        clientEmail: "test@example.iam.gserviceaccount.com",
        privateKey: mockPrivateKey,
      },
    });

    // ========================================================================
    // ACT: Process feedback (read + classify)
    // ========================================================================

    // Mock time to be within feedback window (04:00 Madrid time = 03:00 UTC in winter)
    const mockNow = new Date("2026-02-05T03:00:00Z"); // 04:00 Madrid

    const feedbackResult = await processSheetsFeedback(client, mockNow);

    // ========================================================================
    // ASSERT: Feedback processing results
    // ========================================================================

    expect(feedbackResult.ok).toBe(true);
    expect(feedbackResult.skipped).toBe(false);

    // Verify feedback read captured invalid rows
    expect(feedbackResult.feedbackReadResult?.totalRows).toBe(4); // Excludes header
    expect(feedbackResult.feedbackReadResult?.validRows).toBe(3); // A, B, and 999 (parses successfully)
    expect(feedbackResult.feedbackReadResult?.invalidRows).toBe(1); // Only invalid_id

    // Verify change plan
    expect(feedbackResult.changePlan?.changesDetected).toBe(2);
    expect(feedbackResult.changePlan?.unknownCompanyIds).toBe(1); // Company 999

    // Verify validated plan classification
    expect(feedbackResult.validatedPlan?.destructiveCount).toBe(1); // Company A
    expect(feedbackResult.validatedPlan?.reversalCount).toBe(1); // Company B
    expect(feedbackResult.validatedPlan?.informationalCount).toBe(0);

    // ========================================================================
    // ACT: Apply plan to database
    // ========================================================================

    const applyResult = applyValidatedFeedbackPlanToDb(
      feedbackResult.validatedPlan!,
    );

    // ========================================================================
    // ASSERT: DB mutations
    // ========================================================================

    // Verify apply result counters
    expect(applyResult.attempted).toBe(2);
    expect(applyResult.updated).toBe(2);
    expect(applyResult.failed).toBe(0);
    expect(applyResult.offerDeletionAttempted).toBe(1); // Only destructive change
    expect(applyResult.offersDeleted).toBe(2); // Company A's 2 offers

    // Verify Company A: resolution updated to ACCEPTED, offers deleted
    const companyAAfter = companiesRepo.getCompanyById(companyAId);
    expect(companyAAfter?.resolution).toBe("ACCEPTED");
    expect(companyAAfter?.max_score).toBe(8.2); // Metrics preserved
    expect(companyAAfter?.offer_count).toBe(2); // Metrics preserved

    const finalOffersA = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(companyAId) as { count: number };
    expect(finalOffersA.count).toBe(0); // Offers deleted

    // Verify Company B: resolution updated to PENDING, no offers deleted
    const companyBAfter = companiesRepo.getCompanyById(companyBId);
    expect(companyBAfter?.resolution).toBe("PENDING");

    const finalOffersB = dbHarness.db
      .prepare("SELECT COUNT(*) as count FROM offers WHERE company_id = ?")
      .get(companyBId) as { count: number };
    expect(finalOffersB.count).toBe(0); // Still no offers

    // Verify unknown/invalid companies did not cause DB changes
    const company999 = companiesRepo.getCompanyById(999);
    expect(company999).toBeUndefined(); // Should not exist
  });
});
