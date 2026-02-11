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
  },
} as const;
