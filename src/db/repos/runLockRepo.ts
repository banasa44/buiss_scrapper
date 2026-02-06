/**
 * Run lock repository
 *
 * Implements global run lock for sequential execution across processes.
 * Uses DB-based locking with TTL to prevent permanent deadlocks.
 */

import type { RunLockRow, RunLockAcquireResult } from "@/types";
import { getDb } from "@/db";
import { RUN_LOCK_NAME, RUN_LOCK_TTL_SECONDS } from "@/constants";

/**
 * Acquire global run lock
 *
 * Attempts to acquire the lock atomically. If lock exists and is not expired,
 * returns LOCKED. If lock is expired, takes over the lock.
 *
 * This operation is atomic and safe across processes using SQLite's
 * INSERT ... ON CONFLICT mechanism.
 *
 * @param ownerId - Unique process identifier (UUID)
 * @returns Acquisition result (ok: true if acquired, false otherwise)
 */
export function acquireRunLock(ownerId: string): RunLockAcquireResult {
  try {
    const db = getDb();

    // Atomic lock acquisition using INSERT ... ON CONFLICT
    // Strategy:
    // 1. Try to insert a new lock
    // 2. If lock exists (conflict), check if it's expired
    // 3. If expired, take it over (update)
    // 4. If not expired, the WHERE clause prevents the update
    const result = db
      .prepare(
        `
      INSERT INTO run_lock (lock_name, owner_id, acquired_at, expires_at)
      VALUES (
        ?,
        ?,
        datetime('now'),
        datetime('now', '+' || ? || ' seconds')
      )
      ON CONFLICT(lock_name) DO UPDATE SET
        owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        updated_at = datetime('now')
      WHERE datetime('now') >= expires_at
    `,
      )
      .run(RUN_LOCK_NAME, ownerId, RUN_LOCK_TTL_SECONDS);

    // Check if we acquired the lock
    // If changes > 0, we either inserted or updated (acquired)
    if (result.changes > 0) {
      return { ok: true };
    }

    // No changes means lock exists and is not expired
    return { ok: false, reason: "LOCKED" };
  } catch (err) {
    // Check if DB is not open
    if (err instanceof Error && err.message.includes("not opened")) {
      return { ok: false, reason: "DB_NOT_OPEN" };
    }

    // Other errors
    return { ok: false, reason: "UNKNOWN" };
  }
}

/**
 * Refresh run lock expiry
 *
 * Extends the lock expiry time if this process owns the lock.
 * This should be called periodically by long-running processes.
 *
 * @param ownerId - Unique process identifier (UUID)
 * @returns true if lock was refreshed, false if not owned by this process
 */
export function refreshRunLock(ownerId: string): boolean {
  try {
    const db = getDb();

    const result = db
      .prepare(
        `
      UPDATE run_lock
      SET expires_at = datetime('now', '+' || ? || ' seconds'),
          updated_at = datetime('now')
      WHERE lock_name = ?
        AND owner_id = ?
    `,
      )
      .run(RUN_LOCK_TTL_SECONDS, RUN_LOCK_NAME, ownerId);

    return result.changes > 0;
  } catch {
    return false;
  }
}

/**
 * Release run lock
 *
 * Deletes the lock row if owned by this process.
 *
 * @param ownerId - Unique process identifier (UUID)
 * @returns true if lock was released, false if not owned by this process
 */
export function releaseRunLock(ownerId: string): boolean {
  try {
    const db = getDb();

    const result = db
      .prepare(
        `
      DELETE FROM run_lock
      WHERE lock_name = ?
        AND owner_id = ?
    `,
      )
      .run(RUN_LOCK_NAME, ownerId);

    return result.changes > 0;
  } catch {
    return false;
  }
}

/**
 * Get current run lock state
 *
 * @returns Lock row if exists, null otherwise
 */
export function getRunLock(): RunLockRow | null {
  try {
    const db = getDb();

    const row = db
      .prepare("SELECT * FROM run_lock WHERE lock_name = ?")
      .get(RUN_LOCK_NAME) as RunLockRow | undefined;

    return row ?? null;
  } catch {
    return null;
  }
}
