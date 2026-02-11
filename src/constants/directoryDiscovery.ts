/**
 * Directory Discovery configuration constants
 *
 * This module contains configuration for discovering companies from
 * public startup directories (e.g., Catalonia Hub, Madrid+D, Lanzadera).
 */

/**
 * Seed URLs for company directories
 */
export const DIRECTORY_DISCOVERY = {
  SEED_URLS: {
    CATALONIA: "https://startupshub.catalonia.com/list-of-startups",
    MADRIMASD:
      "https://startups.madrimasd.org/emprendedores/emprendedores-casos-exito/nuevas-empresas-madrid",
    LANZADERA: "https://lanzadera.es/proyectos/",
  },

  TUNABLES: {
    /**
     * Maximum number of companies to fetch per directory source
     */
    MAX_COMPANIES_PER_SOURCE: 50,

    /**
     * Maximum number of pages to crawl per directory source
     */
    MAX_PAGES_PER_SOURCE: 3,

    /**
     * Maximum URL length to accept (filtering out malformed URLs)
     */
    MAX_URL_LENGTH: 2048,

    /**
     * File extensions to ignore when extracting URLs
     */
    IGNORE_EXTENSIONS: [".pdf", ".jpg", ".jpeg", ".png", ".zip", ".gif"],

    /**
     * Domains to exclude when discovering companies
     * (social networks, aggregators, and directory-specific internal domains)
     */
    EXCLUDED_DOMAINS: [
      "linkedin.com",
      "twitter.com",
      "facebook.com",
      "instagram.com",
      "youtube.com",
      "github.com",
      "startupshub.catalonia.com",
    ],

    /**
     * Configuration for multi-step directory discovery
     * (listing page → detail pages → company websites)
     */
    DETAIL_FETCH: {
      /**
       * Maximum number of detail pages to fetch per source
       * (defaults to same as MAX_COMPANIES_PER_SOURCE)
       */
      MAX_DETAIL_PAGES: 50,

      /**
       * URL path patterns that identify company detail pages
       * Each source can specify which internal paths to follow
       */
      DETAIL_PATH_PATTERNS: {
        MADRIMASD: "/emprendedores/empresa/detalle/",
        // Note: Lanzadera uses custom structural matching (not pattern-based)
        // Pattern would be too broad ("/proyectos/") and match listing itself
      },

      /**
       * Enable fetching internal detail pages to extract external websites
       * Set to false to only extract direct external links from listing pages
       */
      ALLOW_INTERNAL_DETAIL_FETCH: true,

      /**
       * Maximum number of external website URLs to extract per detail page
       * (prevents unbounded extraction, typically 1 for company directories)
       */
      MAX_WEBSITES_PER_DETAIL: 1,
    },
  },
} as const;
