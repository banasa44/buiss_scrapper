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

  it("cataloniaDirectorySource.fetchCompanies keeps only canonical startup entries with startup names", async () => {
    const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA;
    const listingHtml = `
      <nav>
        <a href="/legal-notice">Legal notice</a>
        <a href="/contact">Contact</a>
        <a href="https://www.whatsapp.com/share?text=hello">Share on WhatsApp</a>
      </nav>
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">ABACUM PLANNING S.L.</h3>
          <a class="link_all" href="/startup/barcelona/abacum-planning/4470/?utm_source=list#top">
            <span class="sr-only">ABACUM PLANNING S.L.</span>
          </a>
        </div>
      </li>
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">NORA REAL TIME</h3>
          <a class="link_all" href="https://startupshub.catalonia.com/startup/girona/nora-real-time/8891">
            <span class="sr-only">NORA REAL TIME</span>
          </a>
        </div>
      </li>
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">QUANTION LABS</h3>
          <a class="link_all" href="/startup/tarragona/quantion-labs/9012/">
            <span class="sr-only">QUANTION LABS</span>
          </a>
        </div>
      </li>
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">Contact</h3>
          <a class="link_all" href="/startup/barcelona/contact/abc">
            <span class="sr-only">Contact</span>
          </a>
        </div>
      </li>
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">Newsletter</h3>
          <a class="link_all" href="/newsletter/barcelona/newsletter/1234">
            <span class="sr-only">Newsletter</span>
          </a>
        </div>
      </li>
    `;

    const abacumDetailUrl =
      "https://startupshub.catalonia.com/startup/barcelona/abacum-planning/4470";
    const noraDetailUrl =
      "https://startupshub.catalonia.com/startup/girona/nora-real-time/8891";
    const quantionDetailUrl =
      "https://startupshub.catalonia.com/startup/tarragona/quantion-labs/9012";

    const abacumDetailHtml = [
      '<a href="/contact">Contact</a>',
      '<a href="https://www.whatsapp.com/share?url=https://abacum.com">Share on WhatsApp</a>',
      '<a href="https://www.abacum.com/?utm_source=catalonia#top">Visit website</a>',
      '<a href="https://www.linkedin.com/company/abacum">LinkedIn</a>',
    ].join("\n");
    const noraDetailHtml = [
      '<a href="/legal-notice">Legal notice</a>',
      '<a href="https://noraai.com/">Official website</a>',
      '<a href="https://dealroom.co/companies/nora">Dealroom</a>',
    ].join("\n");
    const quantionDetailHtml = [
      '<a href="/newsletter">Newsletter</a>',
      '<a href="https://www.quantion.io">Quantion website</a>',
    ].join("\n");

    mockHttp.on("GET", seedUrl, listingHtml);
    mockHttp.on("GET", abacumDetailUrl, abacumDetailHtml);
    mockHttp.on("GET", noraDetailUrl, noraDetailHtml);
    mockHttp.on("GET", quantionDetailUrl, quantionDetailHtml);

    const companies = await cataloniaDirectorySource.fetchCompanies();

    expect(companies).toHaveLength(3);
    expect(companies.length).toBeLessThanOrEqual(MAX_COMPANIES_PER_SOURCE);

    expect(companies.map((company) => company.name_raw)).toEqual([
      "ABACUM PLANNING S.L.",
      "NORA REAL TIME",
      "QUANTION LABS",
    ]);

    expect(companies.map((company) => company.website_domain)).toEqual([
      "abacum.com",
      "noraai.com",
      "quantion.io",
    ]);

    const rejectedLabels = new Set([
      "Contact",
      "Legal notice",
      "Newsletter",
      "Share on WhatsApp",
    ]);
    for (const company of companies) {
      expect(rejectedLabels.has(company.name_raw ?? "")).toBe(false);
    }

    assertCompanyInvariants(companies);
  });

  it("madrimasdDirectorySource.fetchCompanies keeps only canonical company entries with company-card names", async () => {
    const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD;
    const detailUrl1 =
      "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/frikiring";
    const detailUrl2 =
      "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/medical-flowers-developments-sl";
    const detailUrl3 =
      "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/cloud-rocket";

    const listingHtml = [
      loadFixtureText("directories/madrimasd_list.html"),
      '<a href="/contacto">Contact</a>',
      '<a href="/aviso-legal">Legal notice</a>',
      '<a href="/newsletter">Newsletter</a>',
      '<a href="https://www.whatsapp.com/share?text=startups">Share on WhatsApp</a>',
      '<a href="https://www.linkedin.com/company/madrimasd">LinkedIn</a>',
      [
        '<li class="element-list">',
        "  <h3>Cloud Rocket</h3>",
        '  <a href="/emprendedores/emprendedores-casos-exito/cloud-rocket/?utm_source=directory#top">Open profile</a>',
        "</li>",
      ].join("\n"),
      [
        '<li class="element-list">',
        "  <h3>Contact</h3>",
        '  <a href="/emprendedores/emprendedores-casos-exito/">Open profile</a>',
        "</li>",
      ].join("\n"),
      [
        '<li class="element-list">',
        "  <h3>Share on WhatsApp</h3>",
        '  <a href="/emprendedores/emprendedores-casos-exito/share-on-whatsapp/extra">Open profile</a>',
        "</li>",
      ].join("\n"),
    ].join("\n");
    const detailHtml1 = [
      '<a href="/contacto">Contact</a>',
      '<a href="https://www.whatsapp.com/share?url=https://frikiring.com">Share on WhatsApp</a>',
      '<a href="https://www.frikiring.com/?utm_campaign=directory">Sitio oficial</a>',
      '<a href="https://linkedin.com/company/frikiring">LinkedIn</a>',
    ].join("\n");
    const detailHtml2 = [
      '<a href="/aviso-legal">Legal notice</a>',
      '<a href="https://dealroom.co/companies/medical-flowers">Dealroom</a>',
      '<a href="https://medicalflowers.es/">Website</a>',
      '<a href="/contacto">Contact</a>',
    ].join("\n");
    const detailHtml3 = [
      '<a href="/newsletter">Newsletter</a>',
      '<a href="https://cloudrocket.io">Website</a>',
    ].join("\n");

    mockHttp.on("GET", seedUrl, listingHtml);
    mockHttp.on("GET", detailUrl1, detailHtml1);
    mockHttp.on("GET", detailUrl2, detailHtml2);
    mockHttp.on("GET", detailUrl3, detailHtml3);

    const companies = await madrimasdDirectorySource.fetchCompanies();

    expect(companies).toHaveLength(3);
    expect(companies.length).toBeLessThanOrEqual(MAX_COMPANIES_PER_SOURCE);

    expect(companies.map((company) => company.name_raw)).toEqual([
      "Frikiring",
      "MEDICAL FLOWERS DEVELOPMENTS S.L.",
      "Cloud Rocket",
    ]);

    expect(companies.map((company) => company.website_domain)).toEqual([
      "frikiring.com",
      "medicalflowers.es",
      "cloudrocket.io",
    ]);

    const rejectedLabels = new Set([
      "Contact",
      "Legal notice",
      "Newsletter",
      "Share on WhatsApp",
    ]);
    for (const company of companies) {
      expect(rejectedLabels.has(company.name_raw ?? "")).toBe(false);
    }

    assertCompanyInvariants(companies);
  });

  it("lanzaderaDirectorySource.fetchCompanies keeps only canonical project entries with project-card names", async () => {
    const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA;
    const detailUrl1 = "https://lanzadera.es/proyecto/gana-energia";
    const detailUrl2 = "https://lanzadera.es/proyecto/growpro-experience";

    const listingHtml = [
      '<a href="/contacto">Contact</a>',
      '<a href="/aviso-legal">Legal notice</a>',
      '<a href="/newsletter">Newsletter</a>',
      '<a href="https://www.whatsapp.com/share?text=lanzadera">Share on WhatsApp</a>',
      '<a href="https://www.linkedin.com/company/lanzadera">LinkedIn</a>',
      [
        '<article class="startup-slide elementor-carousel-image">',
        '  <h3 class="startup-slide__title">Gana Energía</h3>',
        '  <a href="/proyecto/gana-energia/?utm_source=directory#top" class="startup-slide__link">ver perfil startup</a>',
        "</article>",
      ].join("\n"),
      [
        '<article class="startup-slide elementor-carousel-image">',
        "  <h3>GrowPro Experience</h3>",
        '  <a href="https://lanzadera.es/proyecto/growpro-experience/" class="startup-slide__link">ver perfil startup</a>',
        "</article>",
      ].join("\n"),
      [
        '<article class="startup-slide elementor-carousel-image">',
        "  <h3>Newsletter</h3>",
        '  <a href="/proyectos/" class="startup-slide__link">ver perfil startup</a>',
        "</article>",
      ].join("\n"),
      [
        '<article class="startup-slide elementor-carousel-image">',
        "  <h3>Share on WhatsApp</h3>",
        '  <a href="/proyecto/share-on-whatsapp/extra" class="startup-slide__link">ver perfil startup</a>',
        "</article>",
      ].join("\n"),
      [
        '<article class="startup-slide elementor-carousel-image">',
        "  <h3>Contact</h3>",
        '  <a href="/contacto" class="startup-slide__link">ver perfil startup</a>',
        "</article>",
      ].join("\n"),
    ].join("\n");

    const detailHtml1 = [
      '<a href="/contacto">Contact</a>',
      '<a href="https://www.whatsapp.com/share?text=gana">Share on WhatsApp</a>',
      '<a href="https://www.ganaenergia.com/?utm_campaign=lanzadera#top">Sitio oficial</a>',
      '<a href="https://www.linkedin.com/company/ganaenergia">LinkedIn</a>',
    ].join("\n");

    const detailHtml2 = [
      '<a href="/newsletter">Newsletter</a>',
      '<a href="https://crunchbase.com/organization/growpro">Crunchbase</a>',
      '<a href="https://growproexperience.com/?utm_medium=directory">Sitio oficial</a>',
    ].join("\n");

    mockHttp.on("GET", seedUrl, listingHtml);
    mockHttp.on("GET", detailUrl1, detailHtml1);
    mockHttp.on("GET", detailUrl2, detailHtml2);

    const companies = await lanzaderaDirectorySource.fetchCompanies();

    expect(companies).toHaveLength(2);
    expect(companies.length).toBeLessThanOrEqual(MAX_COMPANIES_PER_SOURCE);

    expect(companies.map((company) => company.name_raw)).toEqual([
      "Gana Energía",
      "GrowPro Experience",
    ]);

    expect(companies.map((company) => company.website_domain)).toEqual([
      "ganaenergia.com",
      "growproexperience.com",
    ]);

    const rejectedLabels = new Set([
      "Contact",
      "Legal notice",
      "Newsletter",
      "Share on WhatsApp",
    ]);
    for (const company of companies) {
      expect(rejectedLabels.has(company.name_raw ?? "")).toBe(false);
    }

    assertCompanyInvariants(companies);
  });
});
