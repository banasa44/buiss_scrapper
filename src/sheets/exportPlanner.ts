/**
 * Export planner for company sheets
 *
 * Orchestrates fetching companies from DB and mapping them to sheet rows.
 * Returns an in-memory "plan" structure without performing any Sheets writes.
 *
 * This is a preparation step for the actual export operation.
 */

import type { CatalogRuntime, ExportPlan } from "@/types";
import { listAllCompanies, getOfferUrlById } from "@/db";
import { mapCompanyToSheetRow } from "./companyRowMapper";
import { warn } from "@/logger";

/**
 * Build export plan: fetch companies from DB and map to sheet rows
 *
 * Process:
 * 1. Fetch all companies from DB (ordered by id ASC)
 * 2. Map each company to sheet row format
 * 3. Skip companies that fail mapping (log warning)
 * 4. Return array of rows ready for Sheets API append
 *
 * No side effects: does not write to Sheets, only prepares data.
 *
 * @param catalog - Compiled catalog for category label resolution
 * @returns Export plan with rows ready for append
 */
export function buildExportPlan(catalog: CatalogRuntime): ExportPlan {
  // Step 1: Fetch all companies from DB
  const companies = listAllCompanies();

  // Step 2: Map each company to sheet row
  const rowsForAppend: (string | number)[][] = [];

  for (const company of companies) {
    try {
      // Fetch top offer URL if top_offer_id exists
      const topOfferUrl = company.top_offer_id
        ? getOfferUrlById(company.top_offer_id)
        : null;

      const row = mapCompanyToSheetRow(company, catalog, topOfferUrl);
      rowsForAppend.push(row);
    } catch (err) {
      // Skip unmappable companies (log + continue)
      warn("Failed to map company to sheet row, skipping", {
        companyId: company.id,
        companyName: company.name_display ?? company.normalized_name,
        error: String(err),
      });
    }
  }

  return { rowsForAppend };
}
