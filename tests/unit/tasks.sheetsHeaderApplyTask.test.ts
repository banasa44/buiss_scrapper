import { describe, it, expect, afterEach, vi } from "vitest";
import { GoogleSheetsClient } from "@/clients/googleSheets";
import { SheetsHeaderApplyTask } from "@/tasks/sheetsHeaderApplyTask";
import { ALL_TASKS, MANUAL_TASKS, findTaskByKey } from "@/tasks";
import * as sheets from "@/sheets";
import { GOOGLE_SHEETS_SPREADSHEET_ID_ENV } from "@/constants/clients/googleSheets";

const ORIGINAL_SPREADSHEET_ID = process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV];
const ORIGINAL_SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const ORIGINAL_SA_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

function createTaskContext() {
  return {
    ownerId: "test-owner-id",
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

afterEach(() => {
  if (ORIGINAL_SPREADSHEET_ID === undefined) {
    delete process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV];
  } else {
    process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV] = ORIGINAL_SPREADSHEET_ID;
  }

  if (ORIGINAL_SA_EMAIL === undefined) {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  } else {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = ORIGINAL_SA_EMAIL;
  }

  if (ORIGINAL_SA_KEY === undefined) {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  } else {
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = ORIGINAL_SA_KEY;
  }

  vi.restoreAllMocks();
});

describe("SheetsHeaderApplyTask", () => {
  it("is discoverable by key and excluded from normal ALL_TASKS pipeline", () => {
    expect(findTaskByKey("sheets:header:apply")).toBe(SheetsHeaderApplyTask);
    expect(MANUAL_TASKS.some((task) => task.taskKey === "sheets:header:apply")).toBe(
      true,
    );
    expect(ALL_TASKS.some((task) => task.taskKey === "sheets:header:apply")).toBe(
      false,
    );
  });

  it("fails fast when spreadsheet id is missing", async () => {
    delete process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV];

    await expect(
      SheetsHeaderApplyTask.runOnce(createTaskContext() as any),
    ).rejects.toThrow(/Missing .*GOOGLE_SHEETS_SPREADSHEET_ID/i);
  });

  it("applies Companies header explicitly when configured", async () => {
    process.env[GOOGLE_SHEETS_SPREADSHEET_ID_ENV] = "test-spreadsheet-id";
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@example.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";

    const authSpy = vi
      .spyOn(GoogleSheetsClient.prototype, "assertAuthReady")
      .mockResolvedValue(undefined);
    const applySpy = vi
      .spyOn(sheets, "applyCompanySheetHeader")
      .mockResolvedValue(undefined);

    await SheetsHeaderApplyTask.runOnce(createTaskContext() as any);

    expect(authSpy).toHaveBeenCalledOnce();
    expect(applySpy).toHaveBeenCalledOnce();
  });
});
