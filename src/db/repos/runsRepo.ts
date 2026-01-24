/**
 * Ingestion runs repository
 *
 * Data access layer for ingestion_runs table.
 */

import type {
  IngestionRun,
  IngestionRunInput,
  IngestionRunUpdate,
} from "@/types";
import { getDb } from "../connection";

/**
 * Create a new ingestion run
 * Returns the run id
 */
export function createRun(input: IngestionRunInput): number {
  const db = getDb();

  const result = db
    .prepare(
      `
    INSERT INTO ingestion_runs (provider, query_fingerprint)
    VALUES (?, ?)
  `,
    )
    .run(input.provider, input.query_fingerprint ?? null);

  return result.lastInsertRowid as number;
}

/**
 * Update/finish an ingestion run
 */
export function finishRun(runId: number, update: IngestionRunUpdate): void {
  const db = getDb();

  const fields: string[] = [];
  const values: any[] = [];

  if (update.finished_at !== undefined) {
    fields.push("finished_at = ?");
    values.push(update.finished_at);
  }
  if (update.status !== undefined) {
    fields.push("status = ?");
    values.push(update.status ?? null);
  }
  if (update.pages_fetched !== undefined) {
    fields.push("pages_fetched = ?");
    values.push(update.pages_fetched ?? null);
  }
  if (update.offers_fetched !== undefined) {
    fields.push("offers_fetched = ?");
    values.push(update.offers_fetched ?? null);
  }
  if (update.requests_count !== undefined) {
    fields.push("requests_count = ?");
    values.push(update.requests_count ?? null);
  }
  if (update.http_429_count !== undefined) {
    fields.push("http_429_count = ?");
    values.push(update.http_429_count ?? null);
  }
  if (update.errors_count !== undefined) {
    fields.push("errors_count = ?");
    values.push(update.errors_count ?? null);
  }
  if (update.notes !== undefined) {
    fields.push("notes = ?");
    values.push(update.notes ?? null);
  }

  if (fields.length === 0) {
    return; // Nothing to update
  }

  values.push(runId);

  const sql = `UPDATE ingestion_runs SET ${fields.join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...values);
}

/**
 * Get run by id
 */
export function getRunById(id: number): IngestionRun | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM ingestion_runs WHERE id = ?").get(id) as
    | IngestionRun
    | undefined;
}
