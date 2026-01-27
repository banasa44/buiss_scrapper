/**
 * InfoJobsClient — API client for InfoJobs
 *
 * Implements the JobOffersClient interface for InfoJobs provider.
 */

import type { JobOffersClient } from "@/interfaces";
import type {
  Provider,
  SearchOffersQuery,
  SearchOffersResult,
  JobOfferDetail,
  SearchSort,
  TruncationReason,
  HttpRequest,
} from "@/types";
import type {
  InfoJobsOfferDetail,
  InfoJobsListResponse,
} from "@/types/clients/infojobs";
import { httpRequest as defaultHttpRequest } from "@/clients/http";
import {
  INFOJOBS_BASE_URL,
  INFOJOBS_DETAIL_ENDPOINT_PATH,
  INFOJOBS_LIST_ENDPOINT_PATH,
  INFOJOBS_DEFAULT_PAGE_SIZE,
  INFOJOBS_MAX_PAGE_SIZE,
  INFOJOBS_DEFAULT_COUNTRY,
  INFOJOBS_DEFAULT_ORDER,
  INFOJOBS_DEFAULT_MAX_PAGES,
  INFOJOBS_DEFAULT_MAX_OFFERS,
  INFOJOBS_MS_PER_DAY,
} from "@/constants/clients/infojobs";
import {
  mapInfoJobsOfferDetailToDetail,
  mapInfoJobsOfferListItemToSummary,
} from "./mappers";
import * as logger from "@/logger";

/**
 * HTTP request function type for dependency injection
 */
type HttpRequestFn = <T>(req: HttpRequest) => Promise<T>;

export interface InfoJobsClientConfig {
  /**
   * Optional HTTP request function (for testing/mocking)
   * Defaults to production httpRequest implementation
   */
  httpRequest?: HttpRequestFn;

  /**
   * Optional credentials (for testing)
   * Defaults to process.env.IJ_CLIENT_ID / IJ_CLIENT_SECRET
   */
  credentials?: {
    clientId: string;
    clientSecret: string;
  };
}

/**
 * InfoJobs implementation of JobOffersClient
 */
export class InfoJobsClient implements JobOffersClient {
  readonly provider: Provider = "infojobs";

  private readonly clientId: string;
  private readonly clientSecret: string;
  private authHeader: string | null = null;
  private readonly httpRequest: HttpRequestFn;

  constructor(config?: InfoJobsClientConfig) {
    // Use provided credentials or fall back to env vars
    if (config?.credentials) {
      this.clientId = config.credentials.clientId;
      this.clientSecret = config.credentials.clientSecret;
    } else {
      this.clientId = process.env.IJ_CLIENT_ID || "";
      this.clientSecret = process.env.IJ_CLIENT_SECRET || "";
    }

    // Validate credentials are present
    if (!this.clientId || !this.clientSecret) {
      const missing: string[] = [];
      if (!this.clientId) missing.push("IJ_CLIENT_ID");
      if (!this.clientSecret) missing.push("IJ_CLIENT_SECRET");
      throw new Error(
        `InfoJobs authentication configuration missing: ${missing.join(", ")}. ` +
          `Please set these environment variables.`,
      );
    }

    // Use injected httpRequest or default to production implementation
    this.httpRequest = config?.httpRequest ?? defaultHttpRequest;

    logger.debug("InfoJobsClient initialized");
  }

  /**
   * Get cached authorization header (HTTP Basic auth)
   * Builds and caches the Basic auth header on first call
   */
  private getAuthHeader(): string {
    if (!this.authHeader) {
      const credentials = `${this.clientId}:${this.clientSecret}`;
      const encoded = Buffer.from(credentials, "utf-8").toString("base64");
      this.authHeader = `Basic ${encoded}`;
      logger.debug("InfoJobs auth header generated");
    }
    return this.authHeader;
  }

  /**
   * Clamp page size to valid range
   * @param n - Requested page size
   * @returns Clamped page size between 1 and INFOJOBS_MAX_PAGE_SIZE
   */
  private clampPageSize(n?: number): number {
    // If not a finite number or <= 0, use default
    if (!Number.isFinite(n) || n === undefined || n === null || n <= 0) {
      return INFOJOBS_DEFAULT_PAGE_SIZE;
    }
    // Clamp to [1, INFOJOBS_MAX_PAGE_SIZE]
    return Math.max(1, Math.min(n, INFOJOBS_MAX_PAGE_SIZE));
  }

