/**
 * ATS Discovery constants
 *
 * Configuration and tunable parameters for ATS detection
 */

/**
 * List of supported ATS providers
 * Used as the source of truth for provider names throughout the system
 */
export const ATS_PROVIDERS = ["lever", "greenhouse"] as const;

/**
 * Known ATS domain hosts that are allowed to be followed even when external
 * These are the canonical ATS platform domains where companies host their job boards
 */
export const ATS_ALLOWED_EXTERNAL_HOSTS = [
  "jobs.lever.co",
  "api.lever.co",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards-api.greenhouse.io",
];

/**
 * Common career/jobs page path suffixes to attempt when scanning company websites
 */
export const CANDIDATE_PATHS = [
  "/careers",
  "/jobs",
  "/join-us",
  "/work-with-us",
  "/careers/jobs",
  "/jobs/",
  "/empleo",
  "/trabaja-con-nosotros",
  "/job-opportunities",
  "/job-openings",
];

/**
 * Regular expressions for detecting Lever ATS URLs and extracting tenant slugs
 * Each pattern must have a capturing group for the tenant identifier
 */
export const LEVER_PATTERNS = [
  // Pattern: jobs.lever.co/<slug>
  /https?:\/\/jobs\.lever\.co\/([a-zA-Z0-9_-]+)/i,
  // Pattern: api.lever.co/v0/postings/<slug>
  /https?:\/\/api\.lever\.co\/v0\/postings\/([a-zA-Z0-9_-]+)/i,
];

/**
 * Regular expressions for detecting Greenhouse ATS URLs and extracting tenant tokens
 * Each pattern must have a capturing group for the tenant identifier
 */
export const GREENHOUSE_PATTERNS = [
  // Pattern: boards.greenhouse.io/<token>
  /https?:\/\/boards\.greenhouse\.io\/([a-zA-Z0-9_-]+)/i,
  // Pattern: job-boards.greenhouse.io/<token>
  /https?:\/\/job-boards\.greenhouse\.io\/([a-zA-Z0-9_-]+)/i,
  // Pattern: boards-api.greenhouse.io/v1/boards/<token>/
  /https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([a-zA-Z0-9_-]+)/i,
];

/**
 * HTTP configuration for ATS discovery requests
 */
export const HTTP = {
  /** Timeout in milliseconds for each HTTP request */
  TIMEOUT_MS: 10_000,
  /** Maximum number of retry attempts for failed requests */
  MAX_ATTEMPTS: 2,
  /** HTTP headers to send with ATS discovery requests */
  HEADERS: {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 (compatible; ATS-Discovery-Bot/1.0)",
  },
};

/**
 * Limits for ATS discovery operations
 */
export const LIMITS = {
  /** Maximum number of candidate URLs to try when scanning a company website */
  MAX_CANDIDATE_URLS: 10,
  /** Maximum number of HTML characters to scan per page (to avoid processing huge payloads) */
  MAX_HTML_CHARS_TO_SCAN: 200_000,
};

/**
 * Keywords used to identify career/jobs links in HTML
 * Used for 1-hop link following to increase discovery hit-rate
 */
export const DISCOVERY_LINK_KEYWORDS = [
  "careers",
  "career",
  "jobs",
  "join",
  "join-us",
  "work-with-us",
  "empleo",
  "trabaja",
  "trabaja-con",
  "vacantes",
  "oportunidades",
  "job-openings",
  "opportunities",
];

/**
 * Configuration for following career/jobs links (1-hop only)
 */
export const LINK_FOLLOW = {
  /** Maximum number of discovered career links to follow (1-hop) */
  MAX_LINKS_TO_FOLLOW: 5,
  /** Whether to allow following links to external domains */
  ALLOW_EXTERNAL_DOMAINS: false,
  /** Maximum URL length to consider (to ignore huge tracking URLs) */
  MAX_URL_LENGTH: 300,
  /** File extensions to ignore when extracting links */
  IGNORE_EXTENSIONS: [
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".zip",
    ".tar",
    ".gz",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
  ],
};
