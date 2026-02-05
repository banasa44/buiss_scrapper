/**
 * Unit tests for Google Sheets metric update helpers
 *
 * Tests pure, deterministic logic for:
 * - A1 column notation conversion
 * - Metric column slicing from full rows
 * - Range string generation for updates
 *
 * No DB, no network, no Google API calls
 */

import { describe, it, expect } from "vitest";
import {
  colIndexToLetter,
  extractMetricSlice,
  buildMetricUpdateRange,
} from "@/utils";
import {
  COMPANY_SHEET_FIRST_METRIC_COL_INDEX,
  COMPANY_SHEET_LAST_METRIC_COL_INDEX,
  COMPANY_SHEET_METRIC_COL_COUNT,
  COMPANY_SHEET_NAME,
} from "@/constants/sheets";

describe("colIndexToLetter", () => {
  it("should convert 0 to A", () => {
    expect(colIndexToLetter(0)).toBe("A");
  });

  it("should convert first metric column index to D", () => {
    expect(colIndexToLetter(COMPANY_SHEET_FIRST_METRIC_COL_INDEX)).toBe("D");
  });

  it("should convert last metric column index to J", () => {
    expect(colIndexToLetter(COMPANY_SHEET_LAST_METRIC_COL_INDEX)).toBe("J");
  });

  it("should convert 25 to Z", () => {
    expect(colIndexToLetter(25)).toBe("Z");
  });

  it("should throw error for negative index", () => {
    expect(() => colIndexToLetter(-1)).toThrow(
      "Column index -1 out of range. Only A-Z (0-25) supported.",
    );
  });

  it("should throw error for index beyond Z", () => {
    expect(() => colIndexToLetter(26)).toThrow(
      "Column index 26 out of range. Only A-Z (0-25) supported.",
    );
  });
});

describe("extractMetricSlice", () => {
  it("should extract exactly 7 metric columns from full 10-column row", () => {
    const fullRow = [
      1, // company_id
      "Company Name", // company_name
      "PENDING", // resolution
      "8.5", // max_score (metric start)
      10, // strong_offers
      15, // unique_offers
      20, // posting_activity
      "7.2", // avg_strong_score
      "Cloud", // top_category
      "2026-02-01", // last_strong_at (metric end)
    ];

    const metrics = extractMetricSlice(fullRow);

    expect(metrics).toHaveLength(COMPANY_SHEET_METRIC_COL_COUNT);
    expect(metrics).toEqual([
      "8.5", // max_score
      10, // strong_offers
      15, // unique_offers
      20, // posting_activity
      "7.2", // avg_strong_score
      "Cloud", // top_category
      "2026-02-01", // last_strong_at
    ]);
  });

  it("should exclude company_id, company_name, and resolution from slice", () => {
    const fullRow = [
      42, // company_id (excluded)
      "Test Corp", // company_name (excluded)
      "ACCEPTED", // resolution (excluded)
      "9.0", // max_score (included)
      5, // strong_offers
      8, // unique_offers
      12, // posting_activity
      "8.5", // avg_strong_score
      "AI", // top_category
      "2026-01-15", // last_strong_at
    ];

    const metrics = extractMetricSlice(fullRow);

    // Should NOT contain the first 3 columns
    expect(metrics).not.toContain(42);
    expect(metrics).not.toContain("Test Corp");
    expect(metrics).not.toContain("ACCEPTED");

    // Should start with max_score
    expect(metrics[0]).toBe("9.0");
  });

  it("should handle empty strings and nullish values in metrics", () => {
    const fullRow = [
      1, // company_id
      "Company", // company_name
      "PENDING", // resolution
      "", // max_score (empty)
      "", // strong_offers (empty)
      "", // unique_offers (empty)
      "", // posting_activity (empty)
      "", // avg_strong_score (empty)
      "", // top_category (empty)
      "", // last_strong_at (empty)
    ];

    const metrics = extractMetricSlice(fullRow);

    expect(metrics).toHaveLength(COMPANY_SHEET_METRIC_COL_COUNT);
    expect(metrics.every((val) => val === "")).toBe(true);
  });
});

describe("buildMetricUpdateRange", () => {
  it("should generate range D2:J2 for row 2", () => {
    const range = buildMetricUpdateRange(2);
    expect(range).toBe(`${COMPANY_SHEET_NAME}!D2:J2`);
  });

  it("should generate range D10:J10 for row 10", () => {
    const range = buildMetricUpdateRange(10);
    expect(range).toBe(`${COMPANY_SHEET_NAME}!D10:J10`);
  });

  it("should generate range D100:J100 for row 100", () => {
    const range = buildMetricUpdateRange(100);
    expect(range).toBe(`${COMPANY_SHEET_NAME}!D100:J100`);
  });

  it("should use constants for column letters (not hardcoded)", () => {
    // This test verifies the range uses the constant-derived column letters
    // If constants change, the range should reflect that automatically
    const range = buildMetricUpdateRange(5);

    const firstCol = colIndexToLetter(COMPANY_SHEET_FIRST_METRIC_COL_INDEX);
    const lastCol = colIndexToLetter(COMPANY_SHEET_LAST_METRIC_COL_INDEX);
    const expectedRange = `${COMPANY_SHEET_NAME}!${firstCol}5:${lastCol}5`;

    expect(range).toBe(expectedRange);
  });

  it("should generate range that spans exactly COMPANY_SHEET_METRIC_COL_COUNT columns", () => {
    // Verify range spans from D (index 3) to J (index 9) = 7 columns
    const firstColIndex = COMPANY_SHEET_FIRST_METRIC_COL_INDEX; // 3
    const lastColIndex = COMPANY_SHEET_LAST_METRIC_COL_INDEX; // 9
    const expectedCount = lastColIndex - firstColIndex + 1;

    expect(expectedCount).toBe(COMPANY_SHEET_METRIC_COL_COUNT);

    // Verify range string contains these boundaries
    const range = buildMetricUpdateRange(2);
    expect(range).toContain("D2"); // First metric column
    expect(range).toContain("J2"); // Last metric column
  });
});
