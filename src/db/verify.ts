/**
 * Simple verification script for database layer
 *
 * Tests basic CRUD operations through repositories
 */

import {
  openDb,
  closeDb,
  smokeTest,
  upsertCompany,
  upsertOffer,
  createRun,
  finishRun,
  getCompanyById,
  getOfferById,
  getRunById,
} from "@/db";

function testDb() {
  console.log("\n=== Database Layer Verification ===\n");

  // Smoke test first
  console.log("Smoke test:");
  smokeTest();

  openDb();

  // Test 1: Upsert company with provider_company_id
  console.log("Test 1: Upsert company with provider_company_id");
  const companyId1 = upsertCompany({
    provider: "infojobs",
    provider_company_id: "test-123",
    name: "Test Company",
    normalized_name: "test company",
    hidden: 0,
  });
  console.log(`  ✓ Created company ID: ${companyId1}`);

  // Test 2: Upsert same company (should return same ID)
  const companyId2 = upsertCompany({
    provider: "infojobs",
    provider_company_id: "test-123",
    name: "Test Company Updated",
    normalized_name: "test company",
    hidden: 0,
  });
  console.log(
    `  ✓ Updated company ID: ${companyId2} (should equal ${companyId1})`,
  );

  if (companyId1 !== companyId2) {
    throw new Error("Company upsert failed: IDs don't match");
  }

  // Test 3: Upsert company with only normalized_name
  console.log("\nTest 2: Upsert company with normalized_name only");
  const companyId3 = upsertCompany({
    provider: "infojobs",
    name: "Another Company",
    normalized_name: "another company",
  });
  console.log(`  ✓ Created company ID: ${companyId3}`);

  // Test 4: Upsert offer
  console.log("\nTest 3: Upsert offer");
  const offerId1 = upsertOffer({
    provider: "infojobs",
    provider_offer_id: "offer-456",
    provider_url: "https://example.com/offer-456",
    company_id: companyId1,
    title: "Software Engineer",
    description: "Full description here",
    requirements_snippet: "Requirements here",
    published_at: "2026-01-23T10:00:00Z",
  });
  console.log(`  ✓ Created offer ID: ${offerId1}`);

  // Test 5: Upsert same offer (should update)
  const offerId2 = upsertOffer({
    provider: "infojobs",
    provider_offer_id: "offer-456",
    company_id: companyId1,
    title: "Software Engineer (Updated)",
    applications_count: 10,
  });
  console.log(`  ✓ Updated offer ID: ${offerId2} (should equal ${offerId1})`);

  if (offerId1 !== offerId2) {
    throw new Error("Offer upsert failed: IDs don't match");
  }

  // Test 6: Create ingestion run
  console.log("\nTest 4: Create and finish ingestion run");
  const runId = createRun({
    provider: "infojobs",
    query_fingerprint: "test-query",
  });
  console.log(`  ✓ Created run ID: ${runId}`);

  // Test 7: Finish run
  finishRun(runId, {
    finished_at: new Date().toISOString(),
    status: "success",
    pages_fetched: 5,
    offers_fetched: 50,
    requests_count: 10,
    http_429_count: 0,
    errors_count: 0,
  });
  console.log(`  ✓ Finished run ID: ${runId}`);

  // Test 8: Retrieve entities
  console.log("\nTest 5: Retrieve entities");
  const company = getCompanyById(companyId1);
  const offer = getOfferById(offerId1);
  const run = getRunById(runId);

  console.log(`  ✓ Retrieved company: ${company?.name}`);
  console.log(`  ✓ Retrieved offer: ${offer?.title}`);
  console.log(`  ✓ Retrieved run: ${run?.status}`);

  closeDb();

  console.log("\n=== All tests passed! ===\n");
}

if (require.main === module) {
  testDb();
}
