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
  CompanyAggregationInput,
} from "@/types";
import type { CompanyResolution } from "@/types";
import { getDb } from "@/db";
import { warn } from "@/logger";

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

/**
 * List company sources by provider for ingestion
 *
 * Returns company sources that:
 * - Match the specified provider
 * - Have a provider_company_id (required for ingestion)
 * - Are not hidden (hidden IS NULL OR hidden = 0)
 *
 * Used by ATS ingestion pipelines to fetch companies to process.
 *
 * @param provider - Provider identifier (e.g., "lever", "greenhouse")
 * @param limit - Maximum number of sources to return (required)
 * @returns Array of company sources ready for ingestion
 */
export function listCompanySourcesByProvider(
  provider: string,
  limit: number,
): CompanySource[] {
  const db = getDb();

  const sql = `
    SELECT *
    FROM company_sources
    WHERE provider = ?
      AND provider_company_id IS NOT NULL
      AND (hidden IS NULL OR hidden = 0)
    ORDER BY id ASC
    LIMIT ?
  `;

  return db.prepare(sql).all(provider, limit) as CompanySource[];
}

/**
 * Upsert company source keyed by (company_id, provider)
 *
 * Application-level upsert for use-cases where each company should have
 * at most one source per provider (e.g., ATS discovery).
 *
 * Conflict strategy:
 * - SELECT by (company_id, provider)
 * - If exists: UPDATE provider_company_id, provider_company_url, updated_at
 * - Else: INSERT
 *
 * Returns the company_source id.
 *
 * Note: This does NOT use the database unique constraint on
 * (provider, provider_company_id). It enforces uniqueness at the
 * application level on (company_id, provider) instead.
 */
export function upsertCompanySourceByCompanyProvider(
  input: CompanySourceInput,
): number {
  const db = getDb();

  // Check if source exists by (company_id, provider)
  const existing = db
    .prepare(
      "SELECT id FROM company_sources WHERE company_id = ? AND provider = ?",
    )
    .get(input.company_id, input.provider) as CompanySource | undefined;

  if (existing) {
    // Update existing source
    db.prepare(
      `
      UPDATE company_sources SET
        provider_company_id = ?,
        provider_company_url = ?,
        hidden = COALESCE(?, hidden),
        raw_json = COALESCE(?, raw_json),
        updated_at = datetime('now')
      WHERE id = ?
    `,
    ).run(
      input.provider_company_id ?? null,
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
        input.provider_company_id ?? null,
        input.provider_company_url ?? null,
        input.hidden ?? null,
        input.raw_json ?? null,
      );
    return result.lastInsertRowid as number;
  }
}

/**
 * Update company aggregation signals (M4)
 *
 * Performs a partial update: only updates fields present in input.
 * Deterministic and safe - does not null fields that weren't provided.
 *
 * category_max_scores is JSON-serialized before storage.
 * If serialization fails, logs warning and stores null.
 *
 * Returns the updated company record.
 *
 * @throws Error if company does not exist
 */
export function updateCompanyAggregation(
  companyId: number,
  input: CompanyAggregationInput,
): Company {
  const db = getDb();

  // Verify company exists
  const existing = getCompanyById(companyId);
  if (!existing) {
    throw new Error(
      `Cannot update aggregation: company id ${companyId} does not exist`,
    );
  }

  // Build dynamic UPDATE query for provided fields only
  const updates: string[] = [];
  const values: (number | string | null)[] = [];

  if (input.max_score !== undefined) {
    updates.push("max_score = ?");
    values.push(input.max_score);
  }
  if (input.offer_count !== undefined) {
    updates.push("offer_count = ?");
    values.push(input.offer_count);
  }
  if (input.unique_offer_count !== undefined) {
    updates.push("unique_offer_count = ?");
    values.push(input.unique_offer_count);
  }
  if (input.strong_offer_count !== undefined) {
    updates.push("strong_offer_count = ?");
    values.push(input.strong_offer_count);
  }
  if (input.avg_strong_score !== undefined) {
    updates.push("avg_strong_score = ?");
    values.push(input.avg_strong_score);
  }
  if (input.top_category_id !== undefined) {
    updates.push("top_category_id = ?");
    values.push(input.top_category_id);
  }
  if (input.top_offer_id !== undefined) {
    updates.push("top_offer_id = ?");
    values.push(input.top_offer_id);
  }
  if (input.category_max_scores !== undefined) {
    // Serialize object to JSON
    let serialized: string | null = null;
    if (input.category_max_scores !== null) {
      try {
        serialized = JSON.stringify(input.category_max_scores);
      } catch (err) {
        warn("Failed to serialize category_max_scores, storing null", {
          companyId,
          error: String(err),
        });
        serialized = null;
      }
    }
    updates.push("category_max_scores = ?");
    values.push(serialized);
  }
  if (input.last_strong_at !== undefined) {
    updates.push("last_strong_at = ?");
    values.push(input.last_strong_at);
  }

  // Always update updated_at
  updates.push("updated_at = datetime('now')");

  // Build and execute query
  if (updates.length > 0) {
    const sql = `UPDATE companies SET ${updates.join(", ")} WHERE id = ?`;
    values.push(companyId);
    db.prepare(sql).run(...values);
  }

  // Return updated company
  const updated = getCompanyById(companyId);
  if (!updated) {
    throw new Error(
      `Company disappeared during aggregation update: id ${companyId}`,
    );
  }
  return updated;
}

