/**
 * GoogleSheetsClient — API client for Google Sheets
 *
 * Provides primitive read/write operations for Google Sheets.
 * Handles authentication via service account JWT.
 */

import type {
  GoogleSheetsConfig,
  GoogleSheetsCredentials,
  GoogleSheetsErrorDetails,
  SheetReadResult,
  SheetWriteResult,
  SheetAppendResult,
  GoogleOAuth2TokenResponse,
  SheetOperationResult,
} from "@/types/clients/googleSheets";
import {
  GOOGLE_SHEETS_BASE_URL,
  GOOGLE_SHEETS_API_VERSION,
  GOOGLE_SHEETS_DEFAULT_MAX_ATTEMPTS,
  GOOGLE_SHEETS_DEFAULT_BASE_DELAY_MS,
  GOOGLE_SHEETS_DEFAULT_MAX_DELAY_MS,
  GOOGLE_SHEETS_DEFAULT_TIMEOUT_MS,
  GOOGLE_SHEETS_JWT_EXPIRATION_SECONDS,
  GOOGLE_OAUTH2_TOKEN_URL,
  GOOGLE_SHEETS_SCOPES,
  GOOGLE_SHEETS_VALUE_INPUT_OPTION_RAW,
  GOOGLE_SHEETS_INSERT_DATA_OPTION_OVERWRITE,
  GOOGLE_SHEETS_INSERT_DATA_OPTION_INSERT_ROWS,
  GOOGLE_SHEETS_TOKEN_EXPIRY_BUFFER_SECONDS,
  GOOGLE_SHEETS_MS_PER_SECOND,
  GOOGLE_SHEETS_HTTP_STATUS_RATE_LIMIT,
  GOOGLE_SHEETS_HTTP_STATUS_REQUEST_TIMEOUT,
  GOOGLE_SHEETS_HTTP_STATUS_SERVER_ERROR_MIN,
} from "@/constants/clients/googleSheets";
import * as logger from "@/logger";
import { createHash, createSign } from "crypto";
import { normalizePrivateKey } from "@/utils/sheets/sheetsHelpers";

/**
 * Google Sheets API error
 */
export class GoogleSheetsError extends Error {
  constructor(
    message: string,
    public readonly details: GoogleSheetsErrorDetails,
  ) {
    super(message);
    this.name = "GoogleSheetsError";
  }
}

/**
 * Google Sheets client implementation
 */
