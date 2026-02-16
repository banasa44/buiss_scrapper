import { describe, expect, it } from "vitest";
import { DIRECTORY_DISCOVERY } from "@/constants";
import {
  canonicalizeCataloniaStartupDetailUrl,
  extractCataloniaStartupEntries,
  isCataloniaStartupDetailUrl,
} from "@/companySources/catalonia/cataloniaSource";

describe("Catalonia source URL filtering", () => {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.CATALONIA;

  it("accepts only canonical startup detail URLs", () => {
    expect(
      isCataloniaStartupDetailUrl("/startup/barcelona/abacum-planning/4470"),
    ).toBe(true);
    expect(
      isCataloniaStartupDetailUrl(
        "https://startupshub.catalonia.com/startup/girona/nora-real-time/8891/",
      ),
    ).toBe(true);
    expect(
      isCataloniaStartupDetailUrl(
        "/startup/tarragona/quantion-labs/9012?utm_source=list#top",
      ),
    ).toBe(true);
    expect(isCataloniaStartupDetailUrl("/startup/barcelona/abacum/abc")).toBe(
      false,
    );
    expect(
      isCataloniaStartupDetailUrl("/startup/barcelona/abacum/4470/extra"),
    ).toBe(false);
    expect(
      isCataloniaStartupDetailUrl("https://example.com/startup/barcelona/a/1"),
    ).toBe(false);
  });

  it("rejects share/legal/newsletter/contact links", () => {
    expect(isCataloniaStartupDetailUrl("/legal-notice")).toBe(false);
    expect(isCataloniaStartupDetailUrl("/contact")).toBe(false);
    expect(isCataloniaStartupDetailUrl("/newsletter")).toBe(false);
    expect(
      isCataloniaStartupDetailUrl(
        "https://www.whatsapp.com/share?text=startupshub",
      ),
    ).toBe(false);
  });

  it("extracts startup name from card title and canonicalizes detail URL", () => {
    const listingHtml = `
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">ABACUM PLANNING S.L.</h3>
          <a class="link_all" href="/startup/barcelona/abacum-planning/4470/?utm_source=list#top">
            <span class="sr-only">Read more</span>
          </a>
        </div>
      </li>
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">NORA REAL TIME</h3>
          <a class="link_all" href="/startup/girona/nora-real-time/8891/"></a>
        </div>
      </li>
      <li class="item col-12 col-md-4">
        <div class="bloque">
          <h3 class="small_title">Contact</h3>
          <a class="link_all" href="/contact"></a>
        </div>
      </li>
    `;

    const entries = extractCataloniaStartupEntries(listingHtml, seedUrl);

    expect(entries).toEqual([
      {
        nameRaw: "ABACUM PLANNING S.L.",
        detailUrl:
          "https://startupshub.catalonia.com/startup/barcelona/abacum-planning/4470",
      },
      {
        nameRaw: "NORA REAL TIME",
        detailUrl:
          "https://startupshub.catalonia.com/startup/girona/nora-real-time/8891",
      },
    ]);

    expect(
      canonicalizeCataloniaStartupDetailUrl(
        "/startup/barcelona/abacum-planning/4470/?utm_source=list#top",
      ),
    ).toBe(
      "https://startupshub.catalonia.com/startup/barcelona/abacum-planning/4470",
    );
  });
});
