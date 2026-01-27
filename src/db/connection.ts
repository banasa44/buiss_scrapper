/**
 * SQLite database connection
 *
 * Manages database connection lifecycle and configuration.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

let db: Database.Database | null = null;

/**
 * Get database file path from environment or default
 */
function getDbPath(): string {
  const defaultPath = join(process.cwd(), "data", "app.db");
  const dbPath = process.env.DB_PATH || defaultPath;

  // Ensure parent directory exists (skip for :memory:)
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
  }

  return dbPath;
}

/**
 * Open database connection with required pragmas
 * Returns existing connection if already open
 */
export function openDb(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Enable foreign keys (SQLite default is OFF)
  db.pragma("foreign_keys = ON");

  // WAL mode for better concurrency (optional but recommended)
  db.pragma("journal_mode = WAL");

  return db;
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Get current database connection (must be opened first)
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not opened. Call openDb() first.");
  }
  return db;
}

/**
 * Set database connection for testing purposes only.
 * This allows injecting a test database into the singleton.
 *
 * @internal Test use only - do not use in production code
 */
export function setDbForTesting(testDb: Database.Database | null): void {
  db = testDb;
}
