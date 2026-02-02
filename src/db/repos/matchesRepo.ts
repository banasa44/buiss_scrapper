/**
 * Matches repository
 *
 * Data access layer for matches table (1:1 with offers).
 * Stores scoring results for each offer.
 */

import type { Match, MatchInput } from "@/types";
import { getDb } from "@/db";

/**
 * Upsert a match result for an offer
 *
 * Inserts or updates the match row based on offer_id.
 * Overwrites existing match data (scoring is recomputed on each run).
 *
 * @param input - Match data with offer_id, score, and matched_keywords_json
 */
export function upsertMatch(input: MatchInput): void {
  const db = getDb();

  db.prepare(
    `
    INSERT INTO matches (offer_id, score, matched_keywords_json, reasons, computed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(offer_id) DO UPDATE SET
      score = excluded.score,
      matched_keywords_json = excluded.matched_keywords_json,
      reasons = excluded.reasons,
      computed_at = datetime('now')
  `,
  ).run(
    input.offer_id,
    input.score,
    input.matched_keywords_json,
    input.reasons ?? null,
  );
}

/**
 * Get match by offer_id
 */
export function getMatchByOfferId(offerId: number): Match | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM matches WHERE offer_id = ?").get(offerId) as
    | Match
    | undefined;
}
