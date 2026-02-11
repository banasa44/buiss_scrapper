/**
 * LeverAtsJobOffersClient — API client for Lever ATS
 *
 * Implements the AtsJobOffersClient interface for Lever provider.
 * Fetches job postings scoped to a specific company tenant.
 */

import type { AtsJobOffersClient } from "@/interfaces";
import type {
  Provider,
  SearchOffersResult,
  JobOfferSummary,
  JobOfferDetail,
  HttpRequest,
} from "@/types";
import type { LeverPostingsResponse } from "@/types/clients/lever";
import { httpRequest as defaultHttpRequest } from "@/clients/http";
import {
  LEVER_API_BASE_URL,
  LEVER_HTTP_TIMEOUT_MS,
  LEVER_HTTP_MAX_ATTEMPTS,
  LEVER_HTTP_HEADERS,
} from "@/constants";
import { mapLeverPostingToSummary, mapLeverPostingToDetail } from "./mappers";
import * as logger from "@/logger";

/**
 * HTTP request function type for dependency injection
 */
type HttpRequestFn = <T>(req: HttpRequest) => Promise<T>;

export interface LeverAtsJobOffersClientConfig {
  /**
   * Optional HTTP request function (for testing/mocking)
   * Defaults to production httpRequest implementation
   */
  httpRequest?: HttpRequestFn;
}

/**
 * Lever ATS implementation of AtsJobOffersClient
 */
export class LeverAtsJobOffersClient implements AtsJobOffersClient {
  readonly provider: Provider = "lever";
  private readonly httpRequest: HttpRequestFn;

  constructor(config?: LeverAtsJobOffersClientConfig) {
    this.httpRequest = config?.httpRequest ?? defaultHttpRequest;
  }

  /**
   * List all active job offers for a Lever tenant
   *
   * Fetches postings from Lever's public API and maps to canonical types.
   * Returns empty results on error (logs failure but does not throw).
   *
   * @param tenantKey - Lever company slug (e.g., "acme")
   * @returns Promise resolving to normalized search results
   */
  async listOffersForTenant(tenantKey: string): Promise<SearchOffersResult> {
    // Validate tenant key
    if (!tenantKey || tenantKey.trim() === "") {
      logger.debug("Lever listOffersForTenant called with empty tenantKey");
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
      // Fetch postings from Lever API
      const url = `${LEVER_API_BASE_URL}/postings/${tenantKey}`;
      const query = { mode: "json" }; // Request JSON format

      logger.debug("Fetching Lever postings", { tenantKey, url });

      const response = await this.httpRequest<LeverPostingsResponse>({
        url,
        method: "GET",
        query,
        headers: LEVER_HTTP_HEADERS,
        timeoutMs: LEVER_HTTP_TIMEOUT_MS,
        retry: {
          maxAttempts: LEVER_HTTP_MAX_ATTEMPTS,
        },
      });

      // Map Lever postings to canonical summaries
      const offers = response.map((posting) =>
        mapLeverPostingToSummary(posting, tenantKey),
      );

      logger.debug("Lever postings fetched and mapped", {
        tenantKey,
        count: offers.length,
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
      logger.warn("Failed to fetch Lever postings", {
        tenantKey,
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
   * NOOP implementation: Lever's list endpoint includes all content fields
   * (description, descriptionPlain, lists, additional), so we can map directly
   * from the cached posting data to JobOfferDetail without additional fetches.
   *
   * Implementation: Re-fetch postings and filter to only requested offers.
   * Returns details in the same order as input offers.
   *
   * @param params - Hydration parameters
   * @param params.tenantKey - Lever company slug
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

    logger.debug("Lever hydrateOfferDetails called", {
      tenantKey: params.tenantKey,
      offerCount: params.offers.length,
    });

    try {
      // Re-fetch postings to get full content
      const url = `${LEVER_API_BASE_URL}/postings/${params.tenantKey}`;
      const query = { mode: "json" };

      const response = await this.httpRequest<LeverPostingsResponse>({
        url,
        method: "GET",
        query,
        headers: LEVER_HTTP_HEADERS,
        timeoutMs: LEVER_HTTP_TIMEOUT_MS,
        retry: {
          maxAttempts: LEVER_HTTP_MAX_ATTEMPTS,
        },
      });

      // Build set of requested offer IDs for filtering
      const requestedIds = new Set(params.offers.map((offer) => offer.ref.id));

      // Create map of posting ID to posting for efficient lookup
      const postingsById = new Map(
        response.map((posting) => [posting.id, posting]),
      );

      // Map only requested offers to details, maintaining input order
      const details: JobOfferDetail[] = [];
      let notFoundCount = 0;

      for (const offer of params.offers) {
        const posting = postingsById.get(offer.ref.id);
        if (posting) {
          details.push(mapLeverPostingToDetail(posting, params.tenantKey));
        } else {
          notFoundCount++;
        }
      }

      // Log if any offers weren't found in the fetched postings
      if (notFoundCount > 0) {
        logger.debug("Some Lever offers not found in postings response", {
          tenantKey: params.tenantKey,
          notFoundCount,
        });
      }

      logger.debug("Lever offers hydrated", {
        tenantKey: params.tenantKey,
        requestedCount: params.offers.length,
        hydratedCount: details.length,
      });

      return details;
    } catch (error) {
      // Log error and return empty array (do not throw)
      logger.warn("Failed to hydrate Lever offer details", {
        tenantKey: params.tenantKey,
        error: String(error),
      });

      return [];
    }
  }
}
