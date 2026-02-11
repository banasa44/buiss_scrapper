/**
 * GreenhouseAtsJobOffersClient — API client for Greenhouse ATS
 *
 * Implements the AtsJobOffersClient interface for Greenhouse provider.
 * Fetches job postings scoped to a specific company board token.
 */

import type { AtsJobOffersClient } from "@/interfaces";
import type {
  Provider,
  SearchOffersResult,
  JobOfferSummary,
  JobOfferDetail,
  HttpRequest,
} from "@/types";
import type { GreenhouseJobsResponse } from "@/types/clients/greenhouse";
import { httpRequest as defaultHttpRequest } from "@/clients/http";
import {
  GREENHOUSE_API_BASE_URL,
  GREENHOUSE_HTTP_TIMEOUT_MS,
  GREENHOUSE_HTTP_MAX_ATTEMPTS,
  GREENHOUSE_HTTP_HEADERS,
  GREENHOUSE_LIMITS,
} from "@/constants";
import { mapGreenhouseJobToSummary, mapGreenhouseJobToDetail } from "./mappers";
import * as logger from "@/logger";

/**
 * HTTP request function type for dependency injection
 */
type HttpRequestFn = <T>(req: HttpRequest) => Promise<T>;

export interface GreenhouseAtsJobOffersClientConfig {
  /**
   * Optional HTTP request function (for testing/mocking)
   * Defaults to production httpRequest implementation
   */
  httpRequest?: HttpRequestFn;
}

/**
 * Greenhouse ATS implementation of AtsJobOffersClient
 */
export class GreenhouseAtsJobOffersClient implements AtsJobOffersClient {
  readonly provider: Provider = "greenhouse";
  private readonly httpRequest: HttpRequestFn;

  constructor(config?: GreenhouseAtsJobOffersClientConfig) {
    this.httpRequest = config?.httpRequest ?? defaultHttpRequest;
  }

  /**
   * List all active job offers for a Greenhouse board token
   *
   * Fetches jobs from Greenhouse's Job Board API and maps to canonical types.
   * Applies deterministic ordering (by job.id ascending) and bounded limits.
   * Returns empty results on error (logs failure but does not throw).
   *
   * @param boardToken - Greenhouse board token (e.g., "acme")
   * @returns Promise resolving to normalized search results
   */
  async listOffersForTenant(boardToken: string): Promise<SearchOffersResult> {
    // Validate board token
    if (!boardToken || boardToken.trim() === "") {
      logger.debug(
        "Greenhouse listOffersForTenant called with empty boardToken",
      );
      return {
        offers: [],
        meta: {
          provider: this.provider,
          pagesFetched: 0,
          offersFetched: 0,
        },
      };
    }

    try {
      // Fetch jobs from Greenhouse API with content=true to get descriptions
      const url = `${GREENHOUSE_API_BASE_URL}/boards/${boardToken}/jobs`;
      const query = { content: "true" }; // Request full content including descriptions

      const response = await this.httpRequest<GreenhouseJobsResponse>({
        url,
        method: "GET",
        query,
        headers: GREENHOUSE_HTTP_HEADERS,
        timeoutMs: GREENHOUSE_HTTP_TIMEOUT_MS,
        retry: {
          maxAttempts: GREENHOUSE_HTTP_MAX_ATTEMPTS,
        },
      });

      const totalJobsFromApi = response.jobs.length;

      // Sort jobs deterministically by ID (ascending) for consistent ordering
      const sortedJobs = [...response.jobs].sort((a, b) => a.id - b.id);

      // Apply bounded limit to prevent excessive processing
      const cappedJobs = sortedJobs.slice(
        0,
        GREENHOUSE_LIMITS.MAX_JOBS_PER_TENANT,
      );

      // Map Greenhouse jobs to canonical summaries with per-offer resilience
      const offers: JobOfferSummary[] = [];
      let skippedMalformedCount = 0;

      for (const job of cappedJobs) {
        try {
          // Validate required fields before mapping
          if (!job.id || !job.title || !job.absolute_url) {
            skippedMalformedCount++;
            continue;
          }

          offers.push(mapGreenhouseJobToSummary(job, boardToken));
        } catch (error) {
          // Skip malformed jobs instead of crashing
          skippedMalformedCount++;
        }
      }

      // Log bounded counts (no arrays, no details)
      logger.debug("Greenhouse jobs fetched and mapped", {
        boardToken,
        totalJobsFromApi,
        jobsCappedTo: cappedJobs.length,
        offersMapped: offers.length,
        skippedMalformedCount,
      });

      return {
        offers,
        meta: {
          provider: this.provider,
          pagesFetched: 1,
          offersFetched: offers.length,
        },
      };
    } catch (error) {
      // Log error and return empty results (do not throw)
      logger.warn("Failed to fetch Greenhouse jobs", {
        boardToken,
        error: String(error),
      });

      return {
        offers: [],
        meta: {
          provider: this.provider,
          pagesFetched: 0,
          offersFetched: 0,
        },
      };
    }
  }

