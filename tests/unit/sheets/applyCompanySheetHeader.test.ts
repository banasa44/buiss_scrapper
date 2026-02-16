/**
 * Unit Test — Apply Company Sheet Header (Developer Utility)
 *
 * Validates that applyCompanySheetHeader unconditionally writes
 * the current header contract to A1:L1.
 *
 * This test covers the force-write behavior needed for manual schema fixes.
 */

import { describe, it, expect, vi } from "vitest";
import { applyCompanySheetHeader } from "@/sheets/applyCompanySheetHeader";
import { COMPANY_SHEET_HEADERS, COMPANY_SHEET_COLUMNS } from "@/constants";
import type { GoogleSheetsClient } from "@/clients/googleSheets";

function createMockClient(): {
  client: GoogleSheetsClient;
  batchUpdate: ReturnType<typeof vi.fn>;
} {
  const batchUpdate = vi.fn();

  batchUpdate.mockResolvedValue({
    ok: true,
    data: {
      updatedRange: "Companies!A1:L1",
      updatedRows: 1,
      updatedColumns: 12,
      updatedCells: 12,
    },
  });

  return {
    client: {
      batchUpdate,
    } as unknown as GoogleSheetsClient,
    batchUpdate,
  };
}

describe("Unit: applyCompanySheetHeader", () => {
  it("should unconditionally write COMPANY_SHEET_HEADERS to A1:L1", async () => {
    const { client, batchUpdate } = createMockClient();

    await applyCompanySheetHeader(client);

    // Verify the correct range was written
    const expectedLastColumn = String.fromCharCode(
      65 + COMPANY_SHEET_COLUMNS.length - 1,
    ); // 'L' for 12 columns
    const expectedRange = `Companies!A1:${expectedLastColumn}1`;

    expect(batchUpdate).toHaveBeenCalledOnce();
    expect(batchUpdate).toHaveBeenCalledWith(
      [COMPANY_SHEET_HEADERS],
      expectedRange,
    );
  });

  it("should apply current contract header with URL Oferta Top in column H", async () => {
    const { client, batchUpdate } = createMockClient();

    await applyCompanySheetHeader(client);

    const writtenHeaders = batchUpdate.mock.calls[0][0];
    expect(writtenHeaders).toEqual([COMPANY_SHEET_HEADERS]);

    // Verify column H (index 7) has the expected "URL Oferta Top" header
    expect(COMPANY_SHEET_HEADERS[7]).toBe("URL Oferta Top");
  });

  it("should throw when write fails", async () => {
    const batchUpdate = vi.fn();
    batchUpdate.mockResolvedValue({
      ok: false,
      error: {
        message: "Network error",
        code: "NETWORK_ERROR",
      },
    });

    const client = {
      batchUpdate,
    } as unknown as GoogleSheetsClient;

    await expect(applyCompanySheetHeader(client)).rejects.toThrow(
      /Failed to apply Companies sheet header/,
    );
  });

  it("should be idempotent (same output regardless of current state)", async () => {
    const { client, batchUpdate } = createMockClient();

    // Run twice
    await applyCompanySheetHeader(client);
    await applyCompanySheetHeader(client);

    // Both calls should write identical data
    expect(batchUpdate).toHaveBeenCalledTimes(2);
    expect(batchUpdate.mock.calls[0]).toEqual(batchUpdate.mock.calls[1]);
  });
});
