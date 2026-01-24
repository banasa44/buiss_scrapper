/**
 * Offers repository
 *
 * Data access layer for offers table.
 */

import type { Offer, OfferInput } from "@/types";
import { getDb } from "../connection";

/**
 * Upsert an offer based on UNIQUE(provider, provider_offer_id)
 *
 * Returns the offer id (existing or newly inserted)
 */
export function upsertOffer(input: OfferInput): number {
  const db = getDb();

  // Single upsert using ON CONFLICT
  db.prepare(
    `
    INSERT INTO offers (
      provider, provider_offer_id, provider_url, company_id,
      title, description, min_requirements, desired_requirements,
      requirements_snippet, published_at, updated_at, created_at,
      applications_count, metadata_json, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_offer_id) DO UPDATE SET
      provider_url = excluded.provider_url,
      company_id = excluded.company_id,
      title = excluded.title,
      description = excluded.description,
      min_requirements = excluded.min_requirements,
      desired_requirements = excluded.desired_requirements,
      requirements_snippet = excluded.requirements_snippet,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at,
      created_at = excluded.created_at,
      applications_count = excluded.applications_count,
      metadata_json = excluded.metadata_json,
      raw_json = excluded.raw_json,
      last_updated_at = datetime('now')
  `,
  ).run(
    input.provider,
    input.provider_offer_id,
    input.provider_url ?? null,
    input.company_id,
    input.title,
    input.description ?? null,
    input.min_requirements ?? null,
    input.desired_requirements ?? null,
    input.requirements_snippet ?? null,
    input.published_at ?? null,
    input.updated_at ?? null,
    input.created_at ?? null,
    input.applications_count ?? null,
    input.metadata_json ?? null,
    input.raw_json ?? null,
  );

  // Get the id
  const row = db
    .prepare(
      "SELECT id FROM offers WHERE provider = ? AND provider_offer_id = ?",
    )
    .get(input.provider, input.provider_offer_id) as Offer;
  return row.id;
}

/**
 * Get offer by id
 */
export function getOfferById(id: number): Offer | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM offers WHERE id = ?").get(id) as
    | Offer
    | undefined;
}

/**
 * Get offer by provider and provider_offer_id
 */
export function getOfferByProviderId(
  provider: string,
  providerOfferId: string,
): Offer | undefined {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM offers WHERE provider = ? AND provider_offer_id = ?",
    )
    .get(provider, providerOfferId) as Offer | undefined;
}