  /**
   * Hydrate offer summaries to full details with descriptions
   *
   * NOOP implementation: Greenhouse's jobs endpoint with content=true includes
   * the full `content` field with descriptions, so we can map directly from
   * the cached job data to JobOfferDetail without additional fetches.
   *
   * Implementation: Re-fetch jobs and filter to only requested offers.
   * Returns details in the same order as input offers.
   * Applies bounded description length limit to prevent excessive content storage.
   *
   * @param params - Hydration parameters
   * @param params.tenantKey - Greenhouse board token
   * @param params.offers - Offer summaries to hydrate
   * @returns Promise resolving to array of full offer details with descriptions
   */
  async hydrateOfferDetails(params: {
    tenantKey: string;
    offers: JobOfferSummary[];
  }): Promise<JobOfferDetail[]> {
    // If no offers to hydrate, return empty array
    if (params.offers.length === 0) {
      return [];
    }

    try {
      // Re-fetch jobs to get full content
      const url = `${GREENHOUSE_API_BASE_URL}/boards/${params.tenantKey}/jobs`;
      const query = { content: "true" };

      const response = await this.httpRequest<GreenhouseJobsResponse>({
        url,
        method: "GET",
        query,
        headers: GREENHOUSE_HTTP_HEADERS,
        timeoutMs: GREENHOUSE_HTTP_TIMEOUT_MS,
        retry: {
          maxAttempts: GREENHOUSE_HTTP_MAX_ATTEMPTS,
        },
      });

      // Build set of requested offer IDs for filtering
      const requestedIds = new Set(params.offers.map((offer) => offer.ref.id));

      // Create map of job ID to job for efficient lookup
      const jobsById = new Map(
        response.jobs.map((job) => [String(job.id), job]),
      );

      // Map only requested offers to details, maintaining input order
      const details: JobOfferDetail[] = [];
      let notFoundCount = 0;
      let missingContentCount = 0;

      for (const offer of params.offers) {
        const job = jobsById.get(offer.ref.id);
        if (job) {
          const detail = mapGreenhouseJobToDetail(job, params.tenantKey);
          details.push(detail);

          // Track if content is missing
          if (!job.content) {
            missingContentCount++;
          }
        } else {
          notFoundCount++;
        }
      }

      // Log bounded counts only (no arrays, no job IDs)
      logger.debug("Greenhouse offers hydrated", {
        boardToken: params.tenantKey,
        requestedCount: params.offers.length,
        foundCount: details.length,
        notFoundCount,
        missingContentCount,
      });

      return details;
    } catch (error) {
      // Log error and return empty array (do not throw)
      logger.warn("Failed to hydrate Greenhouse offer details", {
        boardToken: params.tenantKey,
        error: String(error),
      });

      return [];
    }
  }
}
