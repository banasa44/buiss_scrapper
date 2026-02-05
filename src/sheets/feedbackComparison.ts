/**
 * Feedback Comparison Layer — DB vs Sheet diff/planning logic
 *
 * Compares current DB company resolutions with sheet feedback.
 * Produces a deterministic change plan (no destructive actions).
 *
 * Part of M6 – Sheets Feedback Loop & Company Lifecycle
 */

import type {
  CompanyResolution,
  FeedbackChange,
  FeedbackChangePlan,
  CompanyFeedbackReadResult,
} from "@/types";
import { listAllCompanies } from "@/db/repos/companiesRepo";
import * as logger from "@/logger";

/**
 * Load current company resolutions from database
 *
 * Returns a map of company_id -> resolution (or null if not set).
 *
 * Note: Until BUILD-6 adds the resolution field to the companies table,
 * this will return an empty resolution (null) for all companies.
 * The comparison logic will still work correctly - it will treat all
 * sheet resolutions as "changes" until the DB field is added.
 *
 * @returns Map of company_id to current resolution
 */
function loadCompanyResolutionsFromDb(): Map<number, CompanyResolution | null> {
  const companies = listAllCompanies();
  const resolutionMap = new Map<number, CompanyResolution | null>();

  for (const company of companies) {
    // TODO: Once BUILD-6 adds the resolution field to companies table,
    // read it here. For now, all companies have null resolution.
    // Safe casting: the field doesn't exist yet, so it will be undefined
    const resolution = (company as any).resolution as
      | CompanyResolution
      | null
      | undefined;
    resolutionMap.set(company.id, resolution ?? null);
  }

  logger.debug("Loaded company resolutions from DB", {
    totalCompanies: companies.length,
  });

  return resolutionMap;
}

/**
 * Build feedback change plan by comparing sheet data against DB state
 *
 * Compares resolution values from Google Sheets with current DB values.
 * Produces a deterministic plan listing what needs to change.
 *
 * Defensive behavior:
 * - Unknown company_id in sheet -> ignored + warned
 * - No change needed (sheet == DB) -> counted but not in changes list
 * - Never throws for data issues (only for fatal DB errors)
 *
 * Determinism guarantee:
 * - Changes are sorted by companyId ascending for stable output
 * - Same input always produces identical output
 *
 * @param sheetFeedback - Result from readCompanyFeedbackFromSheet
 * @returns FeedbackChangePlan with diff and statistics
 */
export function buildFeedbackChangePlan(
  sheetFeedback: CompanyFeedbackReadResult,
): FeedbackChangePlan {
  logger.debug("Building feedback change plan", {
    totalSheetRows: sheetFeedback.totalRows,
    validSheetRows: sheetFeedback.validRows,
  });

  // Load current DB state
  const dbResolutions = loadCompanyResolutionsFromDb();

  // Process each company from sheet
  const changes: FeedbackChange[] = [];
  let knownCompanyIds = 0;
  let unknownCompanyIds = 0;
  let changesDetected = 0;
  let unchanged = 0;

  for (const [companyId, toResolution] of Object.entries(sheetFeedback.map)) {
    const companyIdNum = Number(companyId);

    // Check if company exists in DB
    if (!dbResolutions.has(companyIdNum)) {
      logger.warn("Unknown company_id in sheet feedback, ignoring", {
        companyId: companyIdNum,
        resolution: toResolution,
      });
      unknownCompanyIds++;
      continue;
    }

    knownCompanyIds++;
    const fromResolution = dbResolutions.get(companyIdNum) ?? null;

    // Compare: does resolution need to change?
    if (fromResolution !== toResolution) {
      changes.push({
        companyId: companyIdNum,
        fromResolution,
        toResolution,
      });
      changesDetected++;
    } else {
      unchanged++;
    }
  }

  // Sort changes by companyId for deterministic output
  changes.sort((a, b) => a.companyId - b.companyId);

  logger.info("Feedback change plan built", {
    totalSheetRows: sheetFeedback.totalRows,
    knownCompanyIds,
    unknownCompanyIds,
    changesDetected,
    unchanged,
    invalidRows: sheetFeedback.invalidRows,
  });

  return {
    changes,
    totalSheetRows: sheetFeedback.totalRows,
    knownCompanyIds,
    unknownCompanyIds,
    changesDetected,
    unchanged,
    invalidRows: sheetFeedback.invalidRows,
  };
}
