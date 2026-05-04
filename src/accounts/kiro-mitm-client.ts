/**
 * KiroMitmClient
 * 
 * Client for communicating with Kiro MITM router.
 * Handles request proxying while preserving native Anthropic API format.
 * 
 * Supports two authentication modes:
 * 1. OAuth mode: Uses x-session-token and x-machine-id headers
 * 2. Proxy mode: Uses x-api-key header only (for Anthropic-compatible proxies)
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type { AnthropicRequest } from '../types/anthropic.types';
import type { AnthropicResponse } from '../types/anthropic.types';
import { ResponseFormatValidator } from '../clients/ResponseFormatValidator.js';

/**
 * Kiro MITM request configuration
 */
export interface KiroMitmRequestConfig {
  machineId?: string; // Optional - only needed for OAuth mode
  sessionToken?: string; // Optional - only needed for OAuth mode
  apiKey: string; // Required - works for both OAuth and proxy modes
  mitmRouterUrl: string;
}

/**
 * Kiro MITM error
 */
export class KiroMitmError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isSessionExpired: boolean = false
  ) {
    super(message);
    this.name = 'KiroMitmError';
  }
}

/**
 * KiroMitmClient class
 */
export class KiroMitmClient {
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
   * Send request to Anthropic API via MITM router
   * 
   * Supports two authentication modes:
   * - OAuth mode: Requires sessionToken and machineId
   * - Proxy mode: Requires only apiKey (for Anthropic-compatible proxies)
   * 
   * @param request - Anthropic request
   * @param config - Kiro MITM configuration
   * @returns Anthropic response
   */
  async sendRequest(
    request: AnthropicRequest,
    config: KiroMitmRequestConfig
  ): Promise<AnthropicResponse> {
    try {
      // Build headers conditionally based on authentication mode
      const headers: Record<string, string> = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      };

      // Add OAuth headers only if sessionToken is provided (OAuth mode)
      if (config.sessionToken && config.machineId) {
        headers['x-machine-id'] = config.machineId;
        headers['x-session-token'] = config.sessionToken;
      }

      const response = await this.axiosInstance.post<AnthropicResponse>(
        `${config.mitmRouterUrl}/v1/messages`,
        request,
        { headers }
      );

      // CRITICAL: Validate response is in raw Anthropic format
      if (!this.validator.isAnthropicFormat(response.data)) {
        throw new KiroMitmError(
          `MITM router at ${config.mitmRouterUrl} returned non-Anthropic format response. ` +
          `ClaudeFlow only supports routers that return raw Anthropic format.`,
          response.status,
          false
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error, config.mitmRouterUrl);
      }
      throw error;
    }
  }

  /**
   * Send streaming request to Anthropic API via MITM router
   * 
   * Supports two authentication modes:
   * - OAuth mode: Requires sessionToken and machineId
   * - Proxy mode: Requires only apiKey (for Anthropic-compatible proxies)
   * 
   * @param request - Anthropic request with stream: true
   * @param config - Kiro MITM configuration
   * @returns Async iterable of server-sent events
   */
  async *sendStreamingRequest(
    request: AnthropicRequest,
    config: KiroMitmRequestConfig
  ): AsyncIterable<string> {
    try {
      // Build headers conditionally based on authentication mode
      const headers: Record<string, string> = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      };

      // Add OAuth headers only if sessionToken is provided (OAuth mode)
      if (config.sessionToken && config.machineId) {
        headers['x-machine-id'] = config.machineId;
        headers['x-session-token'] = config.sessionToken;
      }

      const response = await this.axiosInstance.post(
        `${config.mitmRouterUrl}/v1/messages`,
        { ...request, stream: true },
        {
          headers,
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
        throw this.handleAxiosError(error, config.mitmRouterUrl);
      }
      throw error;
    }
  }

  /**
   * Handle axios errors and convert to KiroMitmError
   * 
   * @param error - Axios error
   * @param mitmRouterUrl - MITM router URL for error messages
   * @returns KiroMitmError
   */
  private handleAxiosError(error: AxiosError, mitmRouterUrl: string): KiroMitmError {
    const statusCode = error.response?.status;
    const statusText = error.response?.statusText;

    // Check for session expiration (401)
    if (statusCode === 401) {
      return new KiroMitmError(
        `Authentication failed at ${mitmRouterUrl}. Session may be expired or API key invalid.`,
        statusCode,
        true // isSessionExpired
      );
    }

    // Check for rate limiting (429)
    if (statusCode === 429) {
      return new KiroMitmError(
        `Rate limit exceeded at ${mitmRouterUrl}`,
        statusCode,
        false
      );
    }

    // Check for not found (404) - gracefully handle missing /auth endpoints
    if (statusCode === 404) {
      return new KiroMitmError(
        `Endpoint not found at ${mitmRouterUrl}. Ensure the router supports the requested endpoint.`,
        statusCode,
        false
      );
    }

    // Check for service unavailable (503)
    if (statusCode === 503) {
      return new KiroMitmError(
        `MITM router unavailable at ${mitmRouterUrl}`,
        statusCode,
        false
      );
    }

    // Check for bad request (400)
    if (statusCode === 400) {
      const errorMessage = error.response?.data
        ? JSON.stringify(error.response.data)
        : 'Bad request';
      return new KiroMitmError(
        `Invalid request to ${mitmRouterUrl}: ${errorMessage}`,
        statusCode,
        false
      );
    }

    // Network errors (no response)
    if (!error.response) {
      return new KiroMitmError(
        `Network error connecting to ${mitmRouterUrl}: ${error.message}`,
        undefined,
        false
      );
    }

    // Generic error
    return new KiroMitmError(
      `MITM router error at ${mitmRouterUrl}: ${statusCode} ${statusText}`,
      statusCode,
      false
    );
  }

  /**
   * Test connection to MITM router
   * 
   * @param mitmRouterUrl - MITM router URL
   * @returns True if connection successful
   */
  async testConnection(mitmRouterUrl: string): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get(
        `${mitmRouterUrl}/health`,
        {
          timeout: 5000,
        }
      );

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get MITM router version
   * 
   * @param mitmRouterUrl - MITM router URL
   * @returns Version string or null
   */
  async getVersion(mitmRouterUrl: string): Promise<string | null> {
    try {
      const response = await this.axiosInstance.get<{ version: string }>(
        `${mitmRouterUrl}/version`,
        {
          timeout: 5000,
        }
      );

      return response.data.version;
    } catch (error) {
      return null;
    }
  }
}
