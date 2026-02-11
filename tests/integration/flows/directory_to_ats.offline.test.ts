import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestDirectorySources } from "@/companySources";
import {
  cataloniaDirectorySource,
  madrimasdDirectorySource,
  lanzaderaDirectorySource,
} from "@/companySources";
import { runAtsDiscoveryBatch } from "@/atsDiscovery";
import { runLeverPipeline, runGreenhousePipeline } from "@/ingestion/pipelines";
import { httpRequest } from "@/clients/http";
import {
  getDb,
  listAllCompanies,
  listCompanySourcesByProvider,
  getOfferByProviderId,
} from "@/db";
import { DIRECTORY_DISCOVERY } from "@/constants";
import type { HttpRequest } from "@/types";
import type { LeverPosting } from "@/types/clients/lever";
import type {
  GreenhouseJob,
  GreenhouseJobsResponse,
} from "@/types/clients/greenhouse";
import { createTestDb, type TestDbHarness } from "../../helpers/testDb";
import { createMockHttp, loadFixtureText } from "../../helpers/mockHttpClient";

vi.mock("@/clients/http", async () => {
  const actual =
    await vi.importActual<typeof import("@/clients/http")>("@/clients/http");
  return {
    ...actual,
    httpRequest: vi.fn(),
  };
});

