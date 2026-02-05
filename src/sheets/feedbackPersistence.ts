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
import { updateCompanyResolution } from "@/db/repos/companiesRepo";
import { deleteOffersByCompanyId } from "@/db/repos/offersRepo";
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

  // Single summary log at end
  logger.info("Feedback changes persisted to DB", {
    attempted: result.attempted,
    updated: result.updated,
    failed: result.failed,
    skipped: result.skipped,
    destructiveCount: plan.destructiveCount,
    reversalCount: plan.reversalCount,
    informationalCount: plan.informationalCount,
    offerDeletionAttempted: result.offerDeletionAttempted,
    offersDeleted: result.offersDeleted,
    offerDeletionsFailed: result.offerDeletionsFailed,
  });

  return result;
}
