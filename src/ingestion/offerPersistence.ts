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
import {
  upsertOffer,
  getOfferByProviderId,
  updateOfferLastSeenAt,
  listCanonicalOffersForRepost,
  incrementOfferRepostCount,
} from "@/db";
import { detectRepostDuplicate } from "@/signal/repost";
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
 * Compute effective "last seen at" timestamp for an offer
 *
 * Priority: updatedAt > publishedAt > current time
 * This represents when the offer was last observed by the provider.
 *
 * @param offer - Canonical job offer
 * @returns ISO 8601 timestamp string
 */
function computeEffectiveSeenAt(offer: PersistOfferInput["offer"]): string {
  return offer.updatedAt || offer.publishedAt || new Date().toISOString();
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
 * 3. Computes effective "last seen at" timestamp
 * 4. Checks if this exact (provider, provider_offer_id) already exists:
 *    - If yes: upserts normally, updates last_seen_at, proceeds with matching/scoring
 * 5. If not found, performs repost detection:
 *    - Fetches canonical offers for the company
 *    - Runs pure repost detection algorithm
 *    - If duplicate detected: increments repost_count on canonical, skips insert
 *    - If not duplicate: proceeds with normal insert
 *
 * Per-offer failures do not throw; they return a discriminated result.
 *
 * @param input - Offer data and provider
 * @returns Discriminated result: ok with offerId, repost, or not ok with reason
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

  // Step 2: Compute effective seen timestamp
  const effectiveSeenAt = computeEffectiveSeenAt(offer);

  // Step 3: Check if this exact (provider, provider_offer_id) already exists
  // This is the "same offer" short-circuit - same provider_offer_id = update, not repost
  const existingOffer = getOfferByProviderId(provider, offer.ref.id);

  if (existingOffer) {
    // Same offer seen again - treat as normal update
    // Build offer input and upsert (this updates content if changed)
    const offerInput = buildOfferInput(offer, provider, companyId);

    try {
      const offerId = upsertOffer(offerInput);

      // Update last_seen_at separately (not handled by upsertOffer)
      updateOfferLastSeenAt(offerId, effectiveSeenAt);

      return { ok: true, offerId, companyId };
    } catch (err) {
      logger.error("Failed to upsert existing offer", {
        provider,
        offerId: offer.ref.id,
        companyId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, reason: "db_error", companyId };
    }
  }

  // Step 4: New provider_offer_id - perform repost detection
  try {
    // Fetch canonical offers for this company
    const candidates = listCanonicalOffersForRepost(companyId);

    // Run pure repost detection
    const decision = detectRepostDuplicate(
      {
        title: offer.title,
        description: "description" in offer ? offer.description : null,
      },
      candidates,
    );

    if (decision.kind === "duplicate") {
      // Repost detected - update canonical offer, skip insert
      incrementOfferRepostCount(decision.canonicalOfferId, effectiveSeenAt);

      logger.info("Repost duplicate detected", {
        provider,
        providerOfferId: offer.ref.id,
        canonicalOfferId: decision.canonicalOfferId,
        detectionReason: decision.reason,
        similarity: decision.similarity,
        companyId,
      });

      return {
        ok: true,
        reason: "repost_duplicate",
        canonicalOfferId: decision.canonicalOfferId,
        companyId,
        detectionReason: decision.reason,
        similarity: decision.similarity,
      };
    }

    // Not a duplicate - proceed with normal insert
    const offerInput = buildOfferInput(offer, provider, companyId);
    const offerId = upsertOffer(offerInput);

    // Set last_seen_at for new canonical offer
    updateOfferLastSeenAt(offerId, effectiveSeenAt);

    return { ok: true, offerId, companyId };
  } catch (err) {
    logger.error("Failed during repost detection or offer insert", {
      provider,
      offerId: offer.ref.id,
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "db_error", companyId };
  }
}
