#!/usr/bin/env tsx
/**
 * Smoke test for M4.B3.2b company aggregation orchestration
 *
 * Usage:
 *   npx tsx scripts/smoke-aggregate-company.ts <companyId>
 *
 * Example:
 *   npx tsx scripts/smoke-aggregate-company.ts 1
 *
 * Demonstrates:
 * - Fetching company aggregation state BEFORE
 * - Running aggregateCompanyAndPersist()
 * - Fetching company aggregation state AFTER
 */

import { openDb, closeDb } from "@/db";
import { getCompanyById } from "@/db/repos/companiesRepo";
import { aggregateCompanyAndPersist } from "@/signal/aggregation";

// Initialize database
openDb("data/buiss.db");

// Get companyId from command line args
const companyIdArg = process.argv[2];
if (!companyIdArg) {
  console.error(
    "Usage: npx tsx scripts/smoke-aggregate-company.ts <companyId>",
  );
  closeDb();
  process.exit(1);
}

const companyId = parseInt(companyIdArg, 10);
if (isNaN(companyId)) {
  console.error("Error: companyId must be a number");
  closeDb();
  process.exit(1);
}

console.log(`\n=== M4 Company Aggregation Smoke Test ===`);
console.log(`Company ID: ${companyId}\n`);

// Fetch company BEFORE aggregation
console.log("--- BEFORE aggregation ---");
const before = getCompanyById(companyId);
if (!before) {
  console.error(`Error: Company ${companyId} does not exist`);
  closeDb();
  process.exit(1);
}

console.log({
  id: before.id,
  name: before.name_display ?? before.normalized_name ?? "(no name)",
  max_score: before.max_score,
  offer_count: before.offer_count,
  unique_offer_count: before.unique_offer_count,
  strong_offer_count: before.strong_offer_count,
  avg_strong_score: before.avg_strong_score,
  top_category_id: before.top_category_id,
  top_offer_id: before.top_offer_id,
  category_max_scores: before.category_max_scores
    ? JSON.parse(before.category_max_scores)
    : null,
  last_strong_at: before.last_strong_at,
});

// Run aggregation
console.log("\n--- Running aggregateCompanyAndPersist() ---");
const after = aggregateCompanyAndPersist(companyId);

// Show AFTER state
console.log("\n--- AFTER aggregation ---");
console.log({
  id: after.id,
  name: after.name_display ?? after.normalized_name ?? "(no name)",
  max_score: after.max_score,
  offer_count: after.offer_count,
  unique_offer_count: after.unique_offer_count,
  strong_offer_count: after.strong_offer_count,
  avg_strong_score: after.avg_strong_score,
  top_category_id: after.top_category_id,
  top_offer_id: after.top_offer_id,
  category_max_scores: after.category_max_scores
    ? JSON.parse(after.category_max_scores)
    : null,
  last_strong_at: after.last_strong_at,
});

console.log("\n✓ Aggregation completed successfully\n");

closeDb();
