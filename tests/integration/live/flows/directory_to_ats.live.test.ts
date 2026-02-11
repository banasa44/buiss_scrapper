/**
 * LIVE Integration Smoke Test — Directory -> ATS Discovery -> ATS Ingestion
 *
 * Single-company, single-provider (Lever) end-to-end smoke path with real network:
 * 1) Persist one hardcoded company via ingestDirectorySources
 * 2) Run ATS discovery
 * 3) Run Lever ingestion pipeline
 * 4) Verify offers persisted with non-empty descriptions
 * 5) Verify idempotency on rerun
 *
 * This test is intentionally small and gated behind LIVE_ATS_TEST=1.
 */

// Load .env for local development convenience
import "dotenv/config";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ingestDirectorySources } from "@/companySources";
import { runAtsDiscoveryBatch } from "@/atsDiscovery";
import { runLeverPipeline } from "@/ingestion/pipelines";
import {
  closeDb,
  getDb,
  listCompanySourcesByProvider,
  openDb,
  runMigrations,
} from "@/db";
import type { CompanyDirectorySource } from "@/interfaces";

const isLiveTestEnabled = process.env.LIVE_ATS_TEST === "1";
const describeIf = isLiveTestEnabled ? describe : describe.skip;

describeIf("LIVE: directory -> ATS (Lever) smoke", () => {
  let dbPath: string;
  let originalDbPath: string | undefined;

  // Chosen for stability: rackspace.com careers currently links to Lever
  // tenant "rackspace" (jobs.lever.co/rackspace), used in existing fixtures too.
  const COMPANY_WEBSITE_URL = "https://www.rackspace.com";
  const COMPANY_DOMAIN = "rackspace.com";

  beforeEach(() => {
    closeDb();

    originalDbPath = process.env.DB_PATH;
    const tempDir = mkdtempSync(join(tmpdir(), "buiss-live-ats-"));
    dbPath = join(tempDir, "live_ats_smoke.db");
    process.env.DB_PATH = dbPath;

    // migrate/verify pattern: run migrations first, then open real DB connection
    runMigrations();
    openDb();
  });

  afterEach(() => {
    closeDb();

    if (originalDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = originalDbPath;
    }

    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(join(dbPath, ".."), { recursive: true, force: true });
  });

  it(
    "should discover one Lever tenant and persist non-empty offers idempotently",
    { timeout: 120000 },
    async () => {
      // Stage 1: "directory" ingestion with one hardcoded source to reduce flakiness
      const liveDirectorySource: CompanyDirectorySource = {
        id: "LIVE_SMOKE_SINGLE_COMPANY",
        seedUrl: COMPANY_WEBSITE_URL,
        fetchCompanies: async () => [
          {
            name_raw: "Rackspace",
            name_display: "Rackspace",
            normalized_name: "rackspace",
            website_url: COMPANY_WEBSITE_URL,
            website_domain: COMPANY_DOMAIN,
          },
        ],
      };

      const directoryResult = await ingestDirectorySources([liveDirectorySource]);
      expect(directoryResult.total.upserted).toBe(1);

      const db = getDb();
      const companyRow = db
        .prepare(
          "SELECT id, website_url, website_domain FROM companies WHERE website_domain = ?",
        )
        .get(COMPANY_DOMAIN) as
        | { id: number; website_url: string | null; website_domain: string }
        | undefined;

      expect(companyRow).toBeDefined();
      expect(companyRow?.website_url).toBe(COMPANY_WEBSITE_URL);

      // Stage 2: ATS discovery (bounded to 1 company)
      const discovery = await runAtsDiscoveryBatch({ limit: 1 });
      expect(discovery.checked).toBe(1);
      expect(discovery.found).toBe(1);
      expect(discovery.persisted).toBe(1);

      const leverSources = listCompanySourcesByProvider("lever", 1);
      expect(leverSources).toHaveLength(1);
      expect(leverSources[0].company_id).toBe(companyRow?.id);
      expect(leverSources[0].provider_company_id).toBeTruthy();

      // Stage 3: ATS ingestion (single tenant limit)
      const firstRun = await runLeverPipeline({ limit: 1 });
      expect((firstRun.result.upserted ?? 0) + (firstRun.result.skipped ?? 0)).toBeGreaterThan(0);

      const offersAfterFirstRun = db
        .prepare(
          `
          SELECT id, description
          FROM offers
          WHERE company_id = ? AND provider = 'lever'
          ORDER BY id ASC
        `,
        )
        .all(companyRow!.id) as Array<{ id: number; description: string | null }>;

      expect(offersAfterFirstRun.length).toBeGreaterThan(0);

      for (const offer of offersAfterFirstRun) {
        expect(offer.description).toBeTruthy();
        expect(offer.description!.trim().length).toBeGreaterThan(0);
      }

      // Stage 4: idempotency on rerun (no new rows)
      const countBeforeRerun = offersAfterFirstRun.length;
      await runLeverPipeline({ limit: 1 });

      const countAfterRerun = (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM offers WHERE company_id = ? AND provider = 'lever'",
          )
          .get(companyRow!.id) as { count: number }
      ).count;

      expect(countAfterRerun).toBe(countBeforeRerun);
    },
  );
});

if (!isLiveTestEnabled) {
  console.log(
    "LIVE ATS smoke test skipped (set LIVE_ATS_TEST=1 to enable real network run)",
  );
}
