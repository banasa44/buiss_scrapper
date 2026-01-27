/**
 * Test Database Harness
 *
 * Creates fresh temporary SQLite databases per test.
 * Runs real migrations, provides DB handle, handles cleanup.
 *
 * Usage:
 *   const harness = await createTestDb();
 *   // ... use harness.db for repos ...
 *   await harness.cleanup();
 */

import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setDbForTesting } from "@/db";

export interface TestDbHarness {
  /** The SQLite database connection */
  db: Database.Database;
  /** Path to the temp database file */
  dbPath: string;
  /** Clean up: close connection and delete temp file */
  cleanup: () => void;
}

/**
 * Ensure schema_migrations table exists
 */
function ensureMigrationsTable(db: Database.Database): void {
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
function getAppliedMigrations(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as {
    version: string;
  }[];
  return new Set(rows.map((r) => r.version));
}

/**
 * Get all migration files from migrations/ directory
 */
function getAllMigrations(): string[] {
  const migrationsDir = join(process.cwd(), "migrations");

  let files: string[];
  try {
    files = readdirSync(migrationsDir);
  } catch {
    return [];
  }

  return files.filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Apply a single migration file atomically
 */
function applyMigration(db: Database.Database, filename: string): void {
  const migrationsDir = join(process.cwd(), "migrations");
  const filepath = join(migrationsDir, filename);
  const sql = readFileSync(filepath, "utf-8");

  const transaction = db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(
      filename,
    );
  });

  transaction();
}

/**
 * Run all pending migrations on the given database
 */
function runMigrationsOnDb(db: Database.Database): void {
  ensureMigrationsTable(db);

  const appliedMigrations = getAppliedMigrations(db);
  const allMigrations = getAllMigrations();

  for (const migration of allMigrations) {
    if (!appliedMigrations.has(migration)) {
      applyMigration(db, migration);
    }
  }
}

/**
 * Generate a unique temp file path for a test database
 */
function generateTempDbPath(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const filename = `test-${timestamp}-${random}.db`;
  const tempDir = join(tmpdir(), "buiss-scrapper-tests");

  // Ensure temp directory exists
  mkdirSync(tempDir, { recursive: true });

  return join(tempDir, filename);
}

/**
 * Create a fresh test database with all migrations applied.
 *
 * Returns a harness object with:
 * - db: The database connection
 * - dbPath: Path to the temp file
 * - cleanup(): Function to close and delete the database
 *
 * IMPORTANT: Always call cleanup() after test completes.
 *
 * The harness injects the test DB into the production singleton,
 * so repos work transparently with the test database.
 */
export async function createTestDb(): Promise<TestDbHarness> {
  const dbPath = generateTempDbPath();

  // Create new database
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Run all migrations
  runMigrationsOnDb(db);

  // Inject into production singleton so repos work
  setDbForTesting(db);

  const cleanup = () => {
    // Clear the singleton first
    setDbForTesting(null);

    try {
      db.close();
    } catch {
      // Ignore close errors
    }

    try {
      rmSync(dbPath, { force: true });
      // Also try to remove WAL files if they exist
      rmSync(dbPath + "-wal", { force: true });
      rmSync(dbPath + "-shm", { force: true });
    } catch {
      // Ignore file deletion errors
    }
  };

  return { db, dbPath, cleanup };
}

/**
 * Synchronous version of createTestDb for simpler test setup
 */
export function createTestDbSync(): TestDbHarness {
  const dbPath = generateTempDbPath();

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  runMigrationsOnDb(db);

  // Inject into production singleton so repos work
  setDbForTesting(db);

  const cleanup = () => {
    // Clear the singleton first
    setDbForTesting(null);

    try {
      db.close();
    } catch {
      // Ignore close errors
    }

    try {
      rmSync(dbPath, { force: true });
      rmSync(dbPath + "-wal", { force: true });
      rmSync(dbPath + "-shm", { force: true });
    } catch {
      // Ignore file deletion errors
    }
  };

  return { db, dbPath, cleanup };
}
