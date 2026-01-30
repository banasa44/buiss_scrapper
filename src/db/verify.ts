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
  upsertCompanySource,
  upsertOffer,
  createRun,
  finishRun,
  getCompanyById,
  getOfferById,
  getRunById,
  updateCompanyAggregation,
} from "@/db";
import {
  startRun as lifecycleStartRun,
  finishRun as lifecycleFinishRun,
  withRun,
} from "@/ingestion";
import type { Provider } from "@/types";

function testDb() {
  console.log("\n=== Database Layer Verification ===\n");

  // Smoke test first
  console.log("Smoke test:");
  smokeTest();

  openDb();

  // Test 1: Upsert company with website_domain (strongest identity)
  console.log("Test 1: Upsert company with website_domain");
  const companyId1 = upsertCompany({
    name_raw: "Test Company Inc.",
    name_display: "Test Company",
    normalized_name: "test company",
    website_url: "https://testcompany.com",
    website_domain: "testcompany.com",
  });
  console.log(`  ✓ Created company ID: ${companyId1}`);

  // Test 2: Upsert same company by domain (should return same ID)
  const companyId2 = upsertCompany({
    name_raw: "Test Company Inc. (Updated)",
    name_display: "Test Company Updated",
    normalized_name: "test company updated",
    website_url: "https://testcompany.com",
    website_domain: "testcompany.com",
  });
  console.log(
    `  ✓ Updated company ID: ${companyId2} (should equal ${companyId1})`,
  );

  if (companyId1 !== companyId2) {
    throw new Error("Company upsert by domain failed: IDs don't match");
  }

  // Test 3: Upsert company with only normalized_name (no domain)
  console.log("\nTest 2: Upsert company with normalized_name only");
  const companyId3 = upsertCompany({
    name_raw: "Another Company Ltd.",
    name_display: "Another Company",
    normalized_name: "another company",
  });
  console.log(`  ✓ Created company ID: ${companyId3}`);

  // Test 4: Upsert company source for InfoJobs
  console.log("\nTest 3: Upsert company source");
  const sourceId1 = upsertCompanySource({
    company_id: companyId1,
    provider: "infojobs",
    provider_company_id: "ij-123",
    provider_company_url: "https://infojobs.net/company/ij-123",
    hidden: 0,
  });
  console.log(`  ✓ Created company source ID: ${sourceId1}`);

  // Test 5: Upsert same company source (should update)
  const sourceId2 = upsertCompanySource({
    company_id: companyId1,
    provider: "infojobs",
    provider_company_id: "ij-123",
    hidden: 1,
  });
  console.log(
    `  ✓ Updated company source ID: ${sourceId2} (should equal ${sourceId1})`,
  );

  if (sourceId1 !== sourceId2) {
    throw new Error("Company source upsert failed: IDs don't match");
  }

  // Test 6: Upsert offer
  console.log("\nTest 4: Upsert offer");
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

  // Test 7: Upsert same offer (should update)
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

  // Test 8: Create ingestion run
  console.log("\nTest 5: Create and finish ingestion run");
  const runId = createRun({
    provider: "infojobs",
    query_fingerprint: "test-query",
  });
  console.log(`  ✓ Created run ID: ${runId}`);

  // Test 9: Finish run
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

  // Test 10: Retrieve entities
  console.log("\nTest 6: Retrieve entities");
  const company = getCompanyById(companyId1);
  const offer = getOfferById(offerId1);
  const run = getRunById(runId);

  console.log(`  ✓ Retrieved company: ${company?.name_display}`);
  console.log(`  ✓ Retrieved offer: ${offer?.title}`);
  console.log(`  ✓ Retrieved run: ${run?.status}`);

  // Test 11: Test that missing identity throws error
  console.log("\nTest 7: Verify missing identity throws error");
  try {
    upsertCompany({
      name_raw: "No Identity Company",
    });
    throw new Error("Should have thrown error for missing identity");
  } catch (err: any) {
    if (err.message.includes("Cannot upsert company")) {
      console.log(`  ✓ Correctly threw error: ${err.message.split(".")[0]}`);
    } else {
      throw err;
    }
  }

  // Test 12: Update company aggregation signals
  console.log("\nTest 8: Update company aggregation signals");
  const updatedCompany = updateCompanyAggregation(companyId1, {
    max_score: 8.5,
    offer_count: 3,
    unique_offer_count: 2,
    strong_offer_count: 2,
    avg_strong_score: 7.5,
    top_category_id: "cloud",
    top_offer_id: offerId1,
    category_max_scores: { cloud: 8.5, payments: 6.0 },
    last_strong_at: "2026-01-30T12:00:00Z",
  });
  console.log(
    `  ✓ Updated aggregation: score=${updatedCompany.max_score}, offers=${updatedCompany.offer_count}`,
  );

  // Verify JSON serialization
  if (!updatedCompany.category_max_scores) {
    throw new Error("category_max_scores should not be null");
  }
  const parsedScores = JSON.parse(updatedCompany.category_max_scores);
  if (parsedScores.cloud !== 8.5) {
    throw new Error("category_max_scores JSON not properly serialized");
  }
  console.log(`  ✓ JSON serialization: ${updatedCompany.category_max_scores}`);

  // Test 13: Partial update (only some fields)
  const partialUpdate = updateCompanyAggregation(companyId1, {
    max_score: 9.0,
    offer_count: 4,
  });
  if (
    partialUpdate.max_score !== 9.0 ||
    partialUpdate.offer_count !== 4 ||
    partialUpdate.strong_offer_count !== 2
  ) {
    throw new Error("Partial update failed to preserve unmodified fields");
  }
  console.log(
    `  ✓ Partial update: score=${partialUpdate.max_score}, strong_count=${partialUpdate.strong_offer_count} (preserved)`,
  );

  closeDb();

  console.log("\n=== All tests passed! ===\n");
}

