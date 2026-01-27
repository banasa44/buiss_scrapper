/**
 * Companies repository
 *
 * Data access layer for companies and company_sources tables.
 * Implements global company identity resolution per docs/M1/03_define_company_id.md
 */

import type {
  Company,
  CompanyInput,
  CompanySource,
  CompanySourceInput,
} from "@/types";
import { getDb } from "@/db";

/**
 * Upsert a global company based on identity evidence
 *
 * Identity resolution order:
 * 1. website_domain (strongest signal) - if present
 * 2. normalized_name (fallback) - if domain not present
 * 3. If neither present - throws error (caller must skip offer)
 *
 * Returns the company id (existing or newly inserted)
 *
 * @throws Error if neither website_domain nor normalized_name is provided
 */
export function upsertCompany(input: CompanyInput): number {
  const db = getDb();

  // Validate: must have either website_domain or normalized_name
  if (!input.website_domain && !input.normalized_name) {
    throw new Error(
      "Cannot upsert company: neither website_domain nor normalized_name provided. " +
        "Company identity cannot be determined.",
    );
  }

  // Strategy 1: Use website_domain if present (strongest identity)
  if (input.website_domain) {
    // Check if company exists by domain
    const existing = db
      .prepare("SELECT id FROM companies WHERE website_domain = ?")
      .get(input.website_domain) as Company | undefined;

    if (existing) {
      // Update existing company (enrich fields but don't overwrite with null)
      db.prepare(
        `
        UPDATE companies SET
          name_raw = COALESCE(?, name_raw),
          name_display = COALESCE(?, name_display),
          normalized_name = COALESCE(?, normalized_name),
          website_url = COALESCE(?, website_url),
          updated_at = datetime('now')
        WHERE id = ?
      `,
      ).run(
        input.name_raw ?? null,
        input.name_display ?? null,
        input.normalized_name ?? null,
        input.website_url ?? null,
        existing.id,
      );
      return existing.id;
    } else {
      // Insert new company
      const result = db
        .prepare(
          `
        INSERT INTO companies (name_raw, name_display, normalized_name, website_url, website_domain)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(
          input.name_raw ?? null,
          input.name_display ?? null,
          input.normalized_name ?? null,
          input.website_url ?? null,
          input.website_domain,
        );
      return result.lastInsertRowid as number;
    }
  }

  // Strategy 2: Use normalized_name (fallback identity)
  // Check if company exists by normalized_name
  const existing = db
    .prepare("SELECT id FROM companies WHERE normalized_name = ?")
    .get(input.normalized_name) as Company | undefined;

  if (existing) {
    // Update existing company (enrich fields but don't overwrite with null)
    db.prepare(
      `
      UPDATE companies SET
        name_raw = COALESCE(?, name_raw),
        name_display = COALESCE(?, name_display),
        website_url = COALESCE(?, website_url),
        website_domain = COALESCE(?, website_domain),
        updated_at = datetime('now')
      WHERE id = ?
    `,
    ).run(
      input.name_raw ?? null,
      input.name_display ?? null,
      input.website_url ?? null,
      input.website_domain ?? null,
      existing.id,
    );
    return existing.id;
  } else {
    // Insert new company
    const result = db
      .prepare(
        `
      INSERT INTO companies (name_raw, name_display, normalized_name, website_url, website_domain)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.name_raw ?? null,
        input.name_display ?? null,
        input.normalized_name,
        input.website_url ?? null,
        input.website_domain ?? null,
      );
    return result.lastInsertRowid as number;
  }
}

/**
 * Upsert a company source (provider-specific company data)
 *
 * Links a global company to a provider-specific identifier.
 * Conflict strategy:
 * - If provider_company_id exists: upsert on (provider, provider_company_id)
 * - Otherwise: insert without conflict handling (allows multiple sources per provider)
 *
 * Returns the company_source id
 */
export function upsertCompanySource(input: CompanySourceInput): number {
  const db = getDb();

  if (input.provider_company_id) {
    // Check if source exists by (provider, provider_company_id)
    const existing = db
      .prepare(
        "SELECT id FROM company_sources WHERE provider = ? AND provider_company_id = ?",
      )
      .get(input.provider, input.provider_company_id) as
      | CompanySource
      | undefined;

    if (existing) {
      // Update existing source
      db.prepare(
        `
        UPDATE company_sources SET
          company_id = ?,
          provider_company_url = COALESCE(?, provider_company_url),
          hidden = COALESCE(?, hidden),
          raw_json = COALESCE(?, raw_json),
          updated_at = datetime('now')
        WHERE id = ?
      `,
      ).run(
        input.company_id,
        input.provider_company_url ?? null,
        input.hidden ?? null,
        input.raw_json ?? null,
        existing.id,
      );
      return existing.id;
    } else {
      // Insert new source
      const result = db
        .prepare(
          `
        INSERT INTO company_sources (company_id, provider, provider_company_id, provider_company_url, hidden, raw_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          input.company_id,
          input.provider,
          input.provider_company_id,
          input.provider_company_url ?? null,
          input.hidden ?? null,
          input.raw_json ?? null,
        );
      return result.lastInsertRowid as number;
    }
  } else {
    // No provider_company_id - just insert
    // Multiple sources per (company_id, provider) are allowed
    const result = db
      .prepare(
        `
      INSERT INTO company_sources (company_id, provider, provider_company_id, provider_company_url, hidden, raw_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.company_id,
        input.provider,
        null,
        input.provider_company_url ?? null,
        input.hidden ?? null,
        input.raw_json ?? null,
      );
    return result.lastInsertRowid as number;
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

/**
 * Get company source by id
 */
export function getCompanySourceById(id: number): CompanySource | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM company_sources WHERE id = ?").get(id) as
    | CompanySource
    | undefined;
}

/**
 * Get company sources for a company
 */
export function getCompanySourcesByCompanyId(
  companyId: number,
): CompanySource[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM company_sources WHERE company_id = ?")
    .all(companyId) as CompanySource[];
}
