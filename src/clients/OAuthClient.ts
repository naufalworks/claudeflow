/**
 * OAuthClient
 * 
 * Client for communication with OAuth-based MITM routers.
 * Handles requests to OAuth routers using session token authentication.
 * 
 * CRITICAL: Validates that all responses are in raw Anthropic format.
 * ClaudeFlow ONLY supports raw Anthropic format - no format conversion.
 * 
 * This client is for backward compatibility with existing OAuth setups.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type { AnthropicRequest, AnthropicResponse } from '../types/anthropic.types';
import { ResponseFormatValidator } from './ResponseFormatValidator.js';

/**
 * Anthropic API version
 */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * OAuth client error
 */
export class OAuthClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isSessionExpired: boolean = false
  ) {
    super(message);
    this.name = 'OAuthClientError';
  }
}

/**
 * OAuthClient class
 * 
 * Provides access to OAuth-based MITM routers with format validation.
 * Uses session token authentication instead of API key.
 */
export class OAuthClient {
  private axiosInstance: AxiosInstance;
  private validator: ResponseFormatValidator;

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 60000, // 60 second timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.validator = new ResponseFormatValidator();
  }

  /**
   * Send request to OAuth-based MITM router
   * 
   * Uses session token for authentication.
   * Validates that response is in raw Anthropic format.
   * 
   * @param request - Anthropic request
   * @param sessionToken - OAuth session token
   * @param mitmRouterUrl - MITM router URL (e.g., "http://3.68.219.151:20128")
   * @returns Anthropic response in raw format
   * @throws OAuthClientError if request fails or response format is invalid
   */
  async sendRequest(
    request: AnthropicRequest,
    sessionToken: string,
    mitmRouterUrl: string
  ): Promise<AnthropicResponse> {
    try {
      const response = await this.axiosInstance.post<AnthropicResponse>(
        `${mitmRouterUrl}/v1/messages`,
        request,
        {
          headers: {
            'x-session-token': sessionToken,
            'anthropic-version': ANTHROPIC_VERSION,
          },
        }
      );

      // CRITICAL: Validate response is in raw Anthropic format
      if (!this.validator.isAnthropicFormat(response.data)) {
        throw new OAuthClientError(
          `OAuth router at ${mitmRouterUrl} returned non-Anthropic format response. ` +
          `ClaudeFlow only supports routers that return raw Anthropic format.`,
          response.status,
          false
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error, mitmRouterUrl);
      }
      throw error;
    }
  }

  /**
   * Send streaming request to OAuth-based MITM router
   * 
   * @param request - Anthropic request with stream: true
   * @param sessionToken - OAuth session token
   * @param mitmRouterUrl - MITM router URL
   * @returns Async iterable of server-sent events
   * @throws OAuthClientError if request fails
   */
  async *sendStreamingRequest(
    request: AnthropicRequest,
    sessionToken: string,
    mitmRouterUrl: string
  ): AsyncIterable<string> {
    try {
      const response = await this.axiosInstance.post(
        `${mitmRouterUrl}/v1/messages`,
        { ...request, stream: true },
        {
          headers: {
            'x-session-token': sessionToken,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          responseType: 'stream',
        }
      );

      // Read stream data
      const stream = response.data;

      for await (const chunk of stream) {
        const chunkStr = chunk.toString('utf-8');
        yield chunkStr;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error, mitmRouterUrl);
      }
      throw error;
    }
  }

  /**
   * Handle axios errors and convert to OAuthClientError
   * 
   * @param error - Axios error
   * @param mitmRouterUrl - MITM router URL for error messages
   * @returns OAuthClientError with appropriate message
   */
  private handleAxiosError(error: AxiosError, mitmRouterUrl: string): OAuthClientError {
    const statusCode = error.response?.status;
    const statusText = error.response?.statusText;

    // Check for session expiration (401)
    if (statusCode === 401) {
      return new OAuthClientError(
        `OAuth session expired at ${mitmRouterUrl}. Session needs refresh.`,
        statusCode,
        true // isSessionExpired
      );
    }

    // Check for rate limiting (429)
    if (statusCode === 429) {
      return new OAuthClientError(
        `OAuth router rate limit exceeded at ${mitmRouterUrl}. Please retry later.`,
        statusCode,
        false
      );
    }

    // Check for bad request (400)
    if (statusCode === 400) {
      const errorMessage = error.response?.data
        ? JSON.stringify(error.response.data)
        : 'Bad request';
      return new OAuthClientError(
        `Invalid request to OAuth router at ${mitmRouterUrl}: ${errorMessage}`,
        statusCode,
        false
      );
    }

    // Check for service errors (500, 503)
    if (statusCode && statusCode >= 500) {
      return new OAuthClientError(
        `OAuth router service error at ${mitmRouterUrl}: ${statusCode} ${statusText}`,
        statusCode,
        false
      );
    }

    // Network errors (no response)
    if (!error.response) {
      return new OAuthClientError(
        `Network error connecting to OAuth router at ${mitmRouterUrl}: ${error.message}`,
        undefined,
        false
      );
    }

    // Generic error
    return new OAuthClientError(
      `OAuth router error at ${mitmRouterUrl}: ${statusCode} ${statusText}`,
      statusCode,
      false
    );
  }

  /**
   * Test connection to OAuth-based MITM router
   * 
   * Makes a minimal request to verify router connectivity and format compatibility.
   * 
   * @param sessionToken - OAuth session token
   * @param mitmRouterUrl - MITM router URL to test
   * @returns True if connection successful and router returns raw Anthropic format
   */
  async testConnection(sessionToken: string, mitmRouterUrl: string): Promise<boolean> {
    try {
      await this.sendRequest(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        },
        sessionToken,
        mitmRouterUrl
      );
      return true;
    } catch (error) {
      return false;
    }
  }
}
