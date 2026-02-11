#!/usr/bin/env tsx

/**
 * Manual test: Madri+d company discovery
 *
 * Verifies:
 * - HTTP fetch succeeds
 * - Anchor extraction works
 * - Returns CompanyInput array
 * - Output is bounded and deterministic
 * - Respects MAX_COMPANIES_PER_SOURCE
 */

import { fetchMadrimasdCompanies } from "@/companySources/madrimasd/madrimasdSource";

async function main() {
  console.log("Testing Madri+d company discovery...\n");

  const companies = await fetchMadrimasdCompanies();

  console.log(`✓ Fetched ${companies.length} companies\n`);

  if (companies.length > 0) {
    console.log("Sample companies:");
    companies.slice(0, 5).forEach((company, idx) => {
      console.log(`\n[${idx + 1}]`);
      console.log(`  Name (raw):        ${company.name_raw}`);
      console.log(`  Name (normalized): ${company.normalized_name}`);
      console.log(`  Domain:            ${company.website_domain}`);
      console.log(`  URL:               ${company.website_url}`);
    });

    if (companies.length > 5) {
      console.log(`\n... and ${companies.length - 5} more`);
    }
  }

  console.log("\n✓ Test complete");
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
