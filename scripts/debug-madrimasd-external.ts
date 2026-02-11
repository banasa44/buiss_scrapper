#!/usr/bin/env tsx

/**
 * Debug: Check if we can find external links deeper in Madri+d HTML
 *
 * The listing page links to internal detail pages. Let's see if there are
 * any direct external links we're missing, or if we need multi-step fetching.
 */

import { httpRequest } from "@/clients/http";
import { extractAnchors } from "@/companySources/shared";
import { extractWebsiteDomain } from "@/utils/identity/companyIdentity";
import { DIRECTORY_DISCOVERY } from "@/constants";

async function main() {
  const seedUrl = DIRECTORY_DISCOVERY.SEED_URLS.MADRIMASD;
  console.log(`Fetching: ${seedUrl}\n`);

  const html = await httpRequest<string>({
    method: "GET",
    url: seedUrl,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; CompanyDiscoveryBot/1.0; +https://buiss-scraper)",
    },
  });

  const anchors = extractAnchors(html);
  const baseHostname = extractWebsiteDomain(seedUrl) ?? "";

  console.log(`Total anchors: ${anchors.length}`);
  console.log(`Base hostname: ${baseHostname}\n`);

  // Check for any external links
  let externalCount = 0;
  const externalSamples: Array<{ text: string; url: string; domain: string }> =
    [];

  for (const anchor of anchors) {
    try {
      const absoluteUrl = new URL(anchor.href, seedUrl).toString();
      const domain = extractWebsiteDomain(absoluteUrl);

      if (domain && domain !== baseHostname) {
        externalCount++;
        if (externalSamples.length < 10) {
          externalSamples.push({
            text: anchor.text,
            url: absoluteUrl,
            domain,
          });
        }
      }
    } catch {
      // Skip malformed
    }
  }

  console.log(`External links found: ${externalCount}\n`);

  if (externalSamples.length > 0) {
    console.log("Sample external links:");
    externalSamples.forEach((sample, idx) => {
      console.log(`\n[${idx + 1}] ${sample.text}`);
      console.log(`    Domain: ${sample.domain}`);
      console.log(`    URL: ${sample.url}`);
    });
  } else {
    console.log("❌ No external links found on listing page");
    console.log(
      "\nMadri+d appears to use internal detail pages that would need to be fetched",
    );
    console.log("to extract actual company websites.");
  }
}

main().catch((error) => {
  console.error("Debug failed:", error);
  process.exit(1);
});
