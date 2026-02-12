/**
 * Feedback Persistence Layer — apply validated feedback changes to DB
 *
 * Persists resolution changes from Google Sheets feedback into the database.
 * Best-effort strategy: logs warnings on individual failures but continues processing.
 * Idempotent: safe to re-run without side effects.
 *
 * Part of M6 – Sheets Feedback Loop & Company Lifecycle (BUILD-7 + BUILD-8)
 */

import type { ValidatedFeedbackPlan, ApplyFeedbackResult } from "@/types";
import type { NewCompanyFeedbackEvent } from "@/types";
import { updateCompanyResolution } from "@/db/repos/companiesRepo";
import { deleteOffersByCompanyId } from "@/db/repos/offersRepo";
import { insertCompanyFeedbackEvent } from "@/db/repos/feedbackEventsRepo";
import * as logger from "@/logger";

/**
 * Apply validated feedback changes to database
 *
 * Persists resolution updates for all changes in the validated plan:
 * - destructiveChanges (transitions TO resolved states) → deletes offers
 * - reversalChanges (transitions FROM resolved back to active)
 * - informationalChanges (transitions between active states)
 *
 * Best-effort behavior:
 * - Individual failures are logged as warnings but do not stop processing
 * - Returns structured counters for observability
 * - Idempotent: updateCompanyResolution is no-op if value unchanged
 *
 * Per M6 specification: when a company transitions to RESOLVED state,
 * all offers for that company are immediately deleted (matches cascade).
 *
 * M6.BUILD-10 METRICS PRESERVATION GUARANTEE:
 * This function NEVER modifies company metrics or aggregates. Only operations:
 * - updateCompanyResolution(): touches ONLY companies.resolution (+ updated_at)
 * - deleteOffersByCompanyId(): removes offers/matches, does NOT update companies table
 * All historical metrics (max_score, offer_count, category_max_scores, etc.) are preserved.
 *
 * @param plan - Validated feedback plan from validateFeedbackChangePlan()
 * @returns Structured result with counters
 */
export function applyValidatedFeedbackPlanToDb(
  plan: ValidatedFeedbackPlan,
): ApplyFeedbackResult {
  const result: ApplyFeedbackResult = {
    attempted: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    offerDeletionAttempted: 0,
    offersDeleted: 0,
    offerDeletionsFailed: 0,
  };

  // Process all change types: destructive, reversal, informational
  const allChanges = [
    ...plan.destructiveChanges,
    ...plan.reversalChanges,
    ...plan.informationalChanges,
  ];

  for (const change of allChanges) {
    result.attempted++;

    try {
      // Update resolution (idempotent - returns 0 if no change, 1 if updated)
      const rowsChanged = updateCompanyResolution(
        change.companyId,
        change.toResolution,
      );

      if (rowsChanged > 0) {
        result.updated++;
      } else {
        // No rows changed = value was already set (idempotent no-op)
        result.skipped++;
      }
    } catch (err) {
      // Best-effort: log warning and continue
      result.failed++;
      logger.warn("Failed to update company resolution", {
        companyId: change.companyId,
        fromResolution: change.fromResolution,
        toResolution: change.toResolution,
        error: String(err),
      });
    }
  }

  // Step 2: Delete offers for destructive changes (transitions TO resolved)
  // Per M6: RESOLVED states = ACCEPTED | REJECTED | ALREADY_REVOLUT
  for (const change of plan.destructiveChanges) {
    result.offerDeletionAttempted++;

    try {
      const deletedCount = deleteOffersByCompanyId(change.companyId);
      result.offersDeleted += deletedCount;

      if (deletedCount > 0) {
        logger.debug("Offers deleted for resolved company", {
          companyId: change.companyId,
          resolution: change.toResolution,
          offersDeleted: deletedCount,
        });
      }
    } catch (err) {
      // Best-effort: log warning and continue
      result.offerDeletionsFailed++;
      logger.warn("Failed to delete offers for resolved company", {
        companyId: change.companyId,
        resolution: change.toResolution,
        error: String(err),
      });
    }
  }

  // TODO M6.BUILD-11: Add detailed audit logging for:
  //   - Companies resolved (with resolution type breakdown)
  //   - Companies reverted to PENDING
  //   - Deletions performed (offer counts per company)
  //   - Ignored rows (invalid/unknown company IDs)
  //   - Structured counters for observability

  // Note: Final audit logging done in runOfferBatch.ts per BUILD-11
  // (comprehensive feedback section log with all counters)

  return result;
}

/**
 * Result of persisting model feedback events to database
 */
export type PersistModelFeedbackResult = {
  /** Total number of feedback events attempted to persist */
  attempted: number;
  /** Number of events successfully persisted */
  persisted: number;
  /** Number of events that failed to persist */
  failed: number;
};

/**
 * Persist model performance feedback events to database
 *
 * Inserts feedback events from MODEL_FEEDBACK and MODEL_NOTES columns
 * into the company_feedback_events table.
 *
 * Best-effort behavior:
 * - Individual failures are logged as warnings but do not stop processing
 * - Returns structured counters for observability
 * - NOT idempotent: each call creates new events (by design for time-series tracking)
 *
 * @param events - Array of feedback events to persist
 * @returns Structured result with counters
 */
export function persistModelFeedbackEvents(
  events: NewCompanyFeedbackEvent[],
): PersistModelFeedbackResult {
  const result: PersistModelFeedbackResult = {
    attempted: 0,
    persisted: 0,
    failed: 0,
  };

  for (const event of events) {
    result.attempted++;

    try {
      insertCompanyFeedbackEvent(event);
      result.persisted++;
    } catch (err) {
      // Best-effort: log warning and continue
      result.failed++;
      logger.warn("Failed to persist model feedback event", {
        companyId: event.companyId,
        feedbackValue: event.feedbackValue,
        error: String(err),
      });
    }
  }

  logger.info("Model feedback persistence complete", {
    attempted: result.attempted,
    persisted: result.persisted,
    failed: result.failed,
  });

  return result;
}