  /**
   * Map updatedSince ISO date to InfoJobs sinceDate bucket
   * @param updatedSince - ISO 8601 date string
   * @returns InfoJobs sinceDate value or undefined
   */
  private mapUpdatedSinceToSinceDate(
    updatedSince?: string,
  ): string | undefined {
    if (!updatedSince) {
      return undefined;
    }

    // Parse ISO date
    const date = new Date(updatedSince);
    if (isNaN(date.getTime())) {
      logger.warn("Invalid updatedSince date format, ignoring filter", {
        updatedSince,
      });
      return undefined;
    }

    // Compute days difference
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = diffMs / INFOJOBS_MS_PER_DAY;

    // Map to InfoJobs buckets
    if (diffDays <= 1) {
      return "_24_HOURS";
    } else if (diffDays <= 7) {
      return "_7_DAYS";
    } else if (diffDays <= 15) {
      return "_15_DAYS";
    } else {
      return "ANY";
    }
  }

  /**
   * Map normalized sort to InfoJobs order parameter
   * @param sort - Normalized sort configuration
   * @returns InfoJobs order value or undefined
   */
  private mapSortToOrder(sort?: SearchSort): string | undefined {
    if (!sort) {
      return undefined;
    }

    // InfoJobs only supports desc ordering; if asc requested, log warning and use desc
    if (sort.direction === "asc") {
      logger.warn("InfoJobs only supports desc ordering, using desc instead", {
        sort,
      });
    }

    // Map field to InfoJobs order value (always desc)
    if (sort.field === "updatedAt") {
      return "updated-desc";
    } else if (sort.field === "publishedAt") {
      // InfoJobs doesn't have published-desc, fall back to updated-desc
      logger.debug(
        "InfoJobs doesn't support publishedAt sort, using updated-desc",
        { sort },
      );
      return "updated-desc";
    }

    return undefined;
  }

  /**
   * Build InfoJobs list query parameters from normalized query
   * @param query - Normalized search query
   * @param page - Page number (0-based)
   * @returns InfoJobs query parameters
   */
  private buildListQueryParams(
    query: SearchOffersQuery,
    page: number,
  ): Record<
    string,
    string | number | boolean | Array<string | number | boolean>
  > {
    const params: Record<
      string,
      string | number | boolean | Array<string | number | boolean>
    > = {};

    // Always include country filter for Spain-wide search
    params.country = INFOJOBS_DEFAULT_COUNTRY;

    // Page number
    params.page = page;

    // Page size - clamp to valid range
    params.maxResults = this.clampPageSize(query.pageSize);

    // Text search
    if (query.text) {
      params.q = query.text;
    }

    // Date filter
    const sinceDate = this.mapUpdatedSinceToSinceDate(query.updatedSince);
    if (sinceDate) {
      params.sinceDate = sinceDate;
    }

    // Sort order
    const order = this.mapSortToOrder(query.sort) ?? INFOJOBS_DEFAULT_ORDER;
    params.order = order;

    return params;
  }

