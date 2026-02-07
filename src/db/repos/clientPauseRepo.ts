/**
 * Client pause repository
 *
 * Data access layer for client_pause table.
 * Manages persistent per-client pause state (e.g., rate limiting).
 */

import type { ClientPauseRow } from "@/types";
import { getDb } from "@/db";

/**
 * Get client pause state by client identifier
 *
 * @param client - Client identifier (e.g., "infojobs")
 * @returns Client pause row or null if not paused
 */
export function getClientPause(client: string): ClientPauseRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM client_pause WHERE client = ?")
    .get(client) as ClientPauseRow | undefined;

  return row ?? null;
}

/**
 * Set or update client pause state
 *
 * Upserts a pause record with paused_until timestamp and optional reason.
 *
 * @param client - Client identifier
 * @param pausedUntil - ISO 8601 timestamp when pause expires
 * @param options - Optional reason for pause
 */
export function setClientPause(
  client: string,
  pausedUntil: string,
  options: { reason?: string } = {},
): void {
  const db = getDb();

  db.prepare(
    `
    INSERT INTO client_pause (client, paused_until, reason)
    VALUES (?, ?, ?)
    ON CONFLICT(client) DO UPDATE SET
      paused_until = excluded.paused_until,
      reason = excluded.reason,
      updated_at = datetime('now')
  `,
  ).run(client, pausedUntil, options.reason ?? null);
}

/**
 * Clear client pause state
 *
 * Removes the pause record for a client.
 *
 * @param client - Client identifier
 */
export function clearClientPause(client: string): void {
  const db = getDb();
  db.prepare("DELETE FROM client_pause WHERE client = ?").run(client);
}

/**
 * List all client pauses
 *
 * @returns Array of all client pause rows
 */
export function listClientPauses(): ClientPauseRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM client_pause").all() as ClientPauseRow[];
}

/**
 * Check if client is currently paused
 *
 * Compares paused_until timestamp against current time.
 * Optionally clears expired pauses.
 *
 * @param client - Client identifier
 * @param now - Optional ISO timestamp for comparison (defaults to current time)
 * @returns true if client is paused, false otherwise
 */
export function isClientPaused(client: string, now?: string): boolean {
  const pauseRow = getClientPause(client);
  if (!pauseRow) {
    return false;
  }

  const currentTime = now ? new Date(now) : new Date();
  const pauseExpiry = new Date(pauseRow.paused_until);

  if (currentTime >= pauseExpiry) {
    // Pause expired, clear it
    clearClientPause(client);
    return false;
  }

  return true;
}
