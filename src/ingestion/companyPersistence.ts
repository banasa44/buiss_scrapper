/**
 * Company persistence — persist global companies + provider source links
 *
 * This module handles the persistence of company data from normalized
 * JobOfferCompany to the database. It derives missing identity evidence
 * and gracefully handles insufficient data (log + skip, no throw).
 *
 * ## Semantics note
 * The underlying `companiesRepo.upsertCompany` uses COALESCE (enrich) semantics:
 * existing non-null values are preserved, incoming values fill gaps.
 * This differs from the "overwrite" rule for offers but is intentional for companies,
 * as company identity evidence accumulates over multiple ingestion runs.
 */

import type {
  JobOfferCompany,
  Provider,
  CompanyInput,
  CompanySourceInput,
  CompanyPersistResult,
  PersistCompanyInput,
} from "@/types";
import { upsertCompany, upsertCompanySource } from "@/db";
import { normalizeCompanyName, extractWebsiteDomain } from "@/utils";
import * as logger from "@/logger";

/**
 * Build CompanyInput from JobOfferCompany with identity derivation
 *
 * Derives missing identity evidence:
 * - If websiteDomain is missing but websiteUrl exists, extract it
 * - If normalizedName is missing but nameRaw/name exists, normalize it
 *
 * @returns CompanyInput or null if identity evidence is insufficient
 */
function buildCompanyInput(company: JobOfferCompany): CompanyInput | null {
  // Start with direct mappings
  const nameRaw = company.nameRaw ?? company.name ?? null;
  const nameDisplay = company.name ?? null;
  const websiteUrl = company.websiteUrl ?? null;

  // Derive website_domain if not present but websiteUrl is available
  let websiteDomain = company.websiteDomain ?? null;
  if (!websiteDomain && websiteUrl) {
    websiteDomain = extractWebsiteDomain(websiteUrl);
  }

  // Derive normalized_name if not present but name is available
  let normalizedName = company.normalizedName ?? null;
  if (!normalizedName && nameRaw) {
    const derived = normalizeCompanyName(nameRaw);
    normalizedName = derived || null; // empty string becomes null
  }

  // Identity check: must have at least one of website_domain or normalized_name
  if (!websiteDomain && !normalizedName) {
    return null;
  }

  return {
    name_raw: nameRaw,
    name_display: nameDisplay,
    normalized_name: normalizedName,
    website_url: websiteUrl,
    website_domain: websiteDomain,
  };
}

/**
 * Build CompanySourceInput from JobOfferCompany + provider context
 *
 * @param companyId - The global company ID (from upsertCompany)
 * @param company - The original JobOfferCompany
 * @param provider - The provider identifier
 * @param providerCompanyUrl - Optional provider-specific company URL
 */
function buildCompanySourceInput(
  companyId: number,
  company: JobOfferCompany,
  provider: Provider,
  providerCompanyUrl?: string,
): CompanySourceInput {
  return {
    company_id: companyId,
    provider,
    provider_company_id: company.id ?? null,
    provider_company_url: providerCompanyUrl ?? null,
    hidden: company.hidden ? 1 : 0,
    raw_json: null, // Per policy: no raw retention in company_sources
  };
}

/**
 * Persist a company and its provider source link
 *
 * This function:
 * 1. Derives missing identity evidence (websiteDomain, normalizedName)
 * 2. Validates that sufficient identity evidence exists
 * 3. Upserts the global company
 * 4. Upserts the provider source link (soft failure: logs and continues)
 *
 * External data is unreliable: if identity evidence is insufficient,
 * this function logs and returns a "skipped" result (no throw).
 *
 * @param input - Company data, provider, and optional provider URL
 * @returns Discriminated result: ok with companyId, or not ok with reason
 */
export function persistCompanyAndSource(
  input: PersistCompanyInput,
): CompanyPersistResult {
  const { company, provider, providerCompanyUrl } = input;

  // Build company input with derivation
  const companyInput = buildCompanyInput(company);

  if (!companyInput) {
    logger.debug("Company skipped: insufficient identity evidence", {
      provider,
      companyId: company.id,
      companyName: company.name,
      hasWebsiteUrl: !!company.websiteUrl,
      hasWebsiteDomain: !!company.websiteDomain,
      hasNormalizedName: !!company.normalizedName,
      hasNameRaw: !!company.nameRaw,
    });
    return { ok: false, reason: "insufficient_identity_evidence" };
  }

  // Upsert global company
  const companyId = upsertCompany(companyInput);

  // Attempt to upsert company source (soft failure)
  try {
    const sourceInput = buildCompanySourceInput(
      companyId,
      company,
      provider,
      providerCompanyUrl,
    );
    upsertCompanySource(sourceInput);
  } catch (err) {
    // Log and continue — source link failure does not invalidate the company
    logger.warn("Failed to upsert company source, continuing", {
      companyId,
      provider,
      providerCompanyId: company.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, companyId };
}
