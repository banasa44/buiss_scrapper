/**
 * HTML anchor extraction utilities
 *
 * Provides deterministic, regex-based extraction of anchor links from HTML.
 * Does not execute JavaScript or parse DOM - intentionally simple for bounded discovery.
 */

/**
 * Extract all anchor links from HTML using regex
 *
 * Matches: <a href="...">text</a> and <a href='...'>text</a>
 *
 * Note: This is intentionally simple and deterministic.
 * It will miss complex cases (multiline, attributes between href and >, etc.),
 * but that's acceptable for bounded discovery.
 *
 * @param html - Raw HTML string
 * @returns Array of anchor candidates with href and text
 */
export function extractAnchors(
  html: string,
): Array<{ href: string; text: string }> {
  const anchors: Array<{ href: string; text: string }> = [];

  // Match <a ...href="..."...>text</a> or <a ...href='...'...>text</a>
  // Non-greedy matching to avoid issues with multiple anchors on one line
  const anchorPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1].trim();
    const text = match[2]
      .replace(/<[^>]+>/g, "") // Strip inner HTML tags
      .trim();

    if (href && text) {
      anchors.push({ href, text });
    }
  }

  return anchors;
}