/**
 * Test run lifecycle helpers (startRun, finishRun, withRun)
 */
async function testRunLifecycle() {
  console.log("\n=== Run Lifecycle Verification ===\n");

  openDb();

  // Fixture data
  const provider: Provider = "infojobs";

  // Test 8: startRun + finishRun
  console.log("Test 8: Run lifecycle helpers");
  const runId = lifecycleStartRun(provider);
  lifecycleFinishRun(runId, "success", {
    pages_fetched: 5,
    offers_fetched: 100,
  });
  const run = getRunById(runId);
  if (run?.status !== "success" || run?.pages_fetched !== 5) {
    throw new Error("Run lifecycle finishRun failed");
  }
  console.log(
    `  ✓ startRun + finishRun: status=${run.status}, pages=${run.pages_fetched}`,
  );

  // Test 9: withRun success path
  let successRunId: number | null = null;
  const result = await withRun(provider, undefined, async (rid) => {
    successRunId = rid;
    return "ok";
  });
  const successRun = successRunId ? getRunById(successRunId) : null;
  if (result !== "ok" || successRun?.status !== "success") {
    throw new Error("withRun success path failed");
  }
  console.log(`  ✓ withRun (success): status=${successRun.status}`);

  // Test 10: withRun failure path
  let failRunId: number | null = null;
  let caughtError = false;
  try {
    await withRun(provider, undefined, async (rid) => {
      failRunId = rid;
      throw new Error("Simulated");
    });
  } catch {
    caughtError = true;
  }
  const failRun = failRunId ? getRunById(failRunId) : null;
  if (!caughtError || failRun?.status !== "failure") {
    throw new Error("withRun failure path did not finalize correctly");
  }
  console.log(
    `  ✓ withRun (failure): status=${failRun.status}, error rethrown`,
  );

  closeDb();
}

if (require.main === module) {
  testDb();
  testRunLifecycle().catch((err) => {
    console.error("Run lifecycle verification failed:", err);
    process.exit(1);
  });
}
