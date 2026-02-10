/**
 * Catalonia company ingestion
 *
 * Fetches companies from Catalonia directory and persists them to the
 * global companies table using the canonical persistence path.
 *
 * Does NOT write to company_sources (no provider context for directory sources).
 */

import { fetchCataloniaCompanies } from "./cataloniaSource";
import { upsertCompany, getDb } from "@/db";
import type { CompanyInput, CompanySourceIngestionResult } from "@/types";
import * as logger from "@/logger";

/**
 * Check if a CompanyInput has sufficient identity evidence for persistence
 *
 * Per canonical identity rules: must have either website_domain or normalized_name
 */
function hasValidIdentity(company: CompanyInput): boolean {
  return !!(company.website_domain || company.normalized_name);
}

/**
 * Ingest companies from Catalonia directory into the companies table
 *
 * Process:
 * 1. Verify DB is open (fail fast if not)
 * 2. Fetch companies from Catalonia directory
 * 3. Filter out companies with insufficient identity evidence
 * 4. Upsert each valid company via canonical repo (upsertCompany)
 * 5. Track counters and log summary
 *
 * Error handling:
 * - Per-company failures are logged and counted, but do not abort the batch
 * - Companies with invalid identity are skipped (counted separately)
 *
 * Database lifecycle:
 * - Caller must call openDb() before invoking this function
 * - This function does NOT manage DB lifecycle (no open/close)
 * - Typical usage: openDb() in runner/script before calling this
 *
 * @throws Error if database is not opened (call openDb() first)
 * @returns Ingestion result counters
 */
export async function ingestCataloniaCompanies(): Promise<CompanySourceIngestionResult> {
  // Guard: verify DB is open before proceeding
  // This provides a clear error message if caller forgot to call openDb()
  try {
    getDb();
  } catch (error) {
    const msg =
      "Database not opened. Call openDb() before ingestCataloniaCompanies(). " +
      "Typically done in runner setup or script initialization.";
    logger.error(msg);
    throw new Error(msg);
  }

  const result: CompanySourceIngestionResult = {
    fetched: 0,
    attempted: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
  };

  // Fetch companies from directory
  let companies: CompanyInput[];
  try {
    companies = await fetchCataloniaCompanies();
    result.fetched = companies.length;
  } catch (error) {
    logger.error("Failed to fetch Catalonia companies", {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  logger.debug("Fetched Catalonia companies, starting persistence", {
    count: companies.length,
  });

  // Persist each company
  for (const company of companies) {
    // Validate identity
    if (!hasValidIdentity(company)) {
      result.skipped++;
      logger.debug("Skipping company with insufficient identity", {
        name: company.name_display,
        hasWebsiteDomain: !!company.website_domain,
        hasNormalizedName: !!company.normalized_name,
      });
      continue;
    }

    result.attempted++;

    // Upsert via canonical repo
    try {
      const companyId = upsertCompany(company);
      result.upserted++;
      logger.debug("Upserted Catalonia company", {
        companyId,
        name: company.name_display,
        domain: company.website_domain,
      });
    } catch (error) {
      result.failed++;
      logger.warn("Failed to upsert Catalonia company", {
        name: company.name_display,
        domain: company.website_domain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Summary log
  logger.info("Catalonia companies ingestion complete", {
    fetched: result.fetched,
    attempted: result.attempted,
    upserted: result.upserted,
    skipped: result.skipped,
    failed: result.failed,
  });

  return result;
}
