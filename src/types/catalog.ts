/**
 * Catalog type definitions
 *
 * The catalog is the central keyword/phrase configuration for
 * detecting USD/FX exposure signals in job offers.
 *
 * Two forms exist:
 * - CatalogRaw: JSON shape (deserialized from file)
 * - CatalogRuntime: Compiled form optimized for matching
 */

/**
 * Category definition from catalog JSON.
 *
 * Categories group keywords and define signal strength via tier.
 * Tier 3 = strongest USD signal, Tier 1 = contextual only.
 */
export type CategoryRaw = {
  /** Unique category identifier (e.g., "cat_cloud_infra") */
  id: string;
  /** Human-readable category name */
  name: string;
  /** Signal strength tier (1-3, where 3 is strongest) */
  tier: 1 | 2 | 3;
};

/**
 * Keyword definition from catalog JSON.
 *
 * Keywords detect specific technologies/services.
 * All aliases map to the same keyword and category.
 */
export type KeywordRaw = {
  /** Unique keyword identifier (e.g., "kw_aws") */
  id: string;
  /** Category this keyword belongs to */
  categoryId: string;
  /** Canonical display name for this keyword */
  canonical: string;
  /** Normalized tokens that activate this keyword (after text normalization) */
  aliases: string[];
};

/**
 * Phrase definition from catalog JSON.
 *
 * Phrases are multi-word expressions that provide scoring boosts.
 * They are matched as consecutive token sequences.
 */
export type PhraseRaw = {
  /** Unique phrase identifier (e.g., "phrase_usd") */
  id: string;
  /** The phrase text (before normalization) */
  phrase: string;
  /** Signal strength tier (1-3, where 3 is strongest) */
  tier: 1 | 2 | 3;
};

/**
 * Raw catalog structure as deserialized from JSON.
 *
 * This is the input format for validation.
 */
export type CatalogRaw = {
  /** Catalog version (semantic versioning) */
  version: string;
  /** List of category definitions */
  categories: CategoryRaw[];
  /** List of keyword definitions */
  keywords: KeywordRaw[];
  /** List of phrase definitions */
  phrases: PhraseRaw[];
};

/**
 * Runtime category representation.
 *
 * Optimized for fast lookups during matching.
 */
export type CategoryRuntime = {
  /** Unique category identifier */
  id: string;
  /** Human-readable category name */
  name: string;
  /** Signal strength tier (1-3) */
  tier: 1 | 2 | 3;
};

/**
 * Runtime keyword representation.
 *
 * Each alias is stored as a normalized token sequence.
 * Multi-word aliases are preserved (e.g., "amazon web services" → ["amazon", "web", "services"]).
 */
export type KeywordRuntime = {
  /** Unique keyword identifier */
  id: string;
  /** Category this keyword belongs to */
  categoryId: string;
  /** Canonical display name */
  canonical: string;
  /** Normalized token sequence for this alias (e.g., ["amazon", "web", "services"]) */
  aliasTokens: string[];
};

/**
 * Runtime phrase representation.
 *
 * Phrase text is pre-normalized into tokens for matching.
 */
export type PhraseRuntime = {
  /** Unique phrase identifier */
  id: string;
  /** Normalized token sequence for matching */
  tokens: string[];
  /** Signal strength tier (1-3) */
  tier: 1 | 2 | 3;
};

/**
 * Compiled catalog optimized for runtime matching.
 *
 * Provides fast lookups:
 * - Categories by ID (Map)
 * - Keywords as array with normalized alias token sequences
 * - Phrases as array for sequential matching
 */
export type CatalogRuntime = {
  /** Catalog version */
  version: string;
  /** Categories indexed by ID for fast lookup */
  categories: Map<string, CategoryRuntime>;
  /** Keywords indexed by normalized token */
  keywords: KeywordRuntime[];
  /** Phrases with pre-normalized tokens */
  phrases: PhraseRuntime[];
};
