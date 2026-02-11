import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpRequest, CompanyInput } from "@/types";
import { DIRECTORY_DISCOVERY } from "@/constants";
import { httpRequest } from "@/clients/http";
import { cataloniaDirectorySource } from "@/companySources/catalonia/cataloniaSource";
import { madrimasdDirectorySource } from "@/companySources/madrimasd/madrimasdSource";
import { lanzaderaDirectorySource } from "@/companySources/lanzadera/lanzaderaSource";
import { createMockHttp, loadFixtureText } from "../../helpers/mockHttpClient";

vi.mock("@/clients/http", () => ({
  httpRequest: vi.fn(),
}));

const mockHttp = createMockHttp();
const mockedHttpRequest = vi.mocked(httpRequest);

function assertCompanyInvariants(companies: CompanyInput[]): void {
  const excludedDomains = new Set<string>(
    DIRECTORY_DISCOVERY.TUNABLES.EXCLUDED_DOMAINS as readonly string[],
  );

  for (const company of companies) {
    const hasIdentity =
      Boolean(company.website_domain) || Boolean(company.normalized_name);
    expect(hasIdentity).toBe(true);

    if (company.website_domain) {
      expect(company.website_domain).toBe(company.website_domain.toLowerCase());
      expect(company.website_domain.startsWith("www.")).toBe(false);
      expect(excludedDomains.has(company.website_domain)).toBe(false);
    }
  }
}

describe("Integration: directory sources parsing (offline, mocked HTTP)", () => {
  const { MAX_COMPANIES_PER_SOURCE } = DIRECTORY_DISCOVERY.TUNABLES;

  beforeEach(() => {
    mockHttp.reset();
    mockedHttpRequest.mockReset();
    mockedHttpRequest.mockImplementation((req: HttpRequest) =>
      mockHttp.request(req),
    );
  });

  it("cataloniaDirectorySource.fetchCompanies parses deterministic fixture HTML", async () => {
    const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA;
    const listingHtml = [
      loadFixtureText("directories/catalonia.html"),
      // Add one deterministic external website link candidate so this fixture
      // exercises the current single-page extraction flow end-to-end.
      '<a href="https://www.abacum.com/?utm_source=catalonia">ABACUM PLANNING S.L.</a>',
      '<a href="https://www.linkedin.com/company/abacum">ABACUM on LinkedIn</a>',
    ].join("\n");

    mockHttp.on("GET", seedUrl, listingHtml);

    const companies = await cataloniaDirectorySource.fetchCompanies();

    expect(companies.length).toBeGreaterThan(0);
    expect(companies.length).toBeLessThanOrEqual(MAX_COMPANIES_PER_SOURCE);
    assertCompanyInvariants(companies);
  });

  it("madrimasdDirectorySource.fetchCompanies parses listing + detail pages offline", async () => {
    const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD;
    const detailUrl1 =
      "https://startups.madrimasd.org/emprendedores/empresa/detalle/40100-frikiring/";
    const detailUrl2 =
      "https://startups.madrimasd.org/emprendedores/empresa/detalle/40099-medical-flowers-developments-sl/";

    const listingHtml = [
      loadFixtureText("directories/madrimasd_list.html"),
      // Keep fixture input, plus single-line equivalents that match the
      // current deterministic anchor regex used by source parsers.
      '<a href="/emprendedores/empresa/detalle/40100-frikiring/">Frikiring</a>',
      '<a href="/emprendedores/empresa/detalle/40099-medical-flowers-developments-sl/">MEDICAL FLOWERS DEVELOPMENTS S.L.</a>',
    ].join("\n");
    const detailHtml1 = [
      '<a href="https://www.frikiring.com/?utm_campaign=directory">Sitio oficial</a>',
      '<a href="https://linkedin.com/company/frikiring">LinkedIn</a>',
    ].join("\n");
    const detailHtml2 = [
      '<a href="https://medicalflowers.es/">Website</a>',
      '<a href="/contacto">Contacto</a>',
    ].join("\n");

    mockHttp.on("GET", seedUrl, listingHtml);
    mockHttp.on("GET", detailUrl1, detailHtml1);
    mockHttp.on("GET", detailUrl2, detailHtml2);

    const companies = await madrimasdDirectorySource.fetchCompanies();

    expect(companies.length).toBeGreaterThan(0);
    expect(companies.length).toBeLessThanOrEqual(MAX_COMPANIES_PER_SOURCE);
    assertCompanyInvariants(companies);
  });

  it("lanzaderaDirectorySource.fetchCompanies parses fixture HTML offline", async () => {
    const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA;
    const listingHtml = [
      loadFixtureText("directories/lanzadera_list.html"),
      // Inject deterministic external links so source selects Option A
      // (single-page extraction) with the existing parser.
      '<a href="https://www.ganaenergia.com/">Gana Energia</a>',
      '<a href="https://growproexperience.com/?utm_medium=directory">GrowPro Experience</a>',
      '<a href="https://www.linkedin.com/company/growpro-experience">GrowPro LinkedIn</a>',
    ].join("\n");

    mockHttp.on("GET", seedUrl, listingHtml);

    const companies = await lanzaderaDirectorySource.fetchCompanies();

    expect(companies.length).toBeGreaterThan(0);
    expect(companies.length).toBeLessThanOrEqual(MAX_COMPANIES_PER_SOURCE);
    assertCompanyInvariants(companies);
  });
});
