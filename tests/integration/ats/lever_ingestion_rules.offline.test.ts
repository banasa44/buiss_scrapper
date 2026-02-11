import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLeverPipeline } from "@/ingestion/pipelines/lever";
import { httpRequest } from "@/clients/http";
import { getOfferByProviderId, upsertCompany, upsertCompanySource } from "@/db";
import type { HttpRequest } from "@/types";
import type { LeverPosting } from "@/types/clients/lever";
import { createTestDb, type TestDbHarness } from "../../helpers/testDb";
import { createMockHttp, loadFixtureText } from "../../helpers/mockHttpClient";

vi.mock("@/clients/http", async () => {
  const actual = await vi.importActual<typeof import("@/clients/http")>(
    "@/clients/http",
  );
  return {
    ...actual,
    httpRequest: vi.fn(),
  };
});

describe("Integration: Lever ingestion rules (offline)", () => {
  let dbHarness: TestDbHarness;
  const mockHttp = createMockHttp();
  const mockedHttpRequest = vi.mocked(httpRequest);

  beforeEach(async () => {
    dbHarness = await createTestDb();
    mockHttp.reset();
    mockedHttpRequest.mockReset();
    mockedHttpRequest.mockImplementation((req: HttpRequest) =>
      mockHttp.request(req),
    );
  });

  afterEach(() => {
    dbHarness.cleanup();
  });

  it("persists only valid offers and skips missing-description + repost duplicate", async () => {
    const leverListFixture = JSON.parse(
      loadFixtureText("ats/lever/list.json"),
    ) as LeverPosting[];
    const missingDescriptionFixture = JSON.parse(
      loadFixtureText("ats/synthetic/lever_detail_missing_description.json"),
    ) as LeverPosting;
    const repostDuplicateFixture = JSON.parse(
      loadFixtureText("ats/synthetic/lever_detail_repost_duplicate.json"),
    ) as LeverPosting;

    const validPosting = leverListFixture[0];

    // buildDescription() in the Lever mapper also uses lists/additional fields.
    // Clear all description contributors to guarantee missing-description behavior.
    const missingDescriptionPosting: LeverPosting = {
      ...missingDescriptionFixture,
      description: "",
      descriptionPlain: "",
      additional: "",
      additionalPlain: "",
      lists: [],
    };

    const postingsResponse: LeverPosting[] = [
      validPosting,
      missingDescriptionPosting,
      repostDuplicateFixture,
    ];

    const companyId = upsertCompany({
      name_raw: "Rackspace",
      name_display: "Rackspace",
      normalized_name: "rackspace",
      website_url: "https://www.rackspace.com",
      website_domain: "rackspace.com",
    });

    upsertCompanySource({
      company_id: companyId,
      provider: "lever",
      provider_company_id: "rackspace",
      provider_company_url: "https://jobs.lever.co/rackspace",
      hidden: 0,
    });

    mockHttp.on(
      "GET",
      "https://api.lever.co/v0/postings/rackspace",
      postingsResponse,
    );

    const result = await runLeverPipeline({ limit: 1 });

    const persistedValid = getOfferByProviderId("lever", validPosting.id);
    const skippedMissing = getOfferByProviderId(
      "lever",
      missingDescriptionPosting.id,
    );
    const skippedRepost = getOfferByProviderId("lever", repostDuplicateFixture.id);

    expect(result.result.upserted).toBe(1);
    expect(result.result.skipped).toBe(1);
    expect(result.result.failed).toBe(0);

    expect(result.counters.offers_upserted).toBe(1);
    expect(result.counters.offers_skipped_missing_description).toBe(1);
    expect(result.counters.offers_skipped_repost_duplicate).toBe(1);
    expect(result.counters.offers_duplicates).toBe(1);

    expect(persistedValid).toBeDefined();
    expect(persistedValid?.company_id).toBe(companyId);
    expect(persistedValid?.repost_count).toBe(1);

    expect(skippedMissing).toBeUndefined();
    expect(skippedRepost).toBeUndefined();
  });
});
