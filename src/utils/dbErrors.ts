/**
 * Database error utilities
 *
 * Helpers for identifying and classifying database errors.
 */

/**
 * Check if an error is a SQLite UNIQUE constraint violation
 *
 * SQLite reports constraint violations with messages starting with:
 * "UNIQUE constraint failed: table_name.column_name"
 *
 * @param err - Error object to check
 * @returns true if error is a UNIQUE constraint violation
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  return err.message.startsWith("UNIQUE constraint failed:");
}