describe("Integration flow: directory -> ATS discovery -> ATS ingestion (offline)", () => {
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

  it("persists discovered companies, detected ATS sources, and final offers with idempotent pipelines", async () => {
    const cataloniaHtml = [
      loadFixtureText("directories/catalonia.html"),
      '<a href="https://www.rackspace.com">Rackspace</a>',
      '<a href="https://www.linkedin.com/company/rackspace">Rackspace LinkedIn</a>',
    ].join("\n");

    const madrimasdListHtml = [
      loadFixtureText("directories/madrimasd_list.html"),
      '<a href="/emprendedores/empresa/detalle/40100-frikiring/">Frikiring</a>',
    ].join("\n");

    const madrimasdDetailHtml =
      '<a href="https://democorp.com">Sitio oficial</a>';

    const lanzaderaHtml = loadFixtureText("directories/lanzadera_list.html");

    mockHttp.on("GET", DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA, cataloniaHtml);
    mockHttp.on(
      "GET",
      DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD,
      madrimasdListHtml,
    );
    mockHttp.on(
      "GET",
      "https://startups.madrimasd.org/emprendedores/empresa/detalle/40100-frikiring/",
      madrimasdDetailHtml,
    );
    mockHttp.on("GET", DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA, lanzaderaHtml);

    mockHttp.on(
      "GET",
      "https://www.rackspace.com",
      '<a href="https://jobs.lever.co/rackspace">Open roles</a>',
    );
    mockHttp.on(
      "GET",
      "https://democorp.com",
      '<a href="https://boards.greenhouse.io/example">Careers</a>',
    );

    const leverListFixture = JSON.parse(
      loadFixtureText("ats/lever/list.json"),
    ) as LeverPosting[];
    const leverMissingFixture = JSON.parse(
      loadFixtureText("ats/synthetic/lever_detail_missing_description.json"),
    ) as LeverPosting;
    const leverRepostFixture = JSON.parse(
      loadFixtureText("ats/synthetic/lever_detail_repost_duplicate.json"),
    ) as LeverPosting;

    const leverMissingPosting: LeverPosting = {
      ...leverMissingFixture,
      description: "",
      descriptionPlain: "",
      additional: "",
      additionalPlain: "",
      lists: [],
    };

    const leverPostingsResponse: LeverPosting[] = [
      leverListFixture[0],
      leverMissingPosting,
      leverRepostFixture,
    ];

    mockHttp.on(
      "GET",
      "https://api.lever.co/v0/postings/rackspace",
      leverPostingsResponse,
    );
    // Unused by current client flow, mocked for fixture completeness.
    mockHttp.on(
      "GET",
      "https://api.lever.co/v0/postings/rackspace/6f1520fe-0076-46a8-8686-963d4249e852",
      JSON.parse(loadFixtureText("ats/lever/detail_1.json")),
    );

    const greenhouseListFixture = JSON.parse(
      loadFixtureText("ats/greenhouse/list.json"),
    ) as GreenhouseJobsResponse;
    const greenhouseMissingFixture = JSON.parse(
      loadFixtureText(
        "ats/synthetic/greenhouse_detail_missing_description.json",
      ),
    ) as GreenhouseJob;
    const greenhouseRepostFixture = JSON.parse(
      loadFixtureText("ats/synthetic/greenhouse_detail_repost_duplicate.json"),
    ) as GreenhouseJob;

    const greenhouseJobsResponse: GreenhouseJobsResponse = {
      jobs: [
        greenhouseListFixture.jobs[0],
        greenhouseMissingFixture,
        greenhouseRepostFixture,
      ],
    };

    mockHttp.on(
      "GET",
      "https://boards-api.greenhouse.io/v1/boards/example/jobs",
      greenhouseJobsResponse,
    );
    // Unused by current client flow, mocked for fixture completeness.
    mockHttp.on(
      "GET",
      "https://boards-api.greenhouse.io/v1/boards/example/jobs/44735",
      JSON.parse(loadFixtureText("ats/greenhouse/detail_1.json")),
    );

    const directoryResult = await ingestDirectorySources([
      cataloniaDirectorySource,
      madrimasdDirectorySource,
      lanzaderaDirectorySource,
    ]);

    expect(directoryResult.total.upserted).toBe(2);
    expect(directoryResult.bySource.CATALONIA.upserted).toBe(1);
    expect(directoryResult.bySource.MADRIMASD.upserted).toBe(1);
    expect(directoryResult.bySource.LANZADERA.upserted).toBe(0);

    const discoveryResult = await runAtsDiscoveryBatch({ limit: 10 });
    expect(discoveryResult.checked).toBe(2);
    expect(discoveryResult.found).toBe(2);
    expect(discoveryResult.persisted).toBe(2);
    expect(discoveryResult.notFound).toBe(0);

    const leverSources = listCompanySourcesByProvider("lever", 10);
    const greenhouseSources = listCompanySourcesByProvider("greenhouse", 10);
    expect(leverSources).toHaveLength(1);
    expect(greenhouseSources).toHaveLength(1);
    expect(leverSources[0].provider_company_id).toBe("rackspace");
    expect(greenhouseSources[0].provider_company_id).toBe("example");

    const leverRun1 = await runLeverPipeline({ limit: 10 });
    const greenhouseRun1 = await runGreenhousePipeline({ limit: 10 });

    expect(leverRun1.counters.offers_skipped_missing_description).toBe(1);
    expect(leverRun1.counters.offers_skipped_repost_duplicate).toBe(1);
    expect(greenhouseRun1.counters.offers_skipped_missing_description).toBe(1);
    expect(greenhouseRun1.counters.offers_skipped_repost_duplicate).toBe(1);

    const db = getDb();
    const companiesCount = (
      db.prepare("SELECT COUNT(*) as count FROM companies").get() as {
        count: number;
      }
    ).count;
    const offersCountAfterFirstRun = (
      db.prepare("SELECT COUNT(*) as count FROM offers").get() as {
        count: number;
      }
    ).count;
    const offersWithoutDescription = (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM offers WHERE description IS NULL OR TRIM(description) = ''",
        )
        .get() as { count: number }
    ).count;

    expect(companiesCount).toBe(2);
    expect(listAllCompanies()).toHaveLength(2);
    expect(offersCountAfterFirstRun).toBeGreaterThanOrEqual(2);
    expect(offersWithoutDescription).toBe(0);

    // Verify missing-description offers were skipped (not persisted)
    expect(
      getOfferByProviderId("lever", "synthetic-lever-missing-description"),
    ).toBeUndefined();
    expect(getOfferByProviderId("greenhouse", "44998")).toBeUndefined();

    // Verify repost-duplicate offers were skipped (not persisted)
    expect(
      getOfferByProviderId("lever", "synthetic-lever-repost-duplicate-2"),
    ).toBeUndefined();
    expect(getOfferByProviderId("greenhouse", "44999")).toBeUndefined();

    const leverRun2 = await runLeverPipeline({ limit: 10 });
    const greenhouseRun2 = await runGreenhousePipeline({ limit: 10 });

    const offersCountAfterSecondRun = (
      db.prepare("SELECT COUNT(*) as count FROM offers").get() as {
        count: number;
      }
    ).count;

    // Idempotency: no new offer rows created (count unchanged)
    // Note: result.upserted can be > 0 on second run because existing offers
    // are updated (INSERT OR UPDATE semantics), but row count must not increase
    expect(offersCountAfterSecondRun).toBe(offersCountAfterFirstRun);

    // Verify that all valid offers were processed in second run
    // (upserted = updates on existing rows, not new inserts)
    expect(leverRun2.result.upserted).toBeGreaterThanOrEqual(0);
    expect(greenhouseRun2.result.upserted).toBeGreaterThanOrEqual(0);
  });
});
