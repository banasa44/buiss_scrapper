/**
 * Unit tests for feedback reader nightly gate enforcement
 *
 * Verifies that readCompanyFeedbackFromSheet refuses to read outside
 * the nightly feedback window, providing defense-in-depth.
 */

import { describe, it, expect } from "vitest";
import { readCompanyFeedbackFromSheet } from "@/sheets/feedbackReader";

/**
 * Mock GoogleSheetsClient that should never be called during gate tests
 */
class MockGoogleSheetsClient {
  async readRange(): Promise<any> {
    throw new Error(
      "SECURITY VIOLATION: readRange called outside feedback window!",
    );
  }

  get spreadsheetId(): string {
    return "mock-spreadsheet-id";
  }
}

describe("Feedback Reader Nightly Gate", () => {
  describe("readCompanyFeedbackFromSheet gate enforcement", () => {
    it("should return empty result for read attempts outside nightly window (daytime)", async () => {
      // Create a mock client that should never be called
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate daytime: 2026-02-07 12:00:00 Madrid time
      // This is clearly outside the 03:00-06:00 window
      const daytime = new Date("2026-02-07T11:00:00Z"); // 12:00 Madrid (UTC+1)

      // Attempt to read feedback - should return empty result (not throw)
      const result = await readCompanyFeedbackFromSheet(mockClient, daytime);

      // Verify empty result
      expect(result.map).toEqual({});
      expect(result.totalRows).toBe(0);
      expect(result.validRows).toBe(0);
      expect(result.invalidRows).toBe(0);
      expect(result.duplicateRows).toBe(0);
    });

    it("should return empty result for read attempts outside window (early morning before 03:00)", async () => {
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate 02:00 Madrid time (before window starts)
      const earlyMorning = new Date("2026-02-07T01:00:00Z"); // 02:00 Madrid

      const result = await readCompanyFeedbackFromSheet(
        mockClient,
        earlyMorning,
      );

      expect(result.map).toEqual({});
      expect(result.totalRows).toBe(0);
    });

    it("should return empty result for read attempts outside window (late morning after 06:00)", async () => {
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate 07:00 Madrid time (after window ends)
      const lateMorning = new Date("2026-02-07T06:00:00Z"); // 07:00 Madrid

      const result = await readCompanyFeedbackFromSheet(
        mockClient,
        lateMorning,
      );

      expect(result.map).toEqual({});
      expect(result.totalRows).toBe(0);
    });

    it("should return empty result for read attempts at midnight", async () => {
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate midnight Madrid time
      const midnight = new Date("2026-02-07T23:00:00Z"); // 00:00 Madrid

      const result = await readCompanyFeedbackFromSheet(mockClient, midnight);

      expect(result.map).toEqual({});
      expect(result.totalRows).toBe(0);
    });

    // NOTE: We cannot test the "allowed" case without mocking the Sheets API,
    // which is against project policy. The existing integration tests cover
    // the happy path. This test suite focuses on the security gate only.
  });

  describe("defensive security properties", () => {
    it("should never call Sheets API when gate is closed", async () => {
      const mockClient = new MockGoogleSheetsClient() as any;
      const daytime = new Date("2026-02-07T11:00:00Z"); // 12:00 Madrid

      let sheetsCalled = false;
      mockClient.readRange = async () => {
        sheetsCalled = true;
        return { ok: true, data: { values: [] } };
      };

      // Should return empty result without calling Sheets
      const result = await readCompanyFeedbackFromSheet(mockClient, daytime);

      // Verify Sheets API was never called
      expect(sheetsCalled).toBe(false);
      // Verify empty result returned
      expect(result.map).toEqual({});
    });
  });
});
