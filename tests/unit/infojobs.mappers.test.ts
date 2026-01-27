/**
 * Unit tests for InfoJobs mappers
 *
 * Tests InfoJobs payload → canonical type mapping
 * No DB, no HTTP - pure transformation testing
 *
 * Uses official InfoJobs API sample response for realistic testing
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  mapInfoJobsOfferListItemToSummary,
  mapInfoJobsOfferDetailToDetail,
} from "@/clients/infojobs/mappers";
import type {
  InfoJobsOfferListItem,
  InfoJobsOfferDetail,
} from "@/types/clients/infojobs";

// Helper to load fixtures
function loadFixture<T>(filename: string): T {
  const fixturePath = join(__dirname, "../fixtures/infojobs", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content);
}

// Load official InfoJobs search response sample
const searchResponse = loadFixture<{ offers: InfoJobsOfferListItem[] }>(
  "sample_search_response.json",
);
const officialListItem = searchResponse.offers[0];

describe("mapInfoJobsOfferListItemToSummary", () => {
  describe("required field validation", () => {
    it("should return null when id is missing", () => {
      const raw = {} as InfoJobsOfferListItem;
      expect(mapInfoJobsOfferListItemToSummary(raw)).toBe(null);
    });

    it("should return valid summary for minimal offer with only id", () => {
      const raw: InfoJobsOfferListItem = { id: "minimal-id-only" };
      const result = mapInfoJobsOfferListItemToSummary(raw);

      expect(result).not.toBe(null);
      expect(result?.ref.id).toBe("minimal-id-only");
      expect(result?.ref.provider).toBe("infojobs");
    });
  });

  describe("official InfoJobs sample mapping", () => {
    it("should map official sample list item correctly", () => {
      const result = mapInfoJobsOfferListItemToSummary(officialListItem);

      expect(result).not.toBe(null);
      expect(result?.ref.id).toBe("0bb014b42f407ca6e988dc789f5a5a");
      expect(result?.ref.provider).toBe("infojobs");
      expect(result?.ref.url).toBe(
        "https://www.infojobs.net/galicia/offer-test/of-i0000000000000000000000000000",
      );
      expect(result?.title).toBe("Offer Test");
      expect(result?.publishedAt).toBe("2012-09-21T10:26:23.000+0000");
      expect(result?.updatedAt).toBe("2012-09-21T10:26:23.000+0000");
    });

    it("should normalize company name from official sample", () => {
      const result = mapInfoJobsOfferListItemToSummary(officialListItem);

      expect(result?.company.id).toBe("967153524526202350563215654828");
      expect(result?.company.name).toBe("Improven Consultores");
      expect(result?.company.nameRaw).toBe("Improven Consultores");
      expect(result?.company.normalizedName).toBe("improven consultores");
    });

    it("should not include website fields in list item (not available)", () => {
      const result = mapInfoJobsOfferListItemToSummary(officialListItem);

      expect(result?.company.websiteUrl).toBeUndefined();
      expect(result?.company.websiteDomain).toBeUndefined();
    });
  });

  describe("metadata mapping", () => {
    it("should map category and contract type from official sample", () => {
      const result = mapInfoJobsOfferListItemToSummary(officialListItem);

      expect(result?.metadata).toBeDefined();
      expect(result?.metadata?.category).toEqual({
        id: 10,
        value: "Administración de empresas",
        key: undefined,
      });
      expect(result?.metadata?.contractType).toEqual({
        id: 1,
        value: "Indefinido",
        key: undefined,
      });
      expect(result?.metadata?.experienceMin).toEqual({
        id: 5,
        value: "Más de 5 años",
        key: undefined,
      });
    });

    it("should handle empty salary values gracefully", () => {
      const result = mapInfoJobsOfferListItemToSummary(officialListItem);

      // Official sample has salary fields with id: 0 and empty value
      // Mapper should still create salary object if fields present
      expect(result?.metadata?.salary).toBeDefined();
    });

    it("should set metadata to undefined when all fields are missing", () => {
      const raw: InfoJobsOfferListItem = { id: "no-metadata" };
      const result = mapInfoJobsOfferListItemToSummary(raw);

      expect(result?.metadata).toBeUndefined();
    });
  });

  describe("location mapping", () => {
    it("should map location from official sample", () => {
      const result = mapInfoJobsOfferListItemToSummary(officialListItem);

      expect(result?.location).toBeDefined();
      expect(result?.location?.city).toBe("Galicia");
      expect(result?.location?.province).toEqual({
        id: 40,
        value: "Pontevedra",
        key: undefined,
      });
    });

    it("should set location to undefined when missing", () => {
      const raw: InfoJobsOfferListItem = { id: "no-location" };
      const result = mapInfoJobsOfferListItemToSummary(raw);

      expect(result?.location).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle missing author gracefully", () => {
      const raw: InfoJobsOfferListItem = { id: "no-author" };
      const result = mapInfoJobsOfferListItemToSummary(raw);

      expect(result).not.toBe(null);
      expect(result?.company.id).toBeUndefined();
      expect(result?.company.name).toBeUndefined();
      expect(result?.company.normalizedName).toBeUndefined();
    });

    it("should handle null author without crashing", () => {
      const raw: InfoJobsOfferListItem = {
        id: "null-author",
        author: null as any,
      };
      const result = mapInfoJobsOfferListItemToSummary(raw);

      expect(result).not.toBe(null);
      expect(result?.company.id).toBeUndefined();
    });

    it("should default title to empty string when missing", () => {
      const raw: InfoJobsOfferListItem = { id: "no-title" };
      const result = mapInfoJobsOfferListItemToSummary(raw);

      expect(result?.title).toBe("");
    });

    it("should handle empty strings vs undefined", () => {
      const raw: InfoJobsOfferListItem = {
        id: "empty-strings",
        title: "",
        link: "",
      };
      const result = mapInfoJobsOfferListItemToSummary(raw);

      expect(result).not.toBe(null);
      expect(result?.title).toBe("");
      expect(result?.ref.url).toBe("");
    });
  });
});

describe("mapInfoJobsOfferDetailToDetail", () => {
  describe("required field validation", () => {
    it("should return null when id is missing", () => {
      const raw = {} as InfoJobsOfferDetail;
      expect(mapInfoJobsOfferDetailToDetail(raw)).toBe(null);
    });

    it("should return valid detail for minimal offer with only id", () => {
      const raw: InfoJobsOfferDetail = { id: "minimal-detail-id" };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result).not.toBe(null);
      expect(result?.ref.id).toBe("minimal-detail-id");
      expect(result?.ref.provider).toBe("infojobs");
    });
  });

  describe("field mapping with realistic detail payload", () => {
    it("should map detail-specific fields correctly", () => {
      const raw: InfoJobsOfferDetail = {
        id: "detail-123",
        title: "Full Stack Engineer",
        link: "https://www.infojobs.net/offer/detail-123",
        published: "2026-01-10T09:00:00Z",
        updateDate: "2026-01-25T16:45:00Z",
        creationDate: "2026-01-10T08:30:00Z",
        description: "We are looking for a talented engineer.",
        minRequirements: "Bachelor's degree, 3+ years experience",
        desiredRequirements: "AWS experience, Docker",
        applications: 42,
        profile: {
          id: "prof-123",
          name: "Tech Solutions España",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result).not.toBe(null);
      expect(result?.ref.id).toBe("detail-123");
      expect(result?.title).toBe("Full Stack Engineer");
      expect(result?.publishedAt).toBe("2026-01-10T09:00:00Z");
      expect(result?.updatedAt).toBe("2026-01-25T16:45:00Z");
      expect(result?.createdAt).toBe("2026-01-10T08:30:00Z");
      expect(result?.description).toBe(
        "We are looking for a talented engineer.",
      );
      expect(result?.minRequirements).toBe(
        "Bachelor's degree, 3+ years experience",
      );
      expect(result?.desiredRequirements).toBe("AWS experience, Docker");
      expect(result?.applicationsCount).toBe(42);
    });

    it("should use journey field for workDay metadata", () => {
      const raw: InfoJobsOfferDetail = {
        id: "journey-test",
        journey: {
          id: "journey-part",
          value: "Part time",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result?.metadata?.workDay).toEqual({
        id: "journey-part",
        value: "Part time",
        key: undefined,
      });
    });

    it("should handle missing profile gracefully", () => {
      const raw: InfoJobsOfferDetail = { id: "no-profile" };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result).not.toBe(null);
      expect(result?.company.id).toBeUndefined();
      expect(result?.company.name).toBeUndefined();
      expect(result?.company.websiteUrl).toBeUndefined();
      expect(result?.company.websiteDomain).toBeUndefined();
    });
  });

  describe("company website extraction", () => {
    it("should extract website URL and domain from profile", () => {
      const raw: InfoJobsOfferDetail = {
        id: "website-test",
        profile: {
          id: "prof-789",
          name: "Tech Solutions",
          corporateWebsiteUrl: "https://www.techsolutions.com",
          websiteUrl: "https://www.infojobs.net/company/tech-solutions",
          web: "https://old-site.com",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      // corporateWebsiteUrl has priority
      expect(result?.company.websiteUrl).toBe("https://www.techsolutions.com");
      expect(result?.company.websiteDomain).toBe("techsolutions.com");
    });

    it("should normalize company name from profile", () => {
      const raw: InfoJobsOfferDetail = {
        id: "normalize-test",
        profile: {
          id: "prof-esp",
          name: "Tech Solutions España",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result?.company.name).toBe("Tech Solutions España");
      expect(result?.company.normalizedName).toBe("tech solutions espana");
    });

    it("should filter out InfoJobs internal domains", () => {
      const raw: InfoJobsOfferDetail = {
        id: "infojobs-domain-test",
        profile: {
          id: "prof-infojobs",
          name: "InfoJobs Test Company",
          corporateWebsiteUrl: "https://company.infojobs.net/profile",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result?.company.websiteUrl).toBe(
        "https://company.infojobs.net/profile",
      );
      // Domain should be undefined because it contains "infojobs."
      expect(result?.company.websiteDomain).toBeUndefined();
    });

    it("should handle profile with all three URL fields using priority", () => {
      const raw: InfoJobsOfferDetail = {
        id: "priority-test",
        profile: {
          id: "prof-priority",
          name: "Priority Test",
          corporateWebsiteUrl: "https://www.corporate.com",
          websiteUrl: "https://www.website.com",
          web: "https://www.web.com",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      // corporateWebsiteUrl should win
      expect(result?.company.websiteUrl).toBe("https://www.corporate.com");
      expect(result?.company.websiteDomain).toBe("corporate.com");
    });

    it("should handle malformed URLs gracefully", () => {
      const raw: InfoJobsOfferDetail = {
        id: "malformed-url",
        profile: {
          id: "prof-malformed",
          name: "Malformed URL Company",
          corporateWebsiteUrl: "not a valid url",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result).not.toBe(null);
      expect(result?.company.websiteUrl).toBe("not a valid url");
      // Domain extraction should fail gracefully
      expect(result?.company.websiteDomain).toBeUndefined();
    });
  });

  describe("metadata mapping", () => {
    it("should map metadata from detail payload", () => {
      const raw: InfoJobsOfferDetail = {
        id: "metadata-test",
        category: {
          id: "cat-tech",
          value: "Technology",
        },
        contractType: {
          id: "contract-temp",
          value: "Temporary",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result?.metadata).toBeDefined();
      expect(result?.metadata?.category?.value).toBe("Technology");
      expect(result?.metadata?.contractType?.value).toBe("Temporary");
    });

    it("should map salary with minPay/maxPay from detail endpoint", () => {
      const raw: InfoJobsOfferDetail = {
        id: "salary-test",
        minPay: {
          id: "pay-40k",
          value: "40000",
        },
        maxPay: {
          id: "pay-60k",
          value: "60000",
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result?.metadata?.salary?.min).toEqual({
        id: "pay-40k",
        value: "40000",
        key: undefined,
      });
      expect(result?.metadata?.salary?.max).toEqual({
        id: "pay-60k",
        value: "60000",
        key: undefined,
      });
    });
  });

  describe("edge cases", () => {
    it("should handle null profile without crashing", () => {
      const raw: InfoJobsOfferDetail = {
        id: "null-profile",
        profile: null as any,
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result).not.toBe(null);
      expect(result?.company.id).toBeUndefined();
    });

    it("should handle hidden company flag", () => {
      const raw: InfoJobsOfferDetail = {
        id: "hidden-test",
        profile: {
          id: "prof-hidden",
          name: "Hidden Company",
          hidden: false,
        },
      };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result?.company.hidden).toBe(false);
    });

    it("should handle missing optional detail fields", () => {
      const raw: InfoJobsOfferDetail = { id: "minimal-fields" };
      const result = mapInfoJobsOfferDetailToDetail(raw);

      expect(result?.description).toBeUndefined();
      expect(result?.minRequirements).toBeUndefined();
      expect(result?.desiredRequirements).toBeUndefined();
      expect(result?.applicationsCount).toBeUndefined();
    });
  });
});
