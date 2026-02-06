/**
 * Query registry constants
 *
 * Constants for query key generation and registry configuration.
 */

/**
 * Number of characters to use from the hash in query keys
 * Full hash is sha256 (64 hex chars), we truncate for readability
 */
export const QUERY_KEY_HASH_LENGTH = 12;
