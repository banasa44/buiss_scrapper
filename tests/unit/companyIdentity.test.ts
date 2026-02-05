/**
 * Unit tests for company identity utilities
 *
 * Tests pure, deterministic normalization and extraction logic
 * No DB, no network, no side effects
 */

import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  extractWebsiteDomain,
  pickCompanyWebsiteUrl,
} from "@/utils";

describe("normalizeCompanyName", () => {
  describe("basic normalization", () => {
    it("should return empty string for empty input", () => {
      expect(normalizeCompanyName("")).toBe("");
    });

    it("should return empty string for whitespace-only input", () => {
      expect(normalizeCompanyName("   ")).toBe("");
      expect(normalizeCompanyName("\t\n")).toBe("");
    });

    it("should trim leading and trailing whitespace", () => {
      expect(normalizeCompanyName("  Acme Corp  ")).toBe("acme corp");
    });

    it("should convert to lowercase", () => {
      expect(normalizeCompanyName("TeSt CoMpAnY")).toBe("test company");
      expect(normalizeCompanyName("ACME CORP")).toBe("acme corp");
    });

    it("should collapse repeated whitespace to single spaces", () => {
      expect(normalizeCompanyName("Test    Company")).toBe("test company");
      expect(normalizeCompanyName("Acme  \t  Corp")).toBe("acme corp");
    });

    it("should preserve names without diacritics (aside from normalization)", () => {
      expect(normalizeCompanyName("Acme Holdings")).toBe("acme holdings");
    });
  });

  describe("accent/diacritic stripping", () => {
    it("should strip accents and diacritics", () => {
      expect(normalizeCompanyName("Société Générale")).toBe("societe generale");
      expect(normalizeCompanyName("Café España")).toBe("cafe espana");
      expect(normalizeCompanyName("Zürich Insurance")).toBe("zurich insurance");
    });

    it("should normalize diacritics with legal suffixes", () => {
      expect(normalizeCompanyName("José García S.L.")).toBe("jose garcia");
    });
  });

  describe("legal suffix removal", () => {
    it("should remove trailing S.L.", () => {
      expect(normalizeCompanyName("Acme Corp S.L.")).toBe("acme corp");
      expect(normalizeCompanyName("Test Company s.l.")).toBe("test company");
    });

    it("should remove trailing SL (without dots)", () => {
      expect(normalizeCompanyName("Acme Corp SL")).toBe("acme corp");
      expect(normalizeCompanyName("Test Company sl")).toBe("test company");
    });

    it("should remove trailing S.L.U.", () => {
      expect(normalizeCompanyName("Test Company S.L.U.")).toBe("test company");
      expect(normalizeCompanyName("Acme slu")).toBe("acme");
    });

    it("should remove trailing S.A.", () => {
      expect(normalizeCompanyName("Test S.A.")).toBe("test");
      expect(normalizeCompanyName("Acme Corp sa")).toBe("acme corp");
    });

    it("should remove suffix after comma", () => {
      expect(normalizeCompanyName("Test Company, S.L.")).toBe("test company");
      expect(normalizeCompanyName("Acme, S.L.U.")).toBe("acme");
    });

    it("should NOT remove 's' from regular words like 'sales'", () => {
      expect(normalizeCompanyName("Test Sales")).toBe("test sales");
      expect(normalizeCompanyName("Acme Services")).toBe("acme services");
    });

    it("should handle some variations of spacing in suffixes", () => {
      // Regex allows optional space BEFORE dot, but not AFTER dot
      expect(normalizeCompanyName("Acme S. L.")).toBe("acme");
      expect(normalizeCompanyName("Test S.A.")).toBe("test");
      // This pattern is NOT matched by current regex (spaces after dots)
      expect(normalizeCompanyName("Test S . A .")).toBe("test s . a .");
    });
  });

  describe("complex cases", () => {
    it("should apply all transformations together", () => {
      expect(normalizeCompanyName("  Société Test   S.L.  ")).toBe(
        "societe test",
      );
      expect(normalizeCompanyName("CAFÉ ESPAÑA, S.A.")).toBe("cafe espana");
    });

    it("should handle names without suffixes unchanged", () => {
      expect(normalizeCompanyName("Microsoft Corporation")).toBe(
        "microsoft corporation",
      );
      expect(normalizeCompanyName("Google LLC")).toBe("google llc");
    });
  });
});

