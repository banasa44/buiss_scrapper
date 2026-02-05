/**
 * Unit tests for Google Sheets parsing logic
 *
 * Tests pure, deterministic parsing of sheet cell values:
 * - company_id parsing with defensive handling
 * - resolution enum parsing with case normalization
 *
 * No DB, no network, no Google API calls
 */

import { describe, it, expect } from "vitest";
import { parseCompanyId, parseResolution } from "@/utils";

describe("parseCompanyId", () => {
  describe("valid inputs", () => {
    it("should parse positive integer numbers", () => {
      expect(parseCompanyId(1)).toBe(1);
      expect(parseCompanyId(42)).toBe(42);
      expect(parseCompanyId(999)).toBe(999);
    });

    it("should parse positive integer strings", () => {
      expect(parseCompanyId("1")).toBe(1);
      expect(parseCompanyId("42")).toBe(42);
      expect(parseCompanyId("999")).toBe(999);
    });

    it("should parse strings with leading/trailing whitespace", () => {
      expect(parseCompanyId(" 123 ")).toBe(123);
      expect(parseCompanyId("  42  ")).toBe(42);
      expect(parseCompanyId("\t99\n")).toBe(99);
    });
  });

  describe("invalid inputs", () => {
    it("should return null for zero", () => {
      expect(parseCompanyId(0)).toBeNull();
      expect(parseCompanyId("0")).toBeNull();
    });

    it("should return null for negative numbers", () => {
      expect(parseCompanyId(-1)).toBeNull();
      expect(parseCompanyId("-5")).toBeNull();
    });

    it("should return null for non-integer numbers", () => {
      expect(parseCompanyId(3.14)).toBeNull();
      expect(parseCompanyId("3.14")).toBeNull();
    });

    it("should return null for non-numeric strings", () => {
      expect(parseCompanyId("abc")).toBeNull();
      expect(parseCompanyId("12abc")).toBeNull();
      expect(parseCompanyId("")).toBeNull();
    });

    it("should return null for null/undefined", () => {
      expect(parseCompanyId(null)).toBeNull();
      expect(parseCompanyId(undefined)).toBeNull();
    });

    it("should return null for boolean/object types", () => {
      expect(parseCompanyId(true)).toBeNull();
      expect(parseCompanyId(false)).toBeNull();
      expect(parseCompanyId({})).toBeNull();
      expect(parseCompanyId([])).toBeNull();
    });
  });
});

describe("parseResolution", () => {
  describe("valid inputs", () => {
    it("should parse valid resolution values (exact case)", () => {
      expect(parseResolution("PENDING")).toBe("PENDING");
      expect(parseResolution("ALREADY_REVOLUT")).toBe("ALREADY_REVOLUT");
      expect(parseResolution("ACCEPTED")).toBe("ACCEPTED");
      expect(parseResolution("REJECTED")).toBe("REJECTED");
    });

    it("should parse valid resolution values (case-insensitive)", () => {
      expect(parseResolution("pending")).toBe("PENDING");
      expect(parseResolution("Pending")).toBe("PENDING");
      expect(parseResolution("accepted")).toBe("ACCEPTED");
      expect(parseResolution("Accepted")).toBe("ACCEPTED");
      expect(parseResolution("rejected")).toBe("REJECTED");
    });

    it("should parse values with leading/trailing whitespace", () => {
      expect(parseResolution(" PENDING ")).toBe("PENDING");
      expect(parseResolution("  accepted  ")).toBe("ACCEPTED");
      expect(parseResolution("\tREJECTED\n")).toBe("REJECTED");
    });
  });

  describe("invalid inputs", () => {
    it("should return null for empty string", () => {
      expect(parseResolution("")).toBeNull();
      expect(parseResolution("   ")).toBeNull();
    });

    it("should return null for invalid resolution values", () => {
      expect(parseResolution("INVALID")).toBeNull();
      expect(parseResolution("???")).toBeNull();
      expect(parseResolution("approved")).toBeNull();
      expect(parseResolution("declined")).toBeNull();
    });

    it("should return null for non-string types", () => {
      expect(parseResolution(null)).toBeNull();
      expect(parseResolution(undefined)).toBeNull();
      expect(parseResolution(123)).toBeNull();
      expect(parseResolution(true)).toBeNull();
      expect(parseResolution({})).toBeNull();
    });
  });
});
