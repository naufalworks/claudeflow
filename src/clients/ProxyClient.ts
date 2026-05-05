/**
 * ProxyClient
 * 
 * Client for communication with Anthropic-compatible proxy servers.
 * Handles requests to proxy endpoints that forward raw Anthropic format unchanged.
 * 
 * CRITICAL: This is ONLY for true MITM proxies that preserve raw Anthropic format.
 * NOT for 9router or other proxies that convert to OpenAI format.
 * 
 * CRITICAL: Validates that all responses are in raw Anthropic format.
 * ClaudeFlow ONLY supports raw Anthropic format - no format conversion.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type { AnthropicRequest, AnthropicResponse } from '../types/anthropic.types';
import { ResponseFormatValidator } from './ResponseFormatValidator.js';

/**
 * Anthropic API version
 */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Proxy client error
 */
export class ProxyClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isAuthError: boolean = false
  ) {
    super(message);
    this.name = 'ProxyClientError';
  }
}

/**
 * ProxyClient class
 * 
 * Provides access to Anthropic-compatible proxy servers with format validation.
 * 
 * IMPORTANT: Only use with proxies that forward raw Anthropic format unchanged.
 * Proxies that convert to OpenAI format (like 9router) are NOT supported.
 */
export class ProxyClient {
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
   * Send request to Anthropic-compatible proxy
   * 
   * IMPORTANT: The proxy MUST return raw Anthropic format.
   * If the proxy converts to OpenAI format, this will fail with a clear error.
   * 
   * @param request - Anthropic request
   * @param apiKey - API key for the proxy
   * @param baseURL - Proxy base URL (e.g., "http://localhost:20128")
   * @returns Anthropic response in raw format
   * @throws ProxyClientError if request fails or response format is invalid
   */
  async sendRequest(
    request: AnthropicRequest,
    apiKey: string,
    baseURL: string
  ): Promise<AnthropicResponse> {
    try {
      const response = await this.axiosInstance.post<AnthropicResponse>(
        `${baseURL}/v1/messages`,
        request,
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
        }
      );

      // CRITICAL: Validate response is in raw Anthropic format
      if (!this.validator.isAnthropicFormat(response.data)) {
        // Get detailed validation errors
        const validationResult = this.validator.validateDetailed(response.data);

        throw new ProxyClientError(
          `❌ PROXY REJECTED: ${baseURL} returned non-Anthropic format response.\n\n` +
          `ClaudeFlow ONLY supports proxies that forward raw Anthropic format unchanged.\n\n` +
          `Validation errors:\n${validationResult.errors.map(e => `  • ${e}`).join('\n')}\n\n` +
          `SOLUTION:\n` +
          `  1. Use direct Anthropic API (recommended)\n` +
          `  2. Use a true MITM proxy that forwards Anthropic format unchanged\n` +
          `  3. Use Kiro OAuth for free Claude access\n\n` +
          `NOT SUPPORTED:\n` +
          `  ❌ 9router (converts to OpenAI format)\n` +
          `  ❌ OpenRouter (OpenAI format)\n` +
          `  ❌ Any proxy that converts formats\n\n` +
          `See docs/ANTHROPIC_FORMAT_ONLY.md for migration guide.`,
          response.status,
          false
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error, baseURL);
      }
      throw error;
    }
  }

  /**
   * Send streaming request to Anthropic-compatible proxy
   * 
   * @param request - Anthropic request with stream: true
   * @param apiKey - API key for the proxy
   * @param baseURL - Proxy base URL (e.g., "http://localhost:20128")
   * @returns Async iterable of server-sent events
   * @throws ProxyClientError if request fails
   */
  async *sendStreamingRequest(
    request: AnthropicRequest,
    apiKey: string,
    baseURL: string
  ): AsyncIterable<string> {
    try {
      const response = await this.axiosInstance.post(
        `${baseURL}/v1/messages`,
        { ...request, stream: true },
        {
          headers: {
            'x-api-key': apiKey,
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
        throw this.handleAxiosError(error, baseURL);
      }
      throw error;
    }
  }

  /**
   * Handle axios errors and convert to ProxyClientError
   * 
   * @param error - Axios error
   * @param baseURL - Proxy base URL for error messages
   * @returns ProxyClientError with appropriate message
   */
  private handleAxiosError(error: AxiosError, baseURL: string): ProxyClientError {
    const statusCode = error.response?.status;
    const statusText = error.response?.statusText;

    // Check for authentication error (401)
    if (statusCode === 401) {
      return new ProxyClientError(
        `Proxy authentication failed at ${baseURL}. Invalid API key.`,
        statusCode,
        true // isAuthError
      );
    }

    // Check for rate limiting (429)
    if (statusCode === 429) {
      return new ProxyClientError(
        `Proxy rate limit exceeded at ${baseURL}. Please retry later.`,
        statusCode,
        false
      );
    }

    // Check for bad request (400)
    if (statusCode === 400) {
      const errorMessage = error.response?.data
        ? JSON.stringify(error.response.data)
        : 'Bad request';
      return new ProxyClientError(
        `Invalid request to proxy at ${baseURL}: ${errorMessage}`,
        statusCode,
        false
      );
    }

    // Check for service errors (500, 503)
    if (statusCode && statusCode >= 500) {
      return new ProxyClientError(
        `Proxy service error at ${baseURL}: ${statusCode} ${statusText}`,
        statusCode,
        false
      );
    }

    // Network errors (no response)
    if (!error.response) {
      return new ProxyClientError(
        `Network error connecting to proxy at ${baseURL}: ${error.message}`,
        undefined,
        false
      );
    }

    // Generic error
    return new ProxyClientError(
      `Proxy error at ${baseURL}: ${statusCode} ${statusText}`,
      statusCode,
      false
    );
  }

  /**
   * Test connection to Anthropic-compatible proxy
   * 
   * Makes a minimal request to verify proxy connectivity and format compatibility.
   * 
   * @param apiKey - API key for the proxy
   * @param baseURL - Proxy base URL to test
   * @returns True if connection successful and proxy returns raw Anthropic format
   */
  async testConnection(apiKey: string, baseURL: string): Promise<boolean> {
    try {
      await this.sendRequest(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        },
        apiKey,
        baseURL
      );
      return true;
    } catch (error) {
      return false;
    }
  }
}
