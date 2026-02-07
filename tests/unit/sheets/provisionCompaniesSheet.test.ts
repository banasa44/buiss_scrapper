/**
 * Unit Test — Companies Sheet Provisioning
 *
 * Validates that provisionCompaniesSheet correctly:
 * 1. Calls header enforcement
 * 2. Fetches sheetId by title
 * 3. Applies data validation to Resolution column with correct rule and range
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { provisionCompaniesSheet } from "@/sheets/provisionCompaniesSheet";
import * as headerEnforcer from "@/sheets/headerEnforcer";
import {
  COMPANY_SHEET_FIRST_DATA_ROW,
  COMPANY_SHEET_VALIDATION_MAX_ROW,
  ACTIVE_RESOLUTIONS,
  RESOLVED_RESOLUTIONS,
} from "@/constants";

describe("Unit: provisionCompaniesSheet", () => {
  let client: GoogleSheetsClient;

  beforeEach(() => {
    // Create a minimal client instance for stubbing
    client = new GoogleSheetsClient({
      spreadsheetId: "test-sheet-id",
      credentials: {
        clientEmail: "test@test.iam.gserviceaccount.com",
        privateKey:
          "-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----",
        projectId: "test-project",
      },
    });
  });

  it("should fetch sheetId and apply data validation to Resolution column", async () => {
    // ========================================================================
    // ARRANGE: Stub client methods
    // ========================================================================

    // Stub header enforcement (standalone function)
    const enforceHeaderSpy = vi.spyOn(
      headerEnforcer,
      "enforceCompanySheetHeader",
    );
    enforceHeaderSpy.mockResolvedValue(undefined as any);

    // Stub sheetId lookup
    const getSheetIdSpy = vi.spyOn(client, "getSheetIdByTitle");
    getSheetIdSpy.mockResolvedValue({
      ok: true,
      data: {
        sheetId: 123,
        sheetTitle: "Companies",
      },
    } as any);

    // Stub batchUpdate call
    const batchUpdateSpy = vi.spyOn(client, "applySheetBatchUpdate");
    batchUpdateSpy.mockResolvedValue({
      ok: true,
      data: {
        spreadsheetId: "test-sheet-id",
        replies: [],
      },
    } as any);

    // ========================================================================
    // ACT: Run provisioning
    // ========================================================================
    await provisionCompaniesSheet(client);

    // ========================================================================
    // ASSERT: Verify header enforcement was called
    // ========================================================================
    expect(enforceHeaderSpy).toHaveBeenCalledWith(client);

    // ========================================================================
    // ASSERT: Verify sheetId lookup was called
    // ========================================================================
    expect(getSheetIdSpy).toHaveBeenCalledWith("Companies");

    // ========================================================================
    // ASSERT: Verify batchUpdate was called with correct validation rule
    // ========================================================================
    expect(batchUpdateSpy).toHaveBeenCalledOnce();

    const batchUpdateRequest = batchUpdateSpy.mock.calls[0][0];
    expect(batchUpdateRequest).toHaveLength(1);

    const validationRequest = batchUpdateRequest[0] as any;
    expect(validationRequest.setDataValidation).toBeDefined();

    const validation = validationRequest.setDataValidation;

    // Verify sheetId (from lookup)
    expect(validation.range.sheetId).toBe(123);

    // Verify range (column C, rows 2-1000)
    expect(validation.range.startRowIndex).toBe(
      COMPANY_SHEET_FIRST_DATA_ROW - 1,
    );
    expect(validation.range.endRowIndex).toBe(COMPANY_SHEET_VALIDATION_MAX_ROW);
    expect(validation.range.startColumnIndex).toBe(2); // Column C
    expect(validation.range.endColumnIndex).toBe(3);

    // Verify validation rule
    const rule = validation.rule;
    expect(rule.condition.type).toBe("ONE_OF_LIST");
    expect(rule.condition.values).toHaveLength(
      ACTIVE_RESOLUTIONS.length + RESOLVED_RESOLUTIONS.length,
    );

    const expectedValues = [...ACTIVE_RESOLUTIONS, ...RESOLVED_RESOLUTIONS];
    expectedValues.forEach((value, index) => {
      expect(rule.condition.values![index].userEnteredValue).toBe(value);
    });

    expect(rule.strict).toBe(true);
    expect(rule.showCustomUi).toBe(true);
  });
});
