import { describe, expect, it } from "vitest";
import { DIRECTORY_DISCOVERY } from "@/constants";
import {
  canonicalizeLanzaderaProjectDetailUrl,
  extractLanzaderaProjectEntries,
  isLanzaderaProjectDetailUrl,
} from "@/companySources/lanzadera/lanzaderaSource";

describe("Lanzadera source URL filtering", () => {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.LANZADERA;

  it("accepts only canonical Lanzadera project detail URLs", () => {
    expect(isLanzaderaProjectDetailUrl("/proyecto/gana-energia")).toBe(true);
    expect(
      isLanzaderaProjectDetailUrl(
        "https://lanzadera.es/proyecto/growpro-experience/",
      ),
    ).toBe(true);
    expect(
      isLanzaderaProjectDetailUrl("/proyecto/zeus?utm_source=list#top"),
    ).toBe(true);

    expect(isLanzaderaProjectDetailUrl("/proyectos/gana-energia")).toBe(false);
    expect(isLanzaderaProjectDetailUrl("/proyecto/")).toBe(false);
    expect(isLanzaderaProjectDetailUrl("/proyecto/gana-energia/extra")).toBe(
      false,
    );
    expect(
      isLanzaderaProjectDetailUrl("https://example.com/proyecto/gana-energia"),
    ).toBe(false);
  });

  it("rejects contact/legal/newsletter/share links", () => {
    expect(isLanzaderaProjectDetailUrl("/contacto")).toBe(false);
    expect(isLanzaderaProjectDetailUrl("/aviso-legal")).toBe(false);
    expect(isLanzaderaProjectDetailUrl("/newsletter")).toBe(false);
    expect(
      isLanzaderaProjectDetailUrl("https://www.whatsapp.com/share?text=test"),
    ).toBe(false);
  });

  it("extracts project name from card title and canonicalizes detail URL", () => {
    const listingHtml = `
      <article class="startup-slide elementor-carousel-image">
        <h3 class="startup-slide__title">Gana Energía</h3>
        <a href="/proyecto/gana-energia/?utm_source=list#top" class="startup-slide__link">ver perfil startup</a>
      </article>
      <article class="startup-slide elementor-carousel-image">
        <h3>GrowPro Experience</h3>
        <a href="https://lanzadera.es/proyecto/growpro-experience/">ver perfil startup</a>
      </article>
      <article class="startup-slide elementor-carousel-image">
        <h3>Contact</h3>
        <a href="/contacto">Contact</a>
      </article>
    `;

    const entries = extractLanzaderaProjectEntries(listingHtml, seedUrl);

    expect(entries).toEqual([
      {
        nameRaw: "Gana Energía",
        detailUrl: "https://lanzadera.es/proyecto/gana-energia",
      },
      {
        nameRaw: "GrowPro Experience",
        detailUrl: "https://lanzadera.es/proyecto/growpro-experience",
      },
    ]);

    expect(
      canonicalizeLanzaderaProjectDetailUrl(
        "/proyecto/gana-energia/?utm_source=list#top",
      ),
    ).toBe("https://lanzadera.es/proyecto/gana-energia");
  });
});
