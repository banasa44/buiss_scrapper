/**
 * Catalog validation module
 *
 * Validates catalog JSON structure and enforces invariants:
 * - No duplicate IDs
 * - All category references exist
 * - No empty strings in required fields
 * - Valid tier values
 *
 * Validation is fail-fast: throws on first error with actionable message.
 */

import type {
  CatalogRaw,
  CategoryRaw,
  KeywordRaw,
  PhraseRaw,
} from "@/types/catalog";

/**
 * Error thrown when catalog validation fails.
 *
 * Contains actionable error message identifying the problem.
 */
export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(`Catalog validation failed: ${message}`);
    this.name = "CatalogValidationError";
  }
}

/**
 * Validates that a value is a non-empty string.
 *
 * @param value - Value to check
 * @param fieldPath - Field path for error messages (e.g., "categories[0].id")
 * @throws {CatalogValidationError} If value is not a non-empty string
 */
function validateNonEmptyString(
  value: unknown,
  fieldPath: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new CatalogValidationError(
      `${fieldPath} must be a string, got ${typeof value}`,
    );
  }
  if (value.trim().length === 0) {
    throw new CatalogValidationError(
      `${fieldPath} cannot be empty or whitespace-only`,
    );
  }
}

/**
 * Validates that a value is a valid tier (1, 2, or 3).
 *
 * @param value - Value to check
 * @param fieldPath - Field path for error messages
 * @throws {CatalogValidationError} If value is not a valid tier
 */
function validateTier(
  value: unknown,
  fieldPath: string,
): asserts value is 1 | 2 | 3 {
  if (typeof value !== "number") {
    throw new CatalogValidationError(
      `${fieldPath} must be a number, got ${typeof value}`,
    );
  }
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new CatalogValidationError(
      `${fieldPath} must be 1, 2, or 3, got ${value}`,
    );
  }
}

/**
 * Validates that a value is a non-empty array.
 *
 * @param value - Value to check
 * @param fieldPath - Field path for error messages
 * @throws {CatalogValidationError} If value is not a non-empty array
 */
function validateNonEmptyArray<T>(
  value: unknown,
  fieldPath: string,
): asserts value is T[] {
  if (!Array.isArray(value)) {
    throw new CatalogValidationError(
      `${fieldPath} must be an array, got ${typeof value}`,
    );
  }
  if (value.length === 0) {
    throw new CatalogValidationError(`${fieldPath} cannot be empty`);
  }
}

/**
 * Validates a category object.
 *
 * @param category - Category to validate
 * @param index - Array index for error messages
 * @throws {CatalogValidationError} If category is invalid
 */
function validateCategory(
  category: unknown,
  index: number,
): asserts category is CategoryRaw {
  if (typeof category !== "object" || category === null) {
    throw new CatalogValidationError(`categories[${index}] must be an object`);
  }

  const cat = category as Record<string, unknown>;
  const prefix = `categories[${index}]`;

  validateNonEmptyString(cat.id, `${prefix}.id`);
  validateNonEmptyString(cat.name, `${prefix}.name`);
  validateTier(cat.tier, `${prefix}.tier`);
}

/**
 * Validates a keyword object.
 *
 * @param keyword - Keyword to validate
 * @param index - Array index for error messages
 * @throws {CatalogValidationError} If keyword is invalid
 */
function validateKeyword(
  keyword: unknown,
  index: number,
): asserts keyword is KeywordRaw {
  if (typeof keyword !== "object" || keyword === null) {
    throw new CatalogValidationError(`keywords[${index}] must be an object`);
  }

  const kw = keyword as Record<string, unknown>;
  const prefix = `keywords[${index}]`;

  validateNonEmptyString(kw.id, `${prefix}.id`);
  validateNonEmptyString(kw.categoryId, `${prefix}.categoryId`);
  validateNonEmptyString(kw.canonical, `${prefix}.canonical`);
  validateNonEmptyArray(kw.aliases, `${prefix}.aliases`);

  // Validate each alias is a non-empty string
  if (!Array.isArray(kw.aliases)) {
    throw new CatalogValidationError(`${prefix}.aliases must be an array`);
  }
  kw.aliases.forEach((alias: unknown, aliasIndex: number) => {
    validateNonEmptyString(alias, `${prefix}.aliases[${aliasIndex}]`);
  });
}

