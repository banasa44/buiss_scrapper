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
  COMPANY_SHEET_COL_INDEX,
  ACTIVE_RESOLUTIONS,
  RESOLVED_RESOLUTIONS,
  MODEL_FEEDBACK_VALUES,
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

  it("should fetch sheetId and apply data validation to Resolution and Feedback Modelo columns", async () => {
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
    expect(batchUpdateRequest).toHaveLength(2);

    const resolutionRequest = batchUpdateRequest.find(
      (request: any) =>
        request?.setDataValidation?.range?.startColumnIndex ===
        COMPANY_SHEET_COL_INDEX.resolution,
    ) as any;
    const modelFeedbackRequest = batchUpdateRequest.find(
      (request: any) =>
        request?.setDataValidation?.range?.startColumnIndex ===
        COMPANY_SHEET_COL_INDEX.model_feedback,
    ) as any;

    expect(resolutionRequest?.setDataValidation).toBeDefined();
    expect(modelFeedbackRequest?.setDataValidation).toBeDefined();

    const resolutionValidation = resolutionRequest.setDataValidation;
    const modelFeedbackValidation = modelFeedbackRequest.setDataValidation;

    // Verify sheetId and row range (shared)
    expect(resolutionValidation.range.sheetId).toBe(123);
    expect(modelFeedbackValidation.range.sheetId).toBe(123);
    expect(resolutionValidation.range.startRowIndex).toBe(
      COMPANY_SHEET_FIRST_DATA_ROW - 1,
    );
    expect(modelFeedbackValidation.range.startRowIndex).toBe(
      COMPANY_SHEET_FIRST_DATA_ROW - 1,
    );
    expect(resolutionValidation.range.endRowIndex).toBe(
      COMPANY_SHEET_VALIDATION_MAX_ROW,
    );
    expect(modelFeedbackValidation.range.endRowIndex).toBe(
      COMPANY_SHEET_VALIDATION_MAX_ROW,
    );

    // Verify resolution column range and values
    expect(resolutionValidation.range.startColumnIndex).toBe(
      COMPANY_SHEET_COL_INDEX.resolution,
    );
    expect(resolutionValidation.range.endColumnIndex).toBe(
      COMPANY_SHEET_COL_INDEX.resolution + 1,
    );
    expect(resolutionValidation.rule.condition.type).toBe("ONE_OF_LIST");
    expect(resolutionValidation.rule.condition.values).toHaveLength(
      ACTIVE_RESOLUTIONS.length + RESOLVED_RESOLUTIONS.length,
    );
    const expectedResolutionValues = [...ACTIVE_RESOLUTIONS, ...RESOLVED_RESOLUTIONS];
    expectedResolutionValues.forEach((value, index) => {
      expect(
        resolutionValidation.rule.condition.values![index].userEnteredValue,
      ).toBe(value);
    });

    // Verify model feedback column range and values
    expect(modelFeedbackValidation.range.startColumnIndex).toBe(
      COMPANY_SHEET_COL_INDEX.model_feedback,
    );
    expect(modelFeedbackValidation.range.endColumnIndex).toBe(
      COMPANY_SHEET_COL_INDEX.model_feedback + 1,
    );
    expect(modelFeedbackValidation.rule.condition.type).toBe("ONE_OF_LIST");
    expect(modelFeedbackValidation.rule.condition.values).toHaveLength(
      MODEL_FEEDBACK_VALUES.length,
    );
    MODEL_FEEDBACK_VALUES.forEach((value, index) => {
      expect(
        modelFeedbackValidation.rule.condition.values![index].userEnteredValue,
      ).toBe(value);
    });

    expect(resolutionValidation.rule.strict).toBe(true);
    expect(modelFeedbackValidation.rule.strict).toBe(true);
    expect(resolutionValidation.rule.showCustomUi).toBe(true);
    expect(modelFeedbackValidation.rule.showCustomUi).toBe(true);
  });
});
