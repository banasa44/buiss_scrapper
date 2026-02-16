import { describe, it, expect, vi } from "vitest";
import { enforceCompanySheetHeader } from "@/sheets/headerEnforcer";
import { COMPANY_SHEET_HEADERS } from "@/constants";
import type { GoogleSheetsClient } from "@/clients/googleSheets";

function createMockClient(
  headerRow: unknown[] | null,
): {
  client: GoogleSheetsClient;
  readRange: ReturnType<typeof vi.fn>;
  batchUpdate: ReturnType<typeof vi.fn>;
} {
  const readRange = vi.fn();
  const batchUpdate = vi.fn();

  readRange.mockResolvedValue({
    ok: true,
    data: {
      range: "Companies!A1:L1",
      values: headerRow ? [headerRow] : [],
    },
  });

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
      readRange,
      batchUpdate,
    } as unknown as GoogleSheetsClient,
    readRange,
    batchUpdate,
  };
}

describe("enforceCompanySheetHeader", () => {
  it("passes when header exactly matches contract and never writes", async () => {
    const { client, batchUpdate } = createMockClient([...COMPANY_SHEET_HEADERS]);

    await expect(enforceCompanySheetHeader(client)).resolves.toBeUndefined();
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("fails when header is missing and never writes", async () => {
    const { client, batchUpdate } = createMockClient(null);

    await expect(enforceCompanySheetHeader(client)).rejects.toThrow(
      /header does not match contract/i,
    );
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("fails with clear diff when any header column mismatches", async () => {
    const mismatchHeader = [...COMPANY_SHEET_HEADERS];
    mismatchHeader[7] = "Score fuerte medio";

    const { client, batchUpdate } = createMockClient(mismatchHeader);

    await expect(enforceCompanySheetHeader(client)).rejects.toThrow(
      /Column H: expected "URL Oferta Top", got "Score fuerte medio"/i,
    );
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});
