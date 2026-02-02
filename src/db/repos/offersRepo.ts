/**
 * Offers repository
 *
 * Data access layer for offers table.
 */

import type {
  Offer,
  OfferInput,
  OfferCanonicalUpdateInput,
  CompanyOfferAggRow,
} from "@/types";
import { getDb } from "@/db";
import { warn } from "@/logger";

/**
 * Upsert an offer based on UNIQUE(provider, provider_offer_id)
 *
 * Returns the offer id (existing or newly inserted)
 */
export function upsertOffer(input: OfferInput): number {
  const db = getDb();

  // Single upsert using ON CONFLICT
  // Note: Canonicalization fields (canonical_offer_id, content_fingerprint,
  // last_seen_at) are intentionally excluded to prevent accidental overwrites.
  // These fields are managed exclusively by M4 dedupe methods.
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

/**
 * Mark an offer as a duplicate by setting its canonical_offer_id
 *
 * Used by M4 dedupe logic when a new offer is detected as a duplicate
 * of an existing canonical offer.
 *
 * @throws Error if offer does not exist
 */
export function markOfferAsDuplicate(
  offerId: number,
  canonicalOfferId: number,
): void {
  const db = getDb();

  const result = db
    .prepare(
      `
    UPDATE offers
    SET canonical_offer_id = ?,
        last_updated_at = datetime('now')
    WHERE id = ?
  `,
    )
    .run(canonicalOfferId, offerId);

  if (result.changes === 0) {
    throw new Error(`Cannot mark as duplicate: offer id ${offerId} not found`);
  }
}

/**
 * Increment repost count and update last_seen_at for a canonical offer
 *
 * Used by M4 dedupe logic when a duplicate is detected, to track
 * repost activity on the canonical offer.
 *
 * @throws Error if offer does not exist
 */
export function incrementOfferRepostCount(
  offerId: number,
  lastSeenAt: string | null,
): void {
  const db = getDb();

  const result = db
    .prepare(
      `
    UPDATE offers
    SET repost_count = repost_count + 1,
        last_seen_at = COALESCE(?, last_seen_at),
        last_updated_at = datetime('now')
    WHERE id = ?
  `,
    )
    .run(lastSeenAt, offerId);

  if (result.changes === 0) {
    throw new Error(
      `Cannot increment repost count: offer id ${offerId} not found`,
    );
  }
}

/**
 * Find canonical offers by content fingerprint and company
 *
 * Used by M4 dedupe logic to quickly find potential duplicates
 * within the same company.
 *
 * Returns only canonical offers (canonical_offer_id IS NULL).
 */
export function findCanonicalOffersByFingerprint(
  contentFingerprint: string,
  companyId: number,
): Offer[] {
  const db = getDb();
  return db
    .prepare(
      `
    SELECT * FROM offers
    WHERE content_fingerprint = ?
      AND company_id = ?
      AND canonical_offer_id IS NULL
  `,
    )
    .all(contentFingerprint, companyId) as Offer[];
}

/**
 * Update offer canonicalization fields
 *
 * Flexible partial update for canonicalization-related fields.
 * Only updates fields present in input.
 *
 * @throws Error if offer does not exist
 */
export function updateOfferCanonical(
  offerId: number,
  input: OfferCanonicalUpdateInput,
): void {
  const db = getDb();

  const updates: string[] = [];
  const values: (number | string | null)[] = [];

  if (input.canonical_offer_id !== undefined) {
    updates.push("canonical_offer_id = ?");
    values.push(input.canonical_offer_id);
  }
  if (input.repost_count !== undefined) {
    updates.push("repost_count = ?");
    values.push(input.repost_count);
  }
  if (input.last_seen_at !== undefined) {
    updates.push("last_seen_at = ?");
    values.push(input.last_seen_at);
  }
  if (input.content_fingerprint !== undefined) {
    updates.push("content_fingerprint = ?");
    values.push(input.content_fingerprint);
  }

  if (updates.length === 0) {
    return; // No updates requested
  }

  // Always update last_updated_at
  updates.push("last_updated_at = datetime('now')");

  const sql = `UPDATE offers SET ${updates.join(", ")} WHERE id = ?`;
  values.push(offerId);

  const result = db.prepare(sql).run(...values);

  if (result.changes === 0) {
    throw new Error(
      `Cannot update canonical fields: offer id ${offerId} not found`,
    );
  }
}

/**
 * List all offers for a company with aggregation-relevant data
 *
 * Used by M4 aggregation logic to fetch minimal data needed to compute
 * company-level signals.
 *
 * SQL strategy:
 * - Joins offers with matches table (LEFT JOIN to include unscored offers)
 * - For unscored offers: score=0, topCategoryId=null
 * - Parses topCategoryId from matched_keywords_json (scoring result)
 * - Ordered by offers.id for deterministic output
 *
 * Note: matched_keywords_json contains the ScoreResult which includes
 * topCategoryId. If parsing fails, logs warning and returns null.
 *
 * @param companyId - Company ID to fetch offers for
 * @returns Array of offer rows with aggregation data
 */
export function listCompanyOffersForAggregation(
  companyId: number,
): CompanyOfferAggRow[] {
  const db = getDb();

  // Query joins offers with matches to get score + category info
  // LEFT JOIN ensures unscored offers are included with score=0
  const rows = db
    .prepare(
      `
    SELECT
      o.id as offerId,
      o.canonical_offer_id as canonicalOfferId,
      o.repost_count as repostCount,
      o.published_at as publishedAt,
      o.updated_at as updatedAt,
      COALESCE(m.score, 0) as score,
      m.matched_keywords_json as matchedKeywordsJson
    FROM offers o
    LEFT JOIN matches m ON o.id = m.offer_id
    WHERE o.company_id = ?
    ORDER BY o.id ASC
  `,
    )
    .all(companyId) as Array<{
    offerId: number;
    canonicalOfferId: number | null;
    repostCount: number;
    publishedAt: string | null;
    updatedAt: string | null;
    score: number;
    matchedKeywordsJson: string | null;
  }>;

  // Parse topCategoryId from matched_keywords_json
  return rows.map((row) => ({
    offerId: row.offerId,
    canonicalOfferId: row.canonicalOfferId,
    repostCount: row.repostCount,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    score: row.score,
    topCategoryId: parseTopCategoryId(row.matchedKeywordsJson, row.offerId),
  }));
}

/**
 * Parse topCategoryId from matched_keywords_json
 *
 * The JSON contains a ScoreResult with topCategoryId field.
 * If parsing fails or field is missing, returns null and logs warning.
 */
function parseTopCategoryId(
  json: string | null,
  offerId: number,
): string | null {
  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json);
    return parsed.topCategoryId ?? null;
  } catch (err) {
    warn("Failed to parse topCategoryId from matched_keywords_json", {
      offerId,
      error: String(err),
    });
    return null;
  }
}
