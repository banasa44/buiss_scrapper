/**
 * Catalog loading and compilation
 *
 * Loads the catalog JSON, validates it, and compiles it into
 * a runtime-optimized structure for fast matching.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  CatalogRaw,
  CatalogRuntime,
  CategoryRuntime,
  KeywordRuntime,
  PhraseRuntime,
} from "@/types/catalog";
import { validateCatalogRaw } from "@/utils/catalogValidation";
import { normalizeToTokens } from "@/utils/textNormalization";
import { CATALOG_PATH } from "@/constants/catalog";

/**
 * Error thrown when catalog compilation fails.
 */
export class CatalogCompilationError extends Error {
  constructor(message: string) {
    super(`Catalog compilation failed: ${message}`);
    this.name = "CatalogCompilationError";
  }
}

/**
 * Compiles a validated raw catalog into runtime form.
 *
 * Compilation steps:
 * 1. Build category lookup map
 * 2. Expand keyword aliases into normalized tokens
 * 3. Normalize phrases into token sequences
 * 4. Validate that all aliases/phrases produce at least one token
 * 5. Deduplicate identical normalized aliases within each keyword
 *
 * @param raw - Validated raw catalog
 * @returns Compiled runtime catalog
 * @throws {CatalogCompilationError} If compilation fails
 */
function compileCatalog(raw: CatalogRaw): CatalogRuntime {
  // Build category map
  const categories = new Map<string, CategoryRuntime>();
  for (const cat of raw.categories) {
    categories.set(cat.id, {
      id: cat.id,
      name: cat.name,
      tier: cat.tier,
    });
  }

  // Compile keywords - preserve each alias as a token sequence
  const keywords: KeywordRuntime[] = [];
  for (const kw of raw.keywords) {
    // Normalize all aliases and deduplicate by token sequence
    const seenAliases = new Set<string>();
    for (const alias of kw.aliases) {
      const tokens = normalizeToTokens(alias);
      if (tokens.length === 0) {
        throw new CatalogCompilationError(
          `Keyword "${kw.id}" has alias "${alias}" that normalizes to zero tokens`,
        );
      }
      // Deduplicate by joining tokens (e.g., "amazon|web|services")
      const aliasKey = tokens.join("|");
      if (!seenAliases.has(aliasKey)) {
        seenAliases.add(aliasKey);
        keywords.push({
          id: kw.id,
          categoryId: kw.categoryId,
          canonical: kw.canonical,
          aliasTokens: tokens,
        });
      }
    }
  }

  // Compile phrases - normalize into token sequences
  const phrases: PhraseRuntime[] = [];
  for (const phr of raw.phrases) {
    const tokens = normalizeToTokens(phr.phrase);
    if (tokens.length === 0) {
      throw new CatalogCompilationError(
        `Phrase "${phr.id}" has text "${phr.phrase}" that normalizes to zero tokens`,
      );
    }
    phrases.push({
      id: phr.id,
      tokens,
      tier: phr.tier,
    });
  }

  return {
    version: raw.version,
    categories,
    keywords,
    phrases,
  };
}

/**
 * Loads and compiles the catalog from the configured path.
 *
 * This is the main entry point for catalog loading.
 * The function is fail-fast: any validation or compilation error will throw.
 *
 * Steps:
 * 1. Read catalog JSON file
 * 2. Parse JSON
 * 3. Validate schema and invariants
 * 4. Compile to runtime structure
 *
 * @returns Compiled catalog ready for matching
 * @throws {Error} If file cannot be read
 * @throws {SyntaxError} If JSON is malformed
 * @throws {CatalogValidationError} If validation fails
 * @throws {CatalogCompilationError} If compilation fails
 *
 * @example
 * const catalog = loadCatalog();
 * console.log(`Loaded ${catalog.keywords.length} keywords`);
 */
export function loadCatalog(): CatalogRuntime {
  // Resolve path relative to project root
  const catalogPath = path.resolve(process.cwd(), CATALOG_PATH);

  // Read file
  const jsonContent = fs.readFileSync(catalogPath, "utf-8");

  // Parse JSON
  const raw = JSON.parse(jsonContent);

  // Validate
  const validated = validateCatalogRaw(raw);

  // Compile
  return compileCatalog(validated);
}
