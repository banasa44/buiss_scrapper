#!/usr/bin/env tsx

/**
 * Debug script: Inspect Madri+d anchor extraction
 *
 * Shows first N anchors and filtering decisions to understand
 * why no companies are being returned
 */

import { httpRequest } from "@/clients/http";
import { extractAnchors, shouldExcludeUrl } from "@/companySources/shared";
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
  console.log(`Total anchors extracted: ${anchors.length}\n`);

  const baseHostname = extractWebsiteDomain(seedUrl) ?? "";
  console.log(`Base hostname: ${baseHostname}\n`);

  console.log("Sample anchors (first 20):");
  console.log("=".repeat(80));

  for (let i = 0; i < Math.min(20, anchors.length); i++) {
    const anchor = anchors[i];

    // Resolve to absolute URL
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(anchor.href, seedUrl).toString();
    } catch {
      console.log(`\n[${i + 1}] MALFORMED`);
      console.log(`  href: ${anchor.href}`);
      console.log(`  text: ${anchor.text}`);
      continue;
    }

    const websiteDomain = extractWebsiteDomain(absoluteUrl);
    const excluded = shouldExcludeUrl(absoluteUrl, baseHostname);

    console.log(`\n[${i + 1}] ${excluded ? "❌ EXCLUDED" : "✓ INCLUDED"}`);
    console.log(`  href: ${anchor.href}`);
    console.log(`  text: ${anchor.text}`);
    console.log(`  absolute: ${absoluteUrl}`);
    console.log(`  domain: ${websiteDomain ?? "(none)"}`);
  }
}

main().catch((error) => {
  console.error("Debug failed:", error);
  process.exit(1);
});