export class GoogleSheetsClient {
  private readonly spreadsheetId: string;
  private readonly credentials: GoogleSheetsCredentials;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: GoogleSheetsConfig) {
    // Validate spreadsheet ID is provided
    if (!config.spreadsheetId) {
      throw new Error(
        "Google Sheets configuration missing: spreadsheetId is required",
      );
    }

    this.spreadsheetId = config.spreadsheetId;

    // Load credentials from config or environment
    if (config.credentials) {
      const { clientEmail, privateKey } = config.credentials;

      if (!clientEmail || !privateKey) {
        throw new Error(
          "Google Sheets authentication configuration missing: " +
            "credentials.clientEmail and credentials.privateKey are required " +
            "when credentials are provided in config",
        );
      }

      this.credentials = {
        ...config.credentials,
        privateKey: normalizePrivateKey(privateKey, "credentials.privateKey"),
      };
    } else {
      const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
      const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

      if (!clientEmail) {
        throw new Error(
          "Google Sheets authentication configuration missing: " +
            "GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is required " +
            "when credentials are not provided in config",
        );
      }

      this.credentials = {
        clientEmail,
        privateKey: normalizePrivateKey(
          privateKey,
          "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
        ),
        projectId: process.env.GOOGLE_PROJECT_ID,
      };
    }

    // Set retry configuration
    this.maxAttempts =
      config.retry?.maxAttempts ?? GOOGLE_SHEETS_DEFAULT_MAX_ATTEMPTS;
    this.baseDelayMs =
      config.retry?.baseDelayMs ?? GOOGLE_SHEETS_DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs =
      config.retry?.maxDelayMs ?? GOOGLE_SHEETS_DEFAULT_MAX_DELAY_MS;

    logger.debug("GoogleSheetsClient initialized", {
      spreadsheetId: this.spreadsheetId,
    });
  }

  /**
   * Generate JWT for service account authentication
   */
  private createJWT(): string {
    const now = Math.floor(Date.now() / GOOGLE_SHEETS_MS_PER_SECOND);
    const expiry = now + GOOGLE_SHEETS_JWT_EXPIRATION_SECONDS;

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iss: this.credentials.clientEmail,
      scope: GOOGLE_SHEETS_SCOPES.join(" "),
      aud: GOOGLE_OAUTH2_TOKEN_URL,
      exp: expiry,
      iat: now,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      "base64url",
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );

    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const sign = createSign("RSA-SHA256");
    sign.update(signatureInput);
    sign.end();

    const signature = sign.sign(this.credentials.privateKey, "base64url");

    return `${signatureInput}.${signature}`;
  }

  /**
   * Get access token, refreshing if necessary
   */
  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / GOOGLE_SHEETS_MS_PER_SECOND);

    // Return cached token if still valid (with buffer)
    if (
      this.accessToken &&
      this.tokenExpiry > now + GOOGLE_SHEETS_TOKEN_EXPIRY_BUFFER_SECONDS
    ) {
      return this.accessToken;
    }

    logger.debug("Requesting new Google OAuth2 access token");

    const jwt = this.createJWT();

    try {
      const response = await fetch(GOOGLE_OAUTH2_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OAuth2 token request failed: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const data = (await response.json()) as GoogleOAuth2TokenResponse;

      this.accessToken = data.access_token;
      this.tokenExpiry = now + data.expires_in;

      logger.debug("Google OAuth2 access token obtained");

      return this.accessToken;
    } catch (error) {
      logger.error("Failed to obtain Google OAuth2 access token", { error });
      throw new Error(
        `Failed to authenticate with Google Sheets API: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Validate authentication configuration by fetching an access token
   *
   * Throws on missing/invalid credentials.
   */
  async assertAuthReady(): Promise<void> {
    await this.getAccessToken();
  }

  /**
   * Make an API request with retry logic
   */
  private async apiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${GOOGLE_SHEETS_BASE_URL}${GOOGLE_SHEETS_API_VERSION}${endpoint}`;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...options.headers,
          },
          signal: AbortSignal.timeout(GOOGLE_SHEETS_DEFAULT_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          const errorDetails: GoogleSheetsErrorDetails = {
            status: response.status,
            message: errorBody,
            spreadsheetId: this.spreadsheetId,
          };

          // Retry on 5xx or 429 (rate limit) or 408 (timeout)
          if (
            response.status >= GOOGLE_SHEETS_HTTP_STATUS_SERVER_ERROR_MIN ||
            response.status === GOOGLE_SHEETS_HTTP_STATUS_RATE_LIMIT ||
            response.status === GOOGLE_SHEETS_HTTP_STATUS_REQUEST_TIMEOUT
          ) {
            lastError = new GoogleSheetsError(
              `API request failed: ${response.status} ${response.statusText}`,
              errorDetails,
            );

            if (attempt < this.maxAttempts) {
              const delay = Math.min(
                this.baseDelayMs * Math.pow(2, attempt - 1),
                this.maxDelayMs,
              );
              logger.warn(
                `Google Sheets API request failed, retrying (${attempt}/${this.maxAttempts})`,
                {
                  status: response.status,
                  delayMs: delay,
                  url,
                },
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
          }

          // Non-retryable error
          throw new GoogleSheetsError(
            `Google Sheets API error: ${response.status} ${response.statusText}`,
            errorDetails,
          );
        }

        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        if (error instanceof GoogleSheetsError) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxAttempts) {
          const delay = Math.min(
            this.baseDelayMs * Math.pow(2, attempt - 1),
            this.maxDelayMs,
          );
          logger.warn(
            `Google Sheets API request failed, retrying (${attempt}/${this.maxAttempts})`,
            {
              error: lastError.message,
              delayMs: delay,
              url,
            },
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    // All retries exhausted
    logger.error("Google Sheets API request failed after all retries", {
      url,
      error: lastError,
    });
    throw lastError || new Error("Google Sheets API request failed");
  }

  /**
   * Read values from a range in the spreadsheet
   *
   * @param range - A1 notation range (e.g., "Sheet1!A1:D10")
   * @returns SheetOperationResult with values or error details
   */
  async readRange(
    range: string,
  ): Promise<SheetOperationResult<SheetReadResult>> {
    logger.debug("Reading Google Sheets range", {
      spreadsheetId: this.spreadsheetId,
      range,
    });

    try {
      const endpoint = `/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}`;
      const response = await this.apiRequest<{
        range: string;
        majorDimension?: string;
        values?: unknown[][];
      }>(endpoint, { method: "GET" });

      return {
        ok: true,
        data: {
          range: response.range,
          values: response.values || null,
        },
      };
    } catch (error) {
      const errorDetails: GoogleSheetsErrorDetails =
        error instanceof GoogleSheetsError
          ? error.details
          : {
              message: error instanceof Error ? error.message : String(error),
              spreadsheetId: this.spreadsheetId,
              range,
            };

      logger.error("Failed to read Google Sheets range", {
        spreadsheetId: this.spreadsheetId,
        range,
        error: errorDetails,
      });

      return {
        ok: false,
        error: errorDetails,
      };
    }
  }

  /**
   * Update values in a specific range (overwrites existing data)
   *
   * @param values - 2D array of values to write
   * @param range - A1 notation range (e.g., "Sheet1!A1:D10")
   * @returns SheetOperationResult with update statistics or error details
   */
  async batchUpdate(
    values: unknown[][],
    range: string,
  ): Promise<SheetOperationResult<SheetWriteResult>> {
    logger.debug("Updating Google Sheets range", {
      spreadsheetId: this.spreadsheetId,
      range,
      rowCount: values.length,
    });

    try {
      const endpoint = `/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=${GOOGLE_SHEETS_VALUE_INPUT_OPTION_RAW}`;
      const response = await this.apiRequest<{
        updatedRange: string;
        updatedRows: number;
        updatedColumns: number;
        updatedCells: number;
      }>(endpoint, {
        method: "PUT",
        body: JSON.stringify({ values }),
      });

      return {
        ok: true,
        data: {
          updatedRange: response.updatedRange,
          updatedRows: response.updatedRows,
          updatedColumns: response.updatedColumns,
          updatedCells: response.updatedCells,
        },
      };
    } catch (error) {
      const errorDetails: GoogleSheetsErrorDetails =
        error instanceof GoogleSheetsError
          ? error.details
          : {
              message: error instanceof Error ? error.message : String(error),
              spreadsheetId: this.spreadsheetId,
              range,
            };

      logger.error("Failed to update Google Sheets range", {
        spreadsheetId: this.spreadsheetId,
        range,
        error: errorDetails,
      });

      return {
        ok: false,
        error: errorDetails,
      };
    }
  }

  /**
   * Append rows to the end of a range
   *
   * @param values - 2D array of values to append
   * @param range - A1 notation range (e.g., "Sheet1!A:D")
   * @returns SheetOperationResult with append statistics or error details
   */
  async appendRows(
    values: unknown[][],
    range: string,
  ): Promise<SheetOperationResult<SheetAppendResult>> {
    logger.debug("Appending rows to Google Sheets", {
      spreadsheetId: this.spreadsheetId,
      range,
      rowCount: values.length,
    });

    try {
      const endpoint = `/spreadsheets/${this.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=${GOOGLE_SHEETS_VALUE_INPUT_OPTION_RAW}&insertDataOption=${GOOGLE_SHEETS_INSERT_DATA_OPTION_INSERT_ROWS}`;
      const response = await this.apiRequest<{
        tableRange: string;
        updates: {
          updatedRange: string;
          updatedRows: number;
          updatedColumns: number;
          updatedCells: number;
        };
      }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ values }),
      });

      return {
        ok: true,
        data: {
          tableRange: response.tableRange,
          updates: {
            updatedRange: response.updates.updatedRange,
            updatedRows: response.updates.updatedRows,
            updatedColumns: response.updates.updatedColumns,
            updatedCells: response.updates.updatedCells,
          },
        },
      };
    } catch (error) {
      const errorDetails: GoogleSheetsErrorDetails =
        error instanceof GoogleSheetsError
          ? error.details
          : {
              message: error instanceof Error ? error.message : String(error),
              spreadsheetId: this.spreadsheetId,
              range,
            };

      logger.error("Failed to append rows to Google Sheets", {
        spreadsheetId: this.spreadsheetId,
        range,
        error: errorDetails,
      });

      return {
        ok: false,
        error: errorDetails,
      };
    }
  }
}
