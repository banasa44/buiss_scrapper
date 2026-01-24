/**
 * Companies repository
 *
 * Data access layer for companies table.
 */

import type { Company, CompanyInput } from "@/types";
import { getDb } from "../connection";

/**
 * Upsert a company based on unique constraints
 *
 * Strategy:
 * - If provider_company_id is present: upsert on (provider, provider_company_id)
 * - If provider_company_id is null: upsert on (provider, normalized_name)
 *
 * Returns the company id (existing or newly inserted)
 */
export function upsertCompany(input: CompanyInput): number {
  const db = getDb();

  // Determine which unique constraint to use
  const useProviderId = input.provider_company_id != null;

  if (useProviderId) {
    // Upsert on (provider, provider_company_id)
    db.prepare(
      `
      INSERT INTO companies (provider, provider_company_id, name, normalized_name, hidden)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_company_id) DO UPDATE SET
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        hidden = excluded.hidden,
        updated_at = datetime('now')
    `,
    ).run(
      input.provider,
      input.provider_company_id,
      input.name ?? null,
      input.normalized_name ?? null,
      input.hidden ?? null,
    );

    // Get the id
    const row = db
      .prepare(
        "SELECT id FROM companies WHERE provider = ? AND provider_company_id = ?",
      )
      .get(input.provider, input.provider_company_id) as Company;
    return row.id;
  } else {
    // Use normalized_name for dedupe
    if (!input.normalized_name) {
      throw new Error(
        "Either provider_company_id or normalized_name must be provided",
      );
    }

    // Upsert on (provider, normalized_name)
    db.prepare(
      `
      INSERT INTO companies (provider, provider_company_id, name, normalized_name, hidden)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, normalized_name) DO UPDATE SET
        name = excluded.name,
        hidden = excluded.hidden,
        updated_at = datetime('now')
    `,
    ).run(
      input.provider,
      null,
      input.name ?? null,
      input.normalized_name,
      input.hidden ?? null,
    );

    // Get the id
    const row = db
      .prepare(
        "SELECT id FROM companies WHERE provider = ? AND normalized_name = ?",
      )
      .get(input.provider, input.normalized_name) as Company;
    return row.id;
  }
}

/**
 * Get company by id
 */
export function getCompanyById(id: number): Company | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as
    | Company
    | undefined;
}
