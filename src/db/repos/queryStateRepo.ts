/**
 * Query state repository
 *
 * Data access layer for query_state table (M7).
 * Manages per-query operational state for scheduled execution.
 */

import type {
  QueryStateRow,
  QueryStateInput,
  QueryStateListOptions,
  QueryStateStatus,
} from "@/types";
import { getDb } from "@/db";

/**
 * Get query state by query key
 *
 * @param queryKey - Unique query identifier
 * @returns Query state row or null if not found
 */
export function getQueryState(queryKey: string): QueryStateRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM query_state WHERE query_key = ?")
    .get(queryKey) as QueryStateRow | undefined;

  return row ?? null;
}

/**
 * Upsert query state
 *
 * Creates or updates query state. All fields except query_key are optional.
 * On update, only provided fields are modified (null values are stored as-is).
 *
 * @param input - Query state data (query_key required, rest optional)
 */
export function upsertQueryState(input: QueryStateInput): void {
  const db = getDb();

  // Check if record exists
  const existing = getQueryState(input.query_key);

  if (existing) {
    // Update existing record
    const fields: string[] = [];
    const values: any[] = [];

    if (input.client !== undefined) {
      fields.push("client = ?");
      values.push(input.client);
    }
    if (input.name !== undefined) {
      fields.push("name = ?");
      values.push(input.name);
    }
    if (input.status !== undefined) {
      fields.push("status = ?");
      values.push(input.status);
    }
    if (input.last_run_at !== undefined) {
      fields.push("last_run_at = ?");
      values.push(input.last_run_at);
    }
    if (input.last_success_at !== undefined) {
      fields.push("last_success_at = ?");
      values.push(input.last_success_at);
    }
    if (input.last_error_at !== undefined) {
      fields.push("last_error_at = ?");
      values.push(input.last_error_at);
    }
    if (input.last_processed_date !== undefined) {
      fields.push("last_processed_date = ?");
      values.push(input.last_processed_date);
    }
    if (input.consecutive_failures !== undefined) {
      fields.push("consecutive_failures = ?");
      values.push(input.consecutive_failures);
    }
    if (input.error_code !== undefined) {
      fields.push("error_code = ?");
      values.push(input.error_code);
    }
    if (input.error_message !== undefined) {
      fields.push("error_message = ?");
      values.push(input.error_message);
    }

    // Always update updated_at
    fields.push("updated_at = datetime('now')");

    if (fields.length > 1) {
      // More than just updated_at
      values.push(input.query_key);
      const sql = `UPDATE query_state SET ${fields.join(", ")} WHERE query_key = ?`;
      db.prepare(sql).run(...values);
    } else {
      // Only updated_at changed
      db.prepare(
        "UPDATE query_state SET updated_at = datetime('now') WHERE query_key = ?",
      ).run(input.query_key);
    }
  } else {
    // Insert new record
    db.prepare(
      `
      INSERT INTO query_state (
        query_key,
        client,
        name,
        status,
        last_run_at,
        last_success_at,
        last_error_at,
        last_processed_date,
        consecutive_failures,
        error_code,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      input.query_key,
      input.client ?? "",
      input.name ?? "",
      input.status ?? "IDLE",
      input.last_run_at ?? null,
      input.last_success_at ?? null,
      input.last_error_at ?? null,
      input.last_processed_date ?? null,
      input.consecutive_failures ?? 0,
      input.error_code ?? null,
      input.error_message ?? null,
    );
  }
}

/**
 * List query states with optional filtering
 *
 * @param options - Filter options (client)
 * @returns Array of query state rows
 */
export function listQueryStates(
  options: QueryStateListOptions = {},
): QueryStateRow[] {
  const db = getDb();

  if (options.client) {
    return db
      .prepare("SELECT * FROM query_state WHERE client = ? ORDER BY query_key")
      .all(options.client) as QueryStateRow[];
  }

  return db
    .prepare("SELECT * FROM query_state ORDER BY query_key")
    .all() as QueryStateRow[];
}

/**
 * Mark query as running
 *
 * Sets status to RUNNING and updates last_run_at timestamp.
 *
 * @param queryKey - Unique query identifier
 * @param timestamp - ISO 8601 timestamp (defaults to SQLite now)
 */
export function markQueryRunning(queryKey: string, timestamp?: string): void {
  const db = getDb();

  if (timestamp) {
    db.prepare(
      `
      UPDATE query_state
      SET status = 'RUNNING',
          last_run_at = ?,
          updated_at = datetime('now')
      WHERE query_key = ?
    `,
    ).run(timestamp, queryKey);
  } else {
    db.prepare(
      `
      UPDATE query_state
      SET status = 'RUNNING',
          last_run_at = datetime('now'),
          updated_at = datetime('now')
      WHERE query_key = ?
    `,
    ).run(queryKey);
  }
}

/**
 * Mark query as successful
 *
 * Sets status to SUCCESS, updates last_success_at, resets consecutive_failures,
 * and optionally updates last_processed_date.
 *
 * @param queryKey - Unique query identifier
 * @param timestamp - ISO 8601 timestamp (defaults to SQLite now)
 * @param options - Additional options (lastProcessedDate)
 */
export function markQuerySuccess(
  queryKey: string,
  timestamp?: string,
  options: { lastProcessedDate?: string } = {},
): void {
  const db = getDb();

  if (timestamp) {
    db.prepare(
      `
      UPDATE query_state
      SET status = 'SUCCESS',
          last_success_at = ?,
          consecutive_failures = 0,
          error_code = NULL,
          error_message = NULL,
          last_processed_date = COALESCE(?, last_processed_date),
          updated_at = datetime('now')
      WHERE query_key = ?
    `,
    ).run(timestamp, options.lastProcessedDate ?? null, queryKey);
  } else {
    db.prepare(
      `
      UPDATE query_state
      SET status = 'SUCCESS',
          last_success_at = datetime('now'),
          consecutive_failures = 0,
          error_code = NULL,
          error_message = NULL,
          last_processed_date = COALESCE(?, last_processed_date),
          updated_at = datetime('now')
      WHERE query_key = ?
    `,
    ).run(options.lastProcessedDate ?? null, queryKey);
  }
}

/**
 * Mark query as errored
 *
 * Sets status to ERROR, updates last_error_at, increments consecutive_failures,
 * and stores error details.
 *
 * @param queryKey - Unique query identifier
 * @param timestamp - ISO 8601 timestamp (defaults to SQLite now)
 * @param options - Error details (errorCode, errorMessage)
 */
export function markQueryError(
  queryKey: string,
  timestamp?: string,
  options: { errorCode?: string; errorMessage?: string } = {},
): void {
  const db = getDb();

  if (timestamp) {
    db.prepare(
      `
      UPDATE query_state
      SET status = 'ERROR',
          last_error_at = ?,
          consecutive_failures = consecutive_failures + 1,
          error_code = ?,
          error_message = ?,
          updated_at = datetime('now')
      WHERE query_key = ?
    `,
    ).run(
      timestamp,
      options.errorCode ?? null,
      options.errorMessage ?? null,
      queryKey,
    );
  } else {
    db.prepare(
      `
      UPDATE query_state
      SET status = 'ERROR',
          last_error_at = datetime('now'),
          consecutive_failures = consecutive_failures + 1,
          error_code = ?,
          error_message = ?,
          updated_at = datetime('now')
      WHERE query_key = ?
    `,
    ).run(options.errorCode ?? null, options.errorMessage ?? null, queryKey);
  }
}

/**
 * Reset consecutive failures counter
 *
 * Useful for manual intervention or recovery scenarios.
 *
 * @param queryKey - Unique query identifier
 */
export function resetConsecutiveFailures(queryKey: string): void {
  const db = getDb();
  db.prepare(
    `
    UPDATE query_state
    SET consecutive_failures = 0,
        updated_at = datetime('now')
    WHERE query_key = ?
  `,
  ).run(queryKey);
}

/**
 * Set query status
 *
 * Direct status update without side effects on other fields.
 *
 * @param queryKey - Unique query identifier
 * @param status - New status value
 */
export function setQueryStatus(
  queryKey: string,
  status: QueryStateStatus,
): void {
  const db = getDb();
  db.prepare(
    `
    UPDATE query_state
    SET status = ?,
        updated_at = datetime('now')
    WHERE query_key = ?
  `,
  ).run(status, queryKey);
}
