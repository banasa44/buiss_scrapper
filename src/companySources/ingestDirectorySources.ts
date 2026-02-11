/**
 * Generic directory source ingestion
 *
 * Fetches companies from one or more directory sources and persists them to
 * the global companies table using the canonical persistence path.
 *
 * Does NOT write to company_sources (no provider context for directory sources).
 */

import type { CompanyDirectorySource } from "@/interfaces";
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
 * Ingest companies from directory sources into the companies table
 *
 * Process for each source:
 * 1. Fetch companies from source (via source.fetchCompanies())
 * 2. Filter out companies with insufficient identity evidence
 * 3. Upsert each valid company via canonical repo (upsertCompany)
 * 4. Track per-source counters and log summary
 *
 * Then aggregate totals across all sources and log final summary.
 *
 * Error handling:
 * - Per-source fetch failures are logged and result in empty result for that source
 * - Per-company failures are logged and counted, but do not abort the batch
 * - Companies with invalid identity are skipped (counted separately)
 *
 * Database lifecycle:
 * - Caller must call openDb() before invoking this function
 * - This function does NOT manage DB lifecycle (no open/close)
 * - Typical usage: openDb() in runner/script before calling this
 *
 * @param sources Array of directory sources to ingest from
 * @throws Error if database is not opened (call openDb() first)
 * @returns Object with per-source results and aggregated total
 */
export async function ingestDirectorySources(
  sources: CompanyDirectorySource[],
): Promise<{
  bySource: Record<string, CompanySourceIngestionResult>;
  total: CompanySourceIngestionResult;
}> {
  // Guard: verify DB is open before proceeding
  // This provides a clear error message if caller forgot to call openDb()
  try {
    getDb();
  } catch (error) {
    const msg =
      "Database not opened. Call openDb() before ingestDirectorySources(). " +
      "Typically done in runner setup or script initialization.";
    logger.error(msg);
    throw new Error(msg);
  }

  const bySource: Record<string, CompanySourceIngestionResult> = {};
  const total: CompanySourceIngestionResult = {
    fetched: 0,
    attempted: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
  };

  // Process each source
  for (const source of sources) {
    const sourceResult: CompanySourceIngestionResult = {
      fetched: 0,
      attempted: 0,
      upserted: 0,
      skipped: 0,
      failed: 0,
    };

    // Fetch companies from directory
    let companies: CompanyInput[];
    try {
      companies = await source.fetchCompanies();
      sourceResult.fetched = companies.length;
    } catch (error) {
      logger.error(`Failed to fetch companies from source: ${source.id}`, {
        seedUrl: source.seedUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      bySource[source.id] = sourceResult;
      continue;
    }

    logger.debug(`Fetched companies from ${source.id}, starting persistence`, {
      count: companies.length,
    });

    // Persist each company
    for (const company of companies) {
      // Validate identity
      if (!hasValidIdentity(company)) {
        sourceResult.skipped++;
        logger.debug("Skipping company with insufficient identity", {
          source: source.id,
          name: company.name_display,
          hasWebsiteDomain: !!company.website_domain,
          hasNormalizedName: !!company.normalized_name,
        });
        continue;
      }

      sourceResult.attempted++;

      // Upsert via canonical repo
      try {
        const companyId = upsertCompany(company);
        sourceResult.upserted++;
        logger.debug(`Upserted company from ${source.id}`, {
          companyId,
          name: company.name_display,
          domain: company.website_domain,
        });
      } catch (error) {
        sourceResult.failed++;
        logger.warn(`Failed to upsert company from ${source.id}`, {
          name: company.name_display,
          domain: company.website_domain,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Per-source summary log
    logger.info(`Companies ingestion complete: ${source.id}`, {
      fetched: sourceResult.fetched,
      attempted: sourceResult.attempted,
      upserted: sourceResult.upserted,
      skipped: sourceResult.skipped,
      failed: sourceResult.failed,
    });

    bySource[source.id] = sourceResult;

    // Aggregate totals
    total.fetched += sourceResult.fetched;
    total.attempted += sourceResult.attempted;
    total.upserted += sourceResult.upserted;
    total.skipped += sourceResult.skipped;
    total.failed += sourceResult.failed;
  }

  // Total summary log
  logger.info("All directory sources ingestion complete", {
    sources: sources.length,
    fetched: total.fetched,
    attempted: total.attempted,
    upserted: total.upserted,
    skipped: total.skipped,
    failed: total.failed,
  });

  return { bySource, total };
}