  /**
   * Search for job offers matching the given query
   * Implements pagination with caps and defensive error handling
   */
  async searchOffers(query: SearchOffersQuery): Promise<SearchOffersResult> {
    const url = `${INFOJOBS_BASE_URL}${INFOJOBS_LIST_ENDPOINT_PATH}`;

    // Resolve caps and pageSize from query or defaults
    const pageSize = this.clampPageSize(query.pageSize);
    const maxPages = query.maxPages ?? INFOJOBS_DEFAULT_MAX_PAGES;
    const maxOffers = query.maxOffers ?? INFOJOBS_DEFAULT_MAX_OFFERS;

    logger.debug("Starting InfoJobs search with pagination", {
      hasText: !!query.text,
      hasUpdatedSince: !!query.updatedSince,
      sortField: query.sort?.field,
      sortDirection: query.sort?.direction,
      pageSize,
      maxPages,
      maxOffers,
    });

    // Accumulate results across pages
    const allOffers: NonNullable<
      ReturnType<typeof mapInfoJobsOfferListItemToSummary>
    >[] = [];
    let pagesFetched = 0;
    let totalPages: number | undefined;
    let totalResults: number | undefined;
    let truncatedBy: TruncationReason | undefined;

    // Pagination loop
    for (let page = 0; page < maxPages; page++) {
      try {
        // Build query params for current page
        const queryParams = this.buildListQueryParams(query, page);

        // Fetch current page
        const response = await this.httpRequest<InfoJobsListResponse>({
          method: "GET",
          url,
          headers: {
            Authorization: this.getAuthHeader(),
          },
          query: queryParams,
        });

        // Defensive: check offers array exists and is valid
        if (!response.offers || !Array.isArray(response.offers)) {
          logger.warn("InfoJobs response missing or invalid offers array", {
            page,
          });
          truncatedBy = "error";
          break;
        }

        // Increment pagesFetched after validating response shape
        pagesFetched++;

        // Capture pagination metadata from any response (first or later)
        if (totalPages === undefined && response.totalPages !== undefined) {
          totalPages = response.totalPages;
        }
        if (totalResults === undefined && response.totalResults !== undefined) {
          totalResults = response.totalResults;
        }

        // Stop if no offers returned (natural end)
        if (response.offers.length === 0) {
          logger.debug(
            "InfoJobs returned empty offers array, stopping pagination",
            {
              page,
            },
          );
          break;
        }

        // Map raw offers to normalized summaries
        const pageOffers = response.offers
          .map((rawOffer) => {
            const mapped = mapInfoJobsOfferListItemToSummary(rawOffer);
            if (!mapped && rawOffer.id) {
              logger.warn("Failed to map InfoJobs offer, skipping", {
                offerId: rawOffer.id,
                page,
              });
            }
            return mapped;
          })
          .filter(
            (offer): offer is NonNullable<typeof offer> => offer !== null,
          );

        // Add mapped offers to accumulator
        allOffers.push(...pageOffers);

        // Check if we've hit maxOffers cap
        if (allOffers.length >= maxOffers) {
          truncatedBy = "maxOffers";
          logger.debug("Reached maxOffers cap, stopping pagination", {
            pagesFetched,
            offersFetched: allOffers.length,
            maxOffers,
          });
          break;
        }

        // Check if we've reached natural end based on totalPages
        if (totalPages !== undefined && page + 1 >= totalPages) {
          logger.debug(
            "Reached last page from totalPages, stopping pagination",
            {
              page: page + 1,
              totalPages,
            },
          );
          break;
        }
      } catch (error) {
        // Distinguish fatal errors (401/403) from recoverable ones
        // Auth errors indicate misconfiguration and should fail fast
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          (error.status === 401 || error.status === 403)
        ) {
          logger.error("InfoJobs authentication failed", {
            status: error.status,
            page,
          });
          throw new Error(
            `InfoJobs authentication error: HTTP ${error.status}. Check IJ_CLIENT_ID and IJ_CLIENT_SECRET.`,
          );
        }

        // For other errors (network, timeout, 5xx, etc.), log and stop gracefully
        logger.warn("InfoJobs page fetch failed, stopping pagination", {
          page,
          error: error instanceof Error ? error.message : String(error),
          pagesFetched,
          offersFetched: allOffers.length,
        });
        truncatedBy = "error";
        break;
      }
    }

    // Check if we stopped due to maxPages cap
    if (
      !truncatedBy &&
      pagesFetched >= maxPages &&
      totalPages &&
      pagesFetched < totalPages
    ) {
      truncatedBy = "maxPages";
    }

    // Slice offers to respect maxOffers limit
    const finalOffers = allOffers.slice(0, maxOffers);

    logger.debug("InfoJobs search completed", {
      pagesFetched,
      offersFetched: finalOffers.length,
      totalPages,
      totalResults,
      truncatedBy,
    });

    // Return result with metadata
    return {
      offers: finalOffers,
      meta: {
        provider: "infojobs",
        pagesFetched,
        offersFetched: finalOffers.length,
        totalPages,
        totalResults,
        truncatedBy,
      },
    };
  }

  /**
   * Get full details for a specific job offer by ID
   *
   * @param id - InfoJobs offer ID
   * @returns Promise resolving to full offer details
   * @throws {Error} If offer not found (404) or other API errors occur
   */
  async getOfferById(id: string): Promise<JobOfferDetail> {
    const url = `${INFOJOBS_BASE_URL}${INFOJOBS_DETAIL_ENDPOINT_PATH}/${id}`;

    logger.debug("Fetching InfoJobs offer detail", { id });

    try {
      const rawDetail = await this.httpRequest<InfoJobsOfferDetail>({
        method: "GET",
        url,
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });

      // Map raw detail to normalized type
      const detail = mapInfoJobsOfferDetailToDetail(rawDetail);

      if (!detail) {
        throw new Error(
          `InfoJobs offer mapping failed: ${id} - invalid response structure`,
        );
      }

      logger.debug("InfoJobs offer detail fetched", {
        id,
        title: detail.title,
      });
      return detail;
    } catch (error) {
      // Handle 404 specifically
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404
      ) {
        throw new Error(`InfoJobs offer not found: ${id}`);
      }

      // For other HttpErrors, wrap with context but preserve status info
      if (error && typeof error === "object" && "status" in error) {
        const status = (error as any).status;
        const statusText = (error as any).statusText || "";
        throw new Error(
          `InfoJobs API error fetching offer ${id}: HTTP ${status} ${statusText}`,
        );
      }

      // Re-throw other errors as-is
      throw error;
    }
  }
}
