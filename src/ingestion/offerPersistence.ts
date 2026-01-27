/**
 * Offer persistence — persist job offers to the database
 *
 * This module handles the persistence of normalized job offers.
 * It first persists the company (via companyPersistence), then
 * upserts the offer with the obtained companyId.
 *
 * ## Dedupe key
 * Offers are deduplicated by `(provider, provider_offer_id)` composite key,
 * enforced by the DB UNIQUE constraint.
 *
 * ## Semantics
 * - Upserts are overwrite-based (null in input -> NULL in DB)
 * - `raw_json` is always null for M1 (no raw retention)
 * - Per-offer errors do not crash the run (log + skip)
 */

import type {
  Provider,
  OfferInput,
  JobOfferMetadata,
  OfferPersistResult,
  PersistOfferInput,
} from "@/types";
import { upsertOffer } from "@/db";
import { persistCompanyAndSource } from "./companyPersistence";
import * as logger from "@/logger";

/**
 * Serialize metadata to JSON string for DB storage
 *
 * @param metadata - Optional JobOfferMetadata object
 * @returns JSON string or null
 */
function serializeMetadata(metadata?: JobOfferMetadata): string | null {
  if (!metadata) return null;
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
}

/**
 * Build OfferInput from canonical offer + companyId
 *
 * Maps canonical offer fields to DB schema fields.
 * Uses overwrite semantics: missing values become null.
 *
 * @param offer - Canonical job offer (summary or detail)
 * @param provider - Provider identifier
 * @param companyId - Global company ID from persistCompanyAndSource
 */
function buildOfferInput(
  offer: PersistOfferInput["offer"],
  provider: Provider,
  companyId: number,
): OfferInput {
  return {
    provider,
    provider_offer_id: offer.ref.id,
    provider_url: offer.ref.url ?? null,
    company_id: companyId,
    title: offer.title,
    description: "description" in offer ? (offer.description ?? null) : null,
    min_requirements:
      "minRequirements" in offer ? (offer.minRequirements ?? null) : null,
    desired_requirements:
      "desiredRequirements" in offer
        ? (offer.desiredRequirements ?? null)
        : null,
    requirements_snippet: offer.requirementsSnippet ?? null,
    published_at: offer.publishedAt ?? null,
    updated_at: offer.updatedAt ?? null,
    created_at: "createdAt" in offer ? (offer.createdAt ?? null) : null,
    applications_count:
      "applicationsCount" in offer ? (offer.applicationsCount ?? null) : null,
    metadata_json: serializeMetadata(offer.metadata),
    raw_json: null, // Per M1 decision: no raw retention for offers
  };
}

/**
 * Persist an offer to the database
 *
 * This function:
 * 1. Persists the company (and provider source link) first
 * 2. If company is unidentifiable, skips the offer (returns failure result)
 * 3. Builds the OfferInput from canonical types
 * 4. Upserts the offer (soft failure: logs and returns failure result)
 *
 * Per-offer failures do not throw; they return a discriminated result.
 *
 * @param input - Offer data and provider
 * @returns Discriminated result: ok with offerId, or not ok with reason
 */
export function persistOffer(input: PersistOfferInput): OfferPersistResult {
  const { offer, provider } = input;

  // Step 1: Persist company first
  const companyResult = persistCompanyAndSource({
    company: offer.company,
    provider,
    providerCompanyUrl: undefined, // Not available from offer; could be enriched later
  });

  if (!companyResult.ok) {
    logger.debug("Offer skipped: company unidentifiable", {
      provider,
      offerId: offer.ref.id,
      companyName: offer.company.name,
    });
    return { ok: false, reason: "company_unidentifiable" };
  }

  const { companyId } = companyResult;

  // Step 2: Build offer input
  const offerInput = buildOfferInput(offer, provider, companyId);

  // Step 3: Upsert offer (with error handling)
  try {
    const offerId = upsertOffer(offerInput);
    return { ok: true, offerId };
  } catch (err) {
    logger.error("Failed to upsert offer", {
      provider,
      offerId: offer.ref.id,
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "db_error" };
  }
}
