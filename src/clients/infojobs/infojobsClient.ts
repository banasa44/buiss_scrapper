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
  InfoJobsOfferDetail,
} from "@/types";
import { httpRequest } from "@/clients/http";
import {
  INFOJOBS_BASE_URL,
  INFOJOBS_DETAIL_ENDPOINT_PATH,
} from "@/constants/clients/infojobs";
import { mapInfoJobsOfferDetailToDetail } from "./mappers";
import * as logger from "@/logger";

/**
 * InfoJobs implementation of JobOffersClient
 */
export class InfoJobsClient implements JobOffersClient {
  readonly provider: Provider = "infojobs";

  private readonly clientId: string;
  private readonly clientSecret: string;
  private authHeader: string | null = null;

  constructor() {
    // Validate required env vars - fail fast if missing
    this.clientId = process.env.IJ_CLIENT_ID || "";
    this.clientSecret = process.env.IJ_CLIENT_SECRET || "";

    if (!this.clientId || !this.clientSecret) {
      const missing: string[] = [];
      if (!this.clientId) missing.push("IJ_CLIENT_ID");
      if (!this.clientSecret) missing.push("IJ_CLIENT_SECRET");
      throw new Error(
        `InfoJobs authentication configuration missing: ${missing.join(", ")}. ` +
          `Please set these environment variables.`,
      );
    }

    logger.debug("InfoJobsClient initialized", {
      clientId: this.clientId.substring(0, 3) + "...",
    });
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
   * Search for job offers matching the given query
   */
  async searchOffers(query: SearchOffersQuery): Promise<SearchOffersResult> {
    // TODO: Implement searchOffers
    throw new Error("Not implemented");
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
      const rawDetail = await httpRequest<InfoJobsOfferDetail>({
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