describe("extractWebsiteDomain", () => {
  describe("valid URLs", () => {
    it("should extract domain from HTTP URL", () => {
      expect(extractWebsiteDomain("http://example.com")).toBe("example.com");
    });

    it("should extract domain from HTTPS URL", () => {
      expect(extractWebsiteDomain("https://example.com")).toBe("example.com");
    });

    it("should strip leading www.", () => {
      expect(extractWebsiteDomain("https://www.example.com")).toBe(
        "example.com",
      );
      expect(extractWebsiteDomain("http://www.test.org")).toBe("test.org");
    });

    it("should extract domain from URL with path", () => {
      expect(extractWebsiteDomain("https://example.com/about")).toBe(
        "example.com",
      );
      expect(extractWebsiteDomain("https://example.com/path/to/page")).toBe(
        "example.com",
      );
    });

    it("should extract domain from URL with port", () => {
      expect(extractWebsiteDomain("https://example.com:8080")).toBe(
        "example.com",
      );
      expect(extractWebsiteDomain("http://example.com:3000/api")).toBe(
        "example.com",
      );
    });

    it("should convert domain to lowercase", () => {
      expect(extractWebsiteDomain("HTTPS://EXAMPLE.COM")).toBe("example.com");
      expect(extractWebsiteDomain("https://WWW.EXAMPLE.COM")).toBe(
        "example.com",
      );
    });

    it("should extract subdomain correctly", () => {
      expect(extractWebsiteDomain("https://api.example.com")).toBe(
        "api.example.com",
      );
      expect(extractWebsiteDomain("https://www.api.example.com")).toBe(
        "api.example.com",
      );
    });

    it("should handle query parameters", () => {
      expect(extractWebsiteDomain("https://example.com?param=value")).toBe(
        "example.com",
      );
    });

    it("should trim whitespace from input", () => {
      expect(extractWebsiteDomain("  https://example.com  ")).toBe(
        "example.com",
      );
    });
  });

  describe("invalid inputs", () => {
    it("should return null for empty string", () => {
      expect(extractWebsiteDomain("")).toBe(null);
    });

    it("should return null for malformed URL", () => {
      expect(extractWebsiteDomain("not a url")).toBe(null);
      expect(extractWebsiteDomain("just text")).toBe(null);
    });

    it("should return null for URL without protocol", () => {
      expect(extractWebsiteDomain("example.com")).toBe(null);
      expect(extractWebsiteDomain("www.example.com")).toBe(null);
    });

    it("should return null for localhost (no dot)", () => {
      expect(extractWebsiteDomain("http://localhost")).toBe(null);
      expect(extractWebsiteDomain("http://localhost:3000")).toBe(null);
    });

    it("should return null for non-string input", () => {
      // @ts-expect-error Testing invalid input
      expect(extractWebsiteDomain(null)).toBe(null);
      // @ts-expect-error Testing invalid input
      expect(extractWebsiteDomain(undefined)).toBe(null);
    });

    it("should return null for whitespace-only input", () => {
      expect(extractWebsiteDomain("   ")).toBe(null);
    });
  });

  describe("edge cases", () => {
    it("should handle URLs with special characters in path", () => {
      expect(extractWebsiteDomain("https://example.com/path?q=test&x=1")).toBe(
        "example.com",
      );
    });

    it("should handle URLs with hash fragments", () => {
      expect(extractWebsiteDomain("https://example.com#section")).toBe(
        "example.com",
      );
    });

    it("should handle international domains", () => {
      expect(extractWebsiteDomain("https://example.co.uk")).toBe(
        "example.co.uk",
      );
      expect(extractWebsiteDomain("https://www.example.es")).toBe("example.es");
    });
  });
});

describe("pickCompanyWebsiteUrl", () => {
  describe("priority order", () => {
    it("should return corporateWebsiteUrl when present", () => {
      expect(
        pickCompanyWebsiteUrl({
          corporateWebsiteUrl: "https://corporate.com",
          websiteUrl: "https://website.com",
          web: "https://web.com",
        }),
      ).toBe("https://corporate.com");
    });

    it("should return websiteUrl when corporateWebsiteUrl is absent", () => {
      expect(
        pickCompanyWebsiteUrl({
          websiteUrl: "https://website.com",
          web: "https://web.com",
        }),
      ).toBe("https://website.com");
    });

    it("should return web when both corporateWebsiteUrl and websiteUrl are absent", () => {
      expect(
        pickCompanyWebsiteUrl({
          web: "https://web.com",
        }),
      ).toBe("https://web.com");
    });

    it("should return null when all fields are absent", () => {
      expect(pickCompanyWebsiteUrl({})).toBe(null);
    });
  });

  describe("empty/whitespace handling", () => {
    it("should skip empty string corporateWebsiteUrl and use websiteUrl", () => {
      expect(
        pickCompanyWebsiteUrl({
          corporateWebsiteUrl: "",
          websiteUrl: "https://website.com",
        }),
      ).toBe("https://website.com");
    });

    it("should skip whitespace-only corporateWebsiteUrl and use websiteUrl", () => {
      expect(
        pickCompanyWebsiteUrl({
          corporateWebsiteUrl: "   ",
          websiteUrl: "https://website.com",
        }),
      ).toBe("https://website.com");
    });

    it("should return null when all fields are empty strings", () => {
      expect(
        pickCompanyWebsiteUrl({
          corporateWebsiteUrl: "",
          websiteUrl: "",
          web: "",
        }),
      ).toBe(null);
    });

    it("should return null when all fields are whitespace-only", () => {
      expect(
        pickCompanyWebsiteUrl({
          corporateWebsiteUrl: "  ",
          websiteUrl: "\t",
          web: "\n",
        }),
      ).toBe(null);
    });

    it("should return null when all fields are undefined", () => {
      expect(
        pickCompanyWebsiteUrl({
          corporateWebsiteUrl: undefined,
          websiteUrl: undefined,
          web: undefined,
        }),
      ).toBe(null);
    });
  });

  describe("trimming", () => {
    it("should trim returned URL", () => {
      expect(
        pickCompanyWebsiteUrl({
          corporateWebsiteUrl: "  https://corporate.com  ",
        }),
      ).toBe("https://corporate.com");
    });

    it("should trim websiteUrl when returned", () => {
      expect(
        pickCompanyWebsiteUrl({
          websiteUrl: "  https://website.com  ",
        }),
      ).toBe("https://website.com");
    });

    it("should trim web when returned", () => {
      expect(
        pickCompanyWebsiteUrl({
          web: "  https://web.com  ",
        }),
      ).toBe("https://web.com");
    });
  });
});
