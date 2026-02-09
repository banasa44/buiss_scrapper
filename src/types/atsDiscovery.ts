/**
 * ATS Discovery type definitions
 *
 * Types for detecting and extracting ATS tenant identifiers from company websites
 */

import type { ATS_PROVIDERS } from "@/constants";

/**
 * Supported ATS providers
 * Derived from ATS_PROVIDERS constant for scalability
 */
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

/**
 * Detected ATS tenant information
 */
export type AtsTenant = {
  /** The ATS provider detected */
  provider: AtsProvider;
  /** The tenant identifier/slug/token extracted */
  tenantKey: string;
  /** URL where the tenant was detected (for audit/verification) */
  evidenceUrl: string;
};

/**
 * Result of an ATS discovery attempt
 */
export type AtsDiscoveryResult =
  | {
      /** No ATS detected */
      status: "not_found";
    }
  | {
      /** ATS detected successfully */
      status: "found";
      /** Detected tenant information */
      tenant: AtsTenant;
    }
  | {
      /** Discovery failed due to an error (network, parsing, etc.) */
      status: "error";
      /** Error message for logging/debugging */
      message: string;
    };

/**
 * Detection result from Lever HTML analysis
 */
export type LeverDetectionResult = {
  /** Lever tenant slug/key extracted from the URL */
  tenantKey: string;
  /** The full URL where the tenant was detected */
  evidenceUrl: string;
} | null;

/**
 * Detection result from Greenhouse HTML analysis
 */
export type GreenhouseDetectionResult = {
  /** Greenhouse tenant token/key extracted from the URL */
  tenantKey: string;
  /** The full URL where the tenant was detected */
  evidenceUrl: string;
} | null;

/**
 * Detection result from fetching and analyzing a URL
 * Used by fetchAndDetect helper to return structured results
 */
export type DetectionResult = {
  /** ATS provider detected */
  provider: AtsProvider;
  /** Tenant identifier extracted */
  tenantKey: string;
  /** URL where the tenant was detected */
  evidenceUrl: string;
} | null;