/**
 * Validates a phrase object.
 *
 * @param phrase - Phrase to validate
 * @param index - Array index for error messages
 * @throws {CatalogValidationError} If phrase is invalid
 */
function validatePhrase(
  phrase: unknown,
  index: number,
): asserts phrase is PhraseRaw {
  if (typeof phrase !== "object" || phrase === null) {
    throw new CatalogValidationError(`phrases[${index}] must be an object`);
  }

  const phr = phrase as Record<string, unknown>;
  const prefix = `phrases[${index}]`;

  validateNonEmptyString(phr.id, `${prefix}.id`);
  validateNonEmptyString(phr.phrase, `${prefix}.phrase`);
  validateTier(phr.tier, `${prefix}.tier`);
}

/**
 * Checks for duplicate IDs in a list of objects.
 *
 * @param items - Items to check
 * @param itemType - Type name for error messages (e.g., "category")
 * @throws {CatalogValidationError} If duplicates are found
 */
function checkDuplicateIds<T extends { id: string }>(
  items: T[],
  itemType: string,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new CatalogValidationError(
        `Duplicate ${itemType} ID: "${item.id}"`,
      );
    }
    seen.add(item.id);
  }
}

/**
 * Validates that all category references in keywords exist.
 *
 * @param keywords - Keywords to validate
 * @param categoryIds - Set of valid category IDs
 * @throws {CatalogValidationError} If unknown category references are found
 */
function validateCategoryReferences(
  keywords: KeywordRaw[],
  categoryIds: Set<string>,
): void {
  for (const keyword of keywords) {
    if (!categoryIds.has(keyword.categoryId)) {
      throw new CatalogValidationError(
        `Keyword "${keyword.id}" references unknown category "${keyword.categoryId}"`,
      );
    }
  }
}

/**
 * Validates raw catalog data from JSON.
 *
 * Performs comprehensive validation:
 * 1. Schema shape and types
 * 2. Non-empty required fields
 * 3. Valid tier values (1-3)
 * 4. No duplicate IDs (categories, keywords, phrases)
 * 5. All category references exist
 *
 * Validation is fail-fast: throws on first error.
 *
 * @param raw - Raw catalog data to validate
 * @returns The validated catalog (typed as CatalogRaw)
 * @throws {CatalogValidationError} With actionable error message on validation failure
 *
 * @example
 * const catalog = validateCatalogRaw(JSON.parse(jsonString));
 * // catalog is now typed as CatalogRaw and guaranteed valid
 */
export function validateCatalogRaw(raw: unknown): CatalogRaw {
  // Top-level structure check
  if (typeof raw !== "object" || raw === null) {
    throw new CatalogValidationError("Catalog must be an object");
  }

  const catalog = raw as Record<string, unknown>;

  // Validate version
  validateNonEmptyString(catalog.version, "version");

  // Validate arrays exist
  validateNonEmptyArray(catalog.categories, "categories");
  validateNonEmptyArray(catalog.keywords, "keywords");

  // Phrases array is required but can be empty in minimal catalogs
  if (!Array.isArray(catalog.phrases)) {
    throw new CatalogValidationError("phrases must be an array");
  }

  // Validate each category
  const categories = catalog.categories as unknown[];
  categories.forEach((category, index) => validateCategory(category, index));

  // Validate each keyword
  const keywords = catalog.keywords as unknown[];
  keywords.forEach((keyword, index) => validateKeyword(keyword, index));

  // Validate each phrase (if any)
  const phrases = catalog.phrases as unknown[];
  phrases.forEach((phrase, index) => validatePhrase(phrase, index));

  // Type assertions now safe
  const typedCategories = categories as CategoryRaw[];
  const typedKeywords = keywords as KeywordRaw[];
  const typedPhrases = phrases as PhraseRaw[];

  // Check for duplicate IDs
  checkDuplicateIds(typedCategories, "category");
  checkDuplicateIds(typedKeywords, "keyword");
  checkDuplicateIds(typedPhrases, "phrase");

  // Validate category references
  const categoryIds = new Set(typedCategories.map((c) => c.id));
  validateCategoryReferences(typedKeywords, categoryIds);

  // Return validated catalog
  return {
    version: catalog.version as string,
    categories: typedCategories,
    keywords: typedKeywords,
    phrases: typedPhrases,
  };
}
