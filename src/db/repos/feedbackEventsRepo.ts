/**
 * Company Feedback Events repository
 *
 * Data access layer for company_feedback_events table.
 * Stores model performance feedback from Google Sheets.
 */

import type { CompanyFeedbackEvent, NewCompanyFeedbackEvent } from "@/types";
import { getDb } from "@/db";
import { MODEL_FEEDBACK_VALUES } from "@/constants/sheets";
import { parseModelFeedback } from "@/utils";
import * as logger from "@/logger";

/**
 * Insert a new company feedback event
 *
 * Records model performance feedback from MODEL_FEEDBACK and MODEL_NOTES columns.
 * Conflict-safe: silently ignores duplicates via UNIQUE constraint.
 * Returns the auto-generated ID of the inserted event, or 0 if duplicate.
 *
 * @param event - New feedback event to insert (omits id and createdAt)
 * @returns The ID of the inserted event, or 0 if duplicate (conflict)
 */
export function insertCompanyFeedbackEvent(
  event: NewCompanyFeedbackEvent,
): number {
  const db = getDb();

  const normalizedFeedbackValue = parseModelFeedback(event.feedbackValue);
  if (normalizedFeedbackValue === null) {
    throw new Error(
      `Invalid feedback_value "${String(event.feedbackValue)}". Expected one of: ${MODEL_FEEDBACK_VALUES.join(", ")}`,
    );
  }

  // Normalize notes to empty string (never NULL) for stable deduplication
  const normalizedNotes = event.notes ?? "";

  const result = db
    .prepare(
      `
      INSERT INTO company_feedback_events (company_id, sheet_row_index, feedback_value, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (company_id, sheet_row_index, feedback_value, notes) DO NOTHING
    `,
    )
    .run(
      event.companyId,
      event.sheetRowIndex,
      normalizedFeedbackValue,
      normalizedNotes,
    );

  return result.lastInsertRowid as number;
}

/**
 * Get all feedback events for a company (ordered newest first)
 *
 * @param companyId - Company ID to query
 * @returns Array of feedback events for this company
 */
export function getFeedbackEventsByCompanyId(
  companyId: number,
): CompanyFeedbackEvent[] {
  const db = getDb();

  const rows = db
    .prepare(
      `
      SELECT id, company_id, sheet_row_index, feedback_value, notes, created_at
      FROM company_feedback_events
      WHERE company_id = ?
      ORDER BY created_at DESC
    `,
    )
    .all(companyId) as Array<{
    id: number;
    company_id: number;
    sheet_row_index: number;
    feedback_value: string;
    notes: string | null;
    created_at: string;
  }>;

  const events: CompanyFeedbackEvent[] = [];
  let skippedInvalidRows = 0;

  for (const row of rows) {
    const normalizedFeedbackValue = parseModelFeedback(row.feedback_value);
    if (normalizedFeedbackValue === null) {
      skippedInvalidRows++;
      continue;
    }

    events.push({
      id: row.id,
      companyId: row.company_id,
      sheetRowIndex: row.sheet_row_index,
      feedbackValue: normalizedFeedbackValue,
      notes: row.notes,
      createdAt: new Date(row.created_at),
    });
  }

  if (skippedInvalidRows > 0) {
    logger.debug("Skipping invalid feedback_value rows from read query", {
      companyId,
      skippedInvalidRows,
      allowedValues: MODEL_FEEDBACK_VALUES,
    });
  }

  return events;
}
