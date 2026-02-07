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
    it("should reject read attempts outside nightly window (daytime)", async () => {
      // Create a mock client that should never be called
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate daytime: 2026-02-07 12:00:00 Madrid time
      // This is clearly outside the 03:00-06:00 window
      const daytime = new Date("2026-02-07T11:00:00Z"); // 12:00 Madrid (UTC+1)

      // Attempt to read feedback - should throw immediately due to gate
      await expect(
        readCompanyFeedbackFromSheet(mockClient, daytime),
      ).rejects.toThrow(/Feedback read blocked/);

      await expect(
        readCompanyFeedbackFromSheet(mockClient, daytime),
      ).rejects.toThrow(/nightly window/);
    });

    it("should reject read attempts outside window (early morning before 03:00)", async () => {
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate 02:00 Madrid time (before window starts)
      const earlyMorning = new Date("2026-02-07T01:00:00Z"); // 02:00 Madrid

      await expect(
        readCompanyFeedbackFromSheet(mockClient, earlyMorning),
      ).rejects.toThrow(/Feedback read blocked/);
    });

    it("should reject read attempts outside window (late morning after 06:00)", async () => {
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate 07:00 Madrid time (after window ends)
      const lateMorning = new Date("2026-02-07T06:00:00Z"); // 07:00 Madrid

      await expect(
        readCompanyFeedbackFromSheet(mockClient, lateMorning),
      ).rejects.toThrow(/Feedback read blocked/);
    });

    it("should reject read attempts at midnight", async () => {
      const mockClient = new MockGoogleSheetsClient() as any;

      // Simulate midnight Madrid time
      const midnight = new Date("2026-02-07T23:00:00Z"); // 00:00 Madrid

      await expect(
        readCompanyFeedbackFromSheet(mockClient, midnight),
      ).rejects.toThrow(/Feedback read blocked/);
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

      try {
        await readCompanyFeedbackFromSheet(mockClient, daytime);
      } catch (err) {
        // Expected to throw
      }

      // Verify Sheets API was never called
      expect(sheetsCalled).toBe(false);
    });
  });
});
