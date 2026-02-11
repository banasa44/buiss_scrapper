/**
 * ATS Discovery Persistence
 *
 * Helper to persist ATS discovery results to the company_sources table.
 * Uses application-level upsert keyed by (company_id, provider) to ensure
 * each company has at most one ATS tenant per provider.
 */

import { upsertCompanySourceByCompanyProvider } from "@/db";
import type { AtsDiscoveryResult } from "@/types/atsDiscovery";

/**
 * Persist ATS discovery result to database
 *
 * Creates or updates a company_source record linking the global company
 * to the discovered ATS tenant. Uses application-level upsert keyed by
 * (company_id, provider) - each company can have at most one source per provider.
 *
 * @param companyId - Global company ID to link the ATS tenant to
 * @param result - ATS discovery result containing provider, tenant, and evidence
 * @returns The company_source record ID
 * @throws Error if discovery failed (result.status !== "found")
 */
export function persistDiscoveryResult(
  companyId: number,
  result: AtsDiscoveryResult,
): number {
  if (result.status !== "found") {
    throw new Error(
      `Cannot persist discovery result with status "${result.status}". Only "found" results can be persisted.`,
    );
  }

  return upsertCompanySourceByCompanyProvider({
    company_id: companyId,
    provider: result.tenant.provider,
    provider_company_id: result.tenant.tenantKey,
    provider_company_url: result.tenant.evidenceUrl,
    hidden: null,
    raw_json: null,
  });
}
