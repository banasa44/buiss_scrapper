/**
 * Feedback Validation Layer — classify changes by lifecycle impact
 *
 * Pure validation logic that categorizes feedback changes according to
 * M6 resolution semantics without performing any DB or lifecycle actions.
 *
 * Part of M6 – Sheets Feedback Loop & Company Lifecycle
 */

import type {
  FeedbackChangePlan,
  ValidatedFeedbackPlan,
  ValidatedFeedbackChange,
  CompanyResolution,
} from "@/types";
import { RESOLVED_RESOLUTIONS, ACTIVE_RESOLUTIONS } from "@/constants";
import * as logger from "@/logger";

/**
 * Check if a resolution is in the "resolved" category
 * Resolved = ALREADY_REVOLUT | ACCEPTED | REJECTED
 *
 * @param resolution - Resolution value to check
 * @returns true if resolution triggers lifecycle actions
 */
function isResolved(resolution: CompanyResolution | null): boolean {
  if (resolution === null) return false;
  return (RESOLVED_RESOLUTIONS as readonly string[]).includes(resolution);
}

/**
 * Check if a resolution is in the "active" category
 * Active = PENDING | IN_PROGRESS | HIGH_INTEREST
 *
 * @param resolution - Resolution value to check
 * @returns true if resolution is informational only
 */
function isActive(resolution: CompanyResolution | null): boolean {
  if (resolution === null) return true; // null treated as PENDING (active)
  return (ACTIVE_RESOLUTIONS as readonly string[]).includes(resolution);
}

/**
 * Classify a feedback change based on lifecycle impact
 *
 * Classification rules (per M6 lifecycle spec):
 * - Destructive: transition TO resolved (active/null → ACCEPTED|REJECTED|ALREADY_REVOLUT)
 *   → requires offer deletion
 * - Reversal: transition FROM resolved back to active (ACCEPTED|REJECTED|ALREADY_REVOLUT → active)
 *   → requires state reset (but offers already deleted, so just update resolution)
 * - Informational: transition between active states only (active ↔ active)
 *   → no lifecycle impact, just update resolution
 *
 * @param change - Feedback change to classify
 * @returns Classification category
 */
function classifyChange(
  change: FeedbackChangePlan["changes"][0],
): ValidatedFeedbackChange["classification"] {
  const fromIsResolved = isResolved(change.fromResolution);
  const toIsResolved = isResolved(change.toResolution);

  if (!fromIsResolved && toIsResolved) {
    // Active/null → Resolved = destructive (delete offers)
    return "destructive";
  } else if (fromIsResolved && !toIsResolved) {
    // Resolved → Active = reversal (undo resolution)
    return "reversal";
  } else {
    // Active ↔ Active OR Resolved ↔ Resolved = informational only
    return "informational";
  }
}

/**
 * Validate feedback change plan and classify by lifecycle impact
 *
 * Pure function that categorizes changes without performing any actions.
 * Splits the change plan into:
 * - Destructive changes (require offer deletion)
 * - Reversal changes (require resolution reset)
 * - Informational changes (no lifecycle impact)
 *
 * Determinism guarantee:
 * - Output is stable and reproducible
 * - Changes within each category are sorted by companyId
 *
 * @param plan - Feedback change plan from BUILD-2
 * @returns Validated plan with classified changes
 */
export function validateFeedbackChangePlan(
  plan: FeedbackChangePlan,
): ValidatedFeedbackPlan {
  const destructiveChanges: ValidatedFeedbackChange[] = [];
  const reversalChanges: ValidatedFeedbackChange[] = [];
  const informationalChanges: ValidatedFeedbackChange[] = [];

  // Classify each change
  for (const change of plan.changes) {
    const classification = classifyChange(change);
    const validatedChange: ValidatedFeedbackChange = {
      ...change,
      classification,
    };

    switch (classification) {
      case "destructive":
        destructiveChanges.push(validatedChange);
        break;
      case "reversal":
        reversalChanges.push(validatedChange);
        break;
      case "informational":
        informationalChanges.push(validatedChange);
        break;
    }
  }

  // Sort each category by companyId for deterministic output
  destructiveChanges.sort((a, b) => a.companyId - b.companyId);
  reversalChanges.sort((a, b) => a.companyId - b.companyId);
  informationalChanges.sort((a, b) => a.companyId - b.companyId);

  const result: ValidatedFeedbackPlan = {
    destructiveChanges,
    reversalChanges,
    informationalChanges,
    totalChanges: plan.changes.length,
    destructiveCount: destructiveChanges.length,
    reversalCount: reversalChanges.length,
    informationalCount: informationalChanges.length,
  };

  logger.info("Feedback change plan validated", {
    totalChanges: result.totalChanges,
    destructiveCount: result.destructiveCount,
    reversalCount: result.reversalCount,
    informationalCount: result.informationalCount,
  });

  return result;
}
