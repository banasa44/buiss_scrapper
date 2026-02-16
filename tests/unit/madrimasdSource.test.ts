import { describe, expect, it } from "vitest";
import { DIRECTORY_DISCOVERY } from "@/constants";
import {
  canonicalizeMadrimasdCompanyDetailUrl,
  extractMadrimasdCompanyEntries,
  isMadrimasdCompanyDetailUrl,
} from "@/companySources/madrimasd/madrimasdSource";

describe("Madrimasd source URL filtering", () => {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD;

  it("accepts only canonical Madrimasd company detail URLs", () => {
    expect(
      isMadrimasdCompanyDetailUrl(
        "/emprendedores/emprendedores-casos-exito/frikiring",
      ),
    ).toBe(true);
    expect(
      isMadrimasdCompanyDetailUrl(
        "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/medical-flowers/",
      ),
    ).toBe(true);
    expect(
      isMadrimasdCompanyDetailUrl(
        "/emprendedores/emprendedores-casos-exito/cloud-rocket?utm_source=list#top",
      ),
    ).toBe(true);

    expect(
      isMadrimasdCompanyDetailUrl(
        "/emprendedores/emprendedores-casos-exito/",
      ),
    ).toBe(false);
    expect(
      isMadrimasdCompanyDetailUrl(
        "/emprendedores/emprendedores-casos-exito/frikiring/extra",
      ),
    ).toBe(false);
    expect(
      isMadrimasdCompanyDetailUrl(
        "https://example.com/emprendedores/emprendedores-casos-exito/frikiring",
      ),
    ).toBe(false);
    expect(
      isMadrimasdCompanyDetailUrl(
        "/emprendedores/empresa/detalle/40100-frikiring/",
      ),
    ).toBe(false);
  });

  it("rejects contact/legal/newsletter/share links", () => {
    expect(isMadrimasdCompanyDetailUrl("/contacto")).toBe(false);
    expect(isMadrimasdCompanyDetailUrl("/aviso-legal")).toBe(false);
    expect(isMadrimasdCompanyDetailUrl("/newsletter")).toBe(false);
    expect(
      isMadrimasdCompanyDetailUrl("https://www.whatsapp.com/share?text=test"),
    ).toBe(false);
  });

  it("extracts company name from card title and canonicalizes detail URL", () => {
    const listingHtml = `
      <li class="element-list">
        <h3>Frikiring</h3>
        <a href="/emprendedores/emprendedores-casos-exito/frikiring/?utm_source=list#top">Open profile</a>
      </li>
      <li class="element-list">
        <h3>Medical Flowers Developments</h3>
        <a href="/emprendedores/emprendedores-casos-exito/medical-flowers-developments/">Read more</a>
      </li>
      <li class="element-list">
        <h3>Contact</h3>
        <a href="/contacto">Contact</a>
      </li>
    `;

    const entries = extractMadrimasdCompanyEntries(listingHtml, seedUrl);

    expect(entries).toEqual([
      {
        nameRaw: "Frikiring",
        detailUrl:
          "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/frikiring",
      },
      {
        nameRaw: "Medical Flowers Developments",
        detailUrl:
          "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/medical-flowers-developments",
      },
    ]);

    expect(
      canonicalizeMadrimasdCompanyDetailUrl(
        "/emprendedores/emprendedores-casos-exito/frikiring/?utm_source=list#top",
      ),
    ).toBe(
      "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/frikiring",
    );
  });
});