/**
 * Update company resolution (M6 feedback lifecycle)
 *
 * Updates the resolution field for a company based on client feedback from Google Sheets.
 * Idempotent: no-op if the resolution is already set to the target value.
 *
 * Per M6 lifecycle specification, this field controls:
 * - Whether offers should be deleted (when resolved)
 * - Whether new offers should be ingested (blocked if resolved)
 * - Company lifecycle state (active vs resolved)
 *
 * @param companyId - Company ID to update
 * @param resolution - New resolution value from feedback
 * @returns Number of rows updated (0 if already set, 1 if changed)
 * @throws Error if company does not exist
 */
export function updateCompanyResolution(
  companyId: number,
  resolution: CompanyResolution,
): number {
  const db = getDb();

  // Verify company exists
  const existing = getCompanyById(companyId);
  if (!existing) {
    throw new Error(
      `Cannot update resolution: company id ${companyId} does not exist`,
    );
  }

  // Update resolution (idempotent - no-op if already set)
  // M6.BUILD-10 GUARANTEE: This UPDATE touches ONLY resolution and updated_at.
  // Metric columns (max_score, offer_count, unique_offer_count, strong_offer_count,
  // avg_strong_score, top_category_id, top_offer_id, category_max_scores, last_strong_at)
  // are explicitly excluded to preserve historical aggregates.
  const result = db
    .prepare(
      `
    UPDATE companies
    SET resolution = ?, updated_at = datetime('now')
    WHERE id = ? AND resolution != ?
  `,
    )
    .run(resolution, companyId, resolution);

  return result.changes;
}

/**
 * List all companies with optional pagination
 *
 * Default ordering: id ASC (deterministic, chronological insertion order)
 * No filtering applied - returns all companies in the database.
 *
 * @param options - Optional pagination parameters
 * @param options.limit - Maximum number of companies to return
 * @param options.offset - Number of companies to skip
 * @returns Array of companies
 */
export function listAllCompanies(options?: {
  limit?: number;
  offset?: number;
}): Company[] {
  const db = getDb();

  let sql = "SELECT * FROM companies ORDER BY id ASC";

  // Apply pagination if provided
  if (options?.limit !== undefined) {
    sql += ` LIMIT ${options.limit}`;
  }
  if (options?.offset !== undefined) {
    sql += ` OFFSET ${options.offset}`;
  }

  return db.prepare(sql).all() as Company[];
}

/**
 * List companies needing ATS discovery
 *
 * Returns companies that:
 * - Have a website_url (not null)
 * - Do NOT have a company_source with provider 'lever' or 'greenhouse'
 *
 * Used by ATS discovery batch runner to find candidates.
 *
 * @param limit - Maximum number of companies to return (required)
 * @returns Array of companies needing ATS discovery
 */
export function listCompaniesNeedingAtsDiscovery(limit: number): Company[] {
  const db = getDb();

  const sql = `
    SELECT c.*
    FROM companies c
    WHERE c.website_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM company_sources cs
        WHERE cs.company_id = c.id
          AND cs.provider IN ('lever', 'greenhouse')
      )
    ORDER BY c.id ASC
    LIMIT ?
  `;

  return db.prepare(sql).all(limit) as Company[];
}
