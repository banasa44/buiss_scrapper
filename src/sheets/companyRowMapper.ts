/**
 * Company to sheet row mapper (pure function)
 *
 * Maps Company DB entity to Google Sheets row format following the
 * schema defined in BUILD-3B1_selected_metric_columns.md
 *
 * Pure function: no side effects, deterministic output given inputs.
 */

import type { Company } from "@/types/db";
import type { CatalogRuntime } from "@/types/catalog";
import {
  DEFAULT_RESOLUTION,
  SCORE_DECIMAL_PLACES,
  NO_NAME_PLACEHOLDER,
} from "@/constants/sheets";

/**
 * Map Company DB row to Google Sheets row array
 *
 * Schema order (10 columns):
 * 1. company_id - Company ID (integer)
 * 2. company_name - Display name with fallback chain
 * 3. resolution - Client feedback (default: "PENDING")
 * 4. max_score - Highest relevance score (0-10, 1 decimal)
 * 5. strong_offers - Count of high-quality offers (score >= 6)
 * 6. unique_offers - Count of canonical offers
 * 7. posting_activity - Activity-weighted posting count
 * 8. avg_strong_score - Average score of strong offers (1 decimal)
 * 9. top_category - Human-readable category label
 * 10. last_strong_at - Most recent strong offer date (YYYY-MM-DD)
 *
 * Null handling:
 * - Numeric metrics: empty string if null
 * - Category: empty string if null or lookup fails
 * - Timestamp: empty string if null
 *
 * @param company - Company DB entity with aggregation signals
 * @param catalog - Compiled catalog for category label resolution
 * @returns Array of primitive values suitable for Sheets API
 */
export function mapCompanyToSheetRow(
  company: Company,
  catalog: CatalogRuntime,
): (string | number)[] {
  // 1. company_id (always present, primary key)
  const companyId = company.id;

  // 2. company_name (fallback chain: name_display > normalized_name > placeholder)
  const companyName =
    company.name_display ?? company.normalized_name ?? NO_NAME_PLACEHOLDER;

  // 3. resolution (default for new rows)
  const resolution = DEFAULT_RESOLUTION;

  // 4. max_score (format with 1 decimal, empty if null)
  const maxScore = formatScore(company.max_score);

  // 5. strong_offers (empty if null)
  const strongOffers = company.strong_offer_count ?? "";

  // 6. unique_offers (empty if null)
  const uniqueOffers = company.unique_offer_count ?? "";

  // 7. posting_activity (renamed from offer_count, empty if null)
  const postingActivity = company.offer_count ?? "";

  // 8. avg_strong_score (format with 1 decimal, empty if null)
  const avgStrongScore = formatScore(company.avg_strong_score);

  // 9. top_category (resolve to human-readable label, fallback to raw ID or empty)
  const topCategory = resolveCategoryLabel(company.top_category_id, catalog);

  // 10. last_strong_at (extract date only YYYY-MM-DD, empty if null)
  const lastStrongAt = formatDateOnly(company.last_strong_at);

  return [
    companyId,
    companyName,
    resolution,
    maxScore,
    strongOffers,
    uniqueOffers,
    postingActivity,
    avgStrongScore,
    topCategory,
    lastStrongAt,
  ];
}

/**
 * Format numeric score with fixed decimal places
 *
 * @param score - Score value (0-10) or null
 * @returns Formatted string with 1 decimal or empty string if null
 */
function formatScore(score: number | null): string {
  if (score === null) {
    return "";
  }
  return score.toFixed(SCORE_DECIMAL_PLACES);
}

/**
 * Resolve category ID to human-readable label from catalog
 *
 * Fallback order:
 * 1. Catalog lookup (preferred)
 * 2. Raw category ID if lookup fails
 * 3. Empty string if category ID is null
 *
 * @param categoryId - Category ID from DB (nullable)
 * @param catalog - Compiled catalog with category map
 * @returns Human-readable label, raw ID, or empty string
 */
function resolveCategoryLabel(
  categoryId: string | null,
  catalog: CatalogRuntime,
): string {
  if (!categoryId) {
    return "";
  }

  const category = catalog.categories.get(categoryId);
  if (category) {
    return category.name;
  }

  // Fallback to raw ID if catalog lookup fails
  return categoryId;
}

/**
 * Extract date portion from ISO 8601 timestamp (YYYY-MM-DD)
 *
 * Converts "2026-01-30T12:00:00Z" to "2026-01-30"
 * Returns empty string if timestamp is null or invalid
 *
 * @param timestamp - ISO 8601 timestamp string or null
 * @returns Date string in YYYY-MM-DD format or empty string
 */
function formatDateOnly(timestamp: string | null): string {
  if (!timestamp) {
    return "";
  }

  // Extract YYYY-MM-DD portion (first 10 characters of ISO format)
  // Valid ISO 8601: "2026-01-30T12:00:00Z" -> "2026-01-30"
  const match = timestamp.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) {
    return match[0];
  }

  // Fallback: if format doesn't match, return empty (invalid timestamp)
  return "";
}
