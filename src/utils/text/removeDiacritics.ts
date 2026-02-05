/**
 * Removes diacritics from a string using Unicode normalization.
 *
 * Uses NFD (Canonical Decomposition) to separate base characters from
 * combining diacritical marks, then removes the marks (U+0300-U+036F).
 * This approach is more comprehensive than manual mapping.
 *
 * @param text - Input text with potential diacritics
 * @returns Text with diacritics replaced by ASCII characters
 *
 * @example
 * removeDiacritics("café") // "cafe"
 * removeDiacritics("niño") // "nino"
 * removeDiacritics("José") // "Jose"
 */
const DIACRITIC_MARKS_PATTERN = /[\u0300-\u036f]/g;

export function removeDiacritics(text: string): string {
  return text.normalize("NFD").replace(DIACRITIC_MARKS_PATTERN, "");
}
