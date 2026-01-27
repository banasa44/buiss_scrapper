/**
 * E2E Proof Test: InfoJobs Client with Mocked HTTP
 *
 * Validates that InfoJobsClient can be instantiated with a mock HTTP layer
 * and returns canonical data shapes without making real network calls.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InfoJobsClient } from "@/clients/infojobs";
import { createMockHttp } from "../helpers/mockHttp";
import sampleSearchResponse from "../fixtures/infojobs/sample_search_response.json";

describe("E2E: InfoJobs Client (Offline)", () => {
  const mockHttp = createMockHttp();

  // Mock credentials for testing (not real credentials)
  const mockConfig = {
    httpRequest: mockHttp.request,
    credentials: {
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    },
  };

  beforeEach(() => {
    mockHttp.reset();
  });

  it("should search offers using mocked HTTP", async () => {
    // Arrange: Mock the InfoJobs search endpoint
    mockHttp.on(
      "GET",
      "https://api.infojobs.net/api/9/offer",
      sampleSearchResponse,
    );

    const client = new InfoJobsClient(mockConfig);

    // Act: Execute search (limit to 1 page)
    const result = await client.searchOffers({
      text: "desarrollador",
      maxPages: 1, // Only fetch first page to match fixture
    });

    // Assert: Verify canonical shape
    expect(result.meta.totalResults).toBe(23868); // from fixture
    expect(result.offers).toHaveLength(1);

    const offer = result.offers[0];
    expect(offer.ref.provider).toBe("infojobs");
    expect(offer.ref.id).toBe("0bb014b42f407ca6e988dc789f5a5a");
    expect(offer.title).toBe("Offer Test");
    expect(offer.company.normalizedName).toBe("improven consultores"); // normalized from fixture author
  });

  it("should throw on unmocked requests", async () => {
    // Arrange: Create client with NO mocked routes
    const client = new InfoJobsClient(mockConfig);

    // Act & Assert: The mock HTTP layer should throw on any unmocked call
    // Note: searchOffers catches errors gracefully and returns { offers: [], meta: {..., truncatedBy: "error" } }
    // So we verify that it completed with error truncation (which means the mock threw)
    const result = await client.searchOffers({ text: "test" });
    expect(result.offers).toHaveLength(0);
    expect(result.meta.truncatedBy).toBe("error");
  });

  it("should get offer detail using mocked HTTP", async () => {
    // Arrange: Mock the detail endpoint with minimal valid detail response
    const detailResponse = {
      id: "test-detail-id",
      title: "Backend Developer",
      description: "Full job description here",
      profile: {
        id: "company-123",
        name: "Test Company S.L.",
      },
      link: "https://www.infojobs.net/offer/test-detail-id",
      province: { id: 28, value: "Madrid" },
      city: "Madrid",
      contractType: { id: 1, value: "Indefinido" },
      journey: { id: 3, value: "Completa" },
      salaryMin: { value: 30000 },
      salaryMax: { value: 40000 },
      experienceMin: { id: 3, value: "3 años" },
      skillsList: [{ skill: "Python" }, { skill: "Django" }],
      studies: { id: 5, value: "Grado" },
      published: "2024-01-15T10:30:00.000Z",
      updateDate: "2024-01-16T14:20:00.000Z",
    };

    mockHttp.on(
      "GET",
      "https://api.infojobs.net/api/7/offer/test-detail-id",
      detailResponse,
    );

    const client = new InfoJobsClient(mockConfig);

    // Act: Get offer detail
    const detail = await client.getOfferById("test-detail-id");

    // Assert: Verify canonical shape
    expect(detail.ref.provider).toBe("infojobs");
    expect(detail.ref.id).toBe("test-detail-id");
    expect(detail.title).toBe("Backend Developer");
    expect(detail.company.normalizedName).toBe("test company"); // normalized (no S.L.)
    expect(detail.description).toBe("Full job description here");
  });
});
