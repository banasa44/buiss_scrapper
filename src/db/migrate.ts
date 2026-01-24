/**
 * Database migration runner
 *
 * Applies SQL migrations from migrations/ directory in order.
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { openDb, closeDb } from "./connection";

/**
 * Ensure schema_migrations table exists
 */
function ensureMigrationsTable(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Get list of applied migrations
 */
function getAppliedMigrations(db: any): Set<string> {
  const rows = db.prepare("SELECT version FROM schema_migrations").all();
  return new Set(rows.map((r: any) => r.version));
}

/**
 * Get pending migrations from migrations/ directory
 */
function getPendingMigrations(appliedMigrations: Set<string>): string[] {
  const migrationsDir = join(process.cwd(), "migrations");

  let files: string[];
  try {
    files = readdirSync(migrationsDir);
  } catch (err) {
    // No migrations directory yet
    return [];
  }

  const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

  return sqlFiles.filter((f) => !appliedMigrations.has(f));
}

/**
 * Apply a single migration file atomically
 */
function applyMigration(db: any, filename: string): void {
  const migrationsDir = join(process.cwd(), "migrations");
  const filepath = join(migrationsDir, filename);
  const sql = readFileSync(filepath, "utf-8");

  // Wrap migration + recording in a transaction
  const transaction = db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(
      filename,
    );
  });

  transaction();
}

/**
 * Run all pending migrations
 */
export function runMigrations(): void {
  const db = openDb();

  try {
    ensureMigrationsTable(db);

    const appliedMigrations = getAppliedMigrations(db);
    const pendingMigrations = getPendingMigrations(appliedMigrations);

    if (pendingMigrations.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    console.log(`Applying ${pendingMigrations.length} migration(s)...`);

    for (const migration of pendingMigrations) {
      console.log(`  Applying ${migration}...`);
      applyMigration(db, migration);
    }

    console.log("Migrations complete.");
  } finally {
    closeDb();
  }
}

/**
 * Smoke test: verify database is accessible
 */
export function smokeTest(): void {
  const db = openDb();
  const result = db.prepare("SELECT 1 as value").get();
  console.log("Smoke test passed:", result);
}

/**
 * CLI entrypoint
 */
if (require.main === module) {
  runMigrations();
}
