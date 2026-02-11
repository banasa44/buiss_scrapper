/**
 * ATS Discovery Batch Runner
 *
 * Orchestrates ATS discovery for companies needing it.
 * Processes companies sequentially, persists results, and tracks outcomes.
 */

import { listCompaniesNeedingAtsDiscovery } from "@/db";
import { discoverAts } from "@/atsDiscovery/atsDiscoveryService";
import { persistDiscoveryResult } from "@/atsDiscovery/persistDiscoveryResult";
import { ATS_DISCOVERY_BATCH_LIMIT } from "@/constants/runner";
import { isUniqueConstraintError } from "@/utils";
import * as logger from "@/logger";

/**
 * Batch counters for ATS discovery run
 */
type BatchCounters = {
  checked: number;
  found: number;
  persisted: number;
  notFound: number;
  error: number;
  persistConflict: number;
};

/**
 * Run ATS discovery batch
 *
 * Fetches companies with website_url that don't have ATS discovery results,
 * attempts discovery, and persists findings.
 *
 * @param options - Batch options
 * @param options.limit - Maximum number of companies to process (defaults to ATS_DISCOVERY_BATCH_LIMIT)
 * @returns Batch counters
 */
export async function runAtsDiscoveryBatch(options?: {
  limit?: number;
}): Promise<BatchCounters> {
  const limit = options?.limit ?? ATS_DISCOVERY_BATCH_LIMIT;

  logger.info("Starting ATS discovery batch", { limit });

  const counters: BatchCounters = {
    checked: 0,
    found: 0,
    persisted: 0,
    notFound: 0,
    error: 0,
    persistConflict: 0,
  };

  // Fetch companies needing discovery
  const companies = listCompaniesNeedingAtsDiscovery(limit);

  logger.info("Fetched companies needing ATS discovery", {
    count: companies.length,
  });

  // Process each company sequentially
  for (const company of companies) {
    counters.checked++;

    try {
      // Attempt discovery
      const result = await discoverAts(company.website_url!);

      if (result.status === "found") {
        counters.found++;

        // Attempt to persist
        try {
          persistDiscoveryResult(company.id, result);
          counters.persisted++;

          logger.debug("ATS discovered and persisted", {
            companyId: company.id,
            provider: result.tenant.provider,
            tenantKey: result.tenant.tenantKey,
          });
        } catch (persistError) {
          // Check if it's a UNIQUE constraint violation
          if (isUniqueConstraintError(persistError)) {
            counters.persistConflict++;
            logger.warn("ATS discovery conflict - tenant already claimed", {
              companyId: company.id,
              provider: result.tenant.provider,
              tenantKey: result.tenant.tenantKey,
            });
          } else {
            // Unexpected persistence error
            counters.error++;
            logger.warn("Failed to persist ATS discovery", {
              companyId: company.id,
              error: String(persistError),
            });
          }
        }
      } else if (result.status === "not_found") {
        counters.notFound++;
        logger.debug("No ATS detected", {
          companyId: company.id,
          websiteUrl: company.website_url,
        });
      } else {
        // result.status === "error"
        counters.error++;
        logger.debug("ATS discovery error", {
          companyId: company.id,
          websiteUrl: company.website_url,
          error: result.message,
        });
      }
    } catch (error) {
      // Unexpected top-level error (discoverAts should not throw)
      counters.error++;
      logger.warn("Unexpected error during ATS discovery", {
        companyId: company.id,
        websiteUrl: company.website_url,
        error: String(error),
      });
    }
  }

  // Log summary
  logger.info("ATS discovery batch complete", {
    checked: counters.checked,
    found: counters.found,
    persisted: counters.persisted,
    notFound: counters.notFound,
    error: counters.error,
    persistConflict: counters.persistConflict,
  });

  return counters;
}
