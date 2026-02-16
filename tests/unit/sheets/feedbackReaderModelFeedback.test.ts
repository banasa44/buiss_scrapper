/**
 * Unit tests for strict model feedback parsing in feedbackReader
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readModelFeedbackFromSheet } from "@/sheets/feedbackReader";
import * as logger from "@/logger";

describe("readModelFeedbackFromSheet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should normalize valid values and skip invalid model_feedback values", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const mockClient = {
      readRange: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          values: [
            [
              "ID Empresa",
              "Empresa",
              "Resolución",
              "Score máx.",
              "Ofertas fuertes",
              "Ofertas únicas",
              "Actividad publicaciones",
              "URL Oferta Top",
              "Categoría top",
              "Última señal fuerte",
              "Feedback Modelo",
              "Notas Modelo",
            ],
            ["1", "A", "PENDING", "", "", "", "", "", "", "", "fp", "note A"],
            [
              "2",
              "B",
              "PENDING",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "bad_value",
              "note B",
            ],
            [
              "3",
              "C",
              "PENDING",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "unknown",
              "",
            ],
            [
              "invalid_id",
              "D",
              "PENDING",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "FN",
              "",
            ],
            ["4", "E", "PENDING", "", "", "", "", "", "", "", "", ""],
            ["5", "F", "PENDING", "", "", "", "", "", "", "", "  ok  ", "note F"],
          ],
        },
      }),
    } as any;

    // 03:00 UTC in winter = 04:00 Europe/Madrid (inside 03:00-06:00 window)
    const nowWithinWindow = new Date("2026-02-07T03:00:00Z");
    const result = await readModelFeedbackFromSheet(mockClient, nowWithinWindow);

    expect(result.totalRows).toBe(5);
    expect(result.validRows).toBe(2);
    expect(result.invalidRows).toBe(3);
    expect(result.events).toHaveLength(2);

    expect(result.events[0].feedbackValue).toBe("FP");
    expect(result.events[1].feedbackValue).toBe("OK");

    const loggedInvalidFeedback = warnSpy.mock.calls.some(
      ([message, payload]) =>
        message === "Skipping sheet row with invalid model_feedback value" &&
        (payload as { rowIndex?: number; companyId?: number })
          ?.rowIndex === 3 &&
        (payload as { rowIndex?: number; companyId?: number })
          ?.companyId === 2,
    );
    expect(loggedInvalidFeedback).toBe(true);
  });
});
