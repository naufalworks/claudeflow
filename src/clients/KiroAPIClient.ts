/**
 * KiroAPIClient
 *
 * Direct API client for Kiro (AWS CodeWhisperer) API.
 * Communicates directly with Kiro infrastructure without any proxy/router.
 *
 * Key features:
 * - Direct OAuth Bearer token authentication
 * - TLS 1.2+ enforcement with certificate validation
 * - Exponential backoff retry logic with jitter
 * - Comprehensive error classification
 * - Response format validation
 * - Region allowlist validation (SSRF prevention)
 * - Token sanitization in error messages
 *
 * Security:
 * - Enforces TLS 1.2+ with certificate validation
 * - Validates region against strict allowlist
 * - Sanitizes tokens from error messages
 * - Validates all inputs before use
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type { AnthropicRequest, AnthropicResponse } from '../types/anthropic.types';
import type { KiroAPIConfig, KiroAPIError } from '../types/kiro-oauth.types';
import { ResponseFormatValidator } from './ResponseFormatValidator.js';
import { createTLSAgent } from '../utils/tls-config.js';

/**
 * Valid AWS regions for Kiro API
 * Strict allowlist to prevent SSRF attacks
 */
const VALID_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-central-1',
  'ap-southeast-1',
] as const;

type ValidRegion = typeof VALID_REGIONS[number];

/**
 * KiroAPIClient class
 *
 * Handles direct communication with Kiro API using OAuth Bearer tokens.
 */
export class KiroAPIClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly validator: ResponseFormatValidator;

  // Configuration constants
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_RETRY_DELAY_MS = 1000;
  private static readonly JITTER_MAX_MS = 500;
  private static readonly DEFAULT_READ_TIMEOUT_MS = 60000;

  constructor() {
    // Create HTTPS agent with centralized TLS configuration
    const httpsAgent = createTLSAgent();

    // Create axios instance with security hardening
    this.axiosInstance = axios.create({
      timeout: KiroAPIClient.DEFAULT_READ_TIMEOUT_MS,
      httpsAgent,
      headers: {
        'Content-Type': 'application/json',
      },
      // Disable automatic redirects for security
      maxRedirects: 0,
    });

    this.validator = new ResponseFormatValidator();
  }

  /**
   * Send request to Kiro API
   *
   * @param request - Anthropic API request
   * @param accessToken - OAuth Bearer token
   * @param config - API configuration
   * @returns Anthropic API response
   * @throws KiroAPIError on failure
   */
  async sendRequest(
    request: AnthropicRequest,
    accessToken: string,
    config: KiroAPIConfig
  ): Promise<AnthropicResponse> {
    // Validate inputs
    this.validateAccessToken(accessToken);
    this.validateRequest(request);

    const endpoint = this.getEndpoint(config.region);

    // Wrap in retry logic
    return this.retryWithBackoff(async () => {
      try {
        const response = await this.axiosInstance.post<AnthropicResponse>(
          endpoint,
          request,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'anthropic-version': '2023-06-01',
            },
            timeout: config.timeout.read,
          }
        );

        // Validate response format
        if (!this.validator.isAnthropicFormat(response.data)) {
          throw new Error(
            'Invalid response format: Expected Anthropic format, got non-compliant response'
          );
        }

        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          // Sanitize error before throwing
          const sanitized = this.sanitizeError(error);
          throw this.handleAxiosError(sanitized);
        }
        throw error;
      }
    }, config.retries || KiroAPIClient.MAX_RETRIES);
  }

  /**
   * Send streaming request to Kiro API
   *
   * @param request - Anthropic API request with stream: true
   * @param accessToken - OAuth Bearer token
   * @param config - API configuration
   * @returns Async iterable of server-sent events
   * @throws KiroAPIError on failure
   */
  async *sendStreamingRequest(
    request: AnthropicRequest,
    accessToken: string,
    config: KiroAPIConfig
  ): AsyncIterable<string> {
    // Validate inputs
    this.validateAccessToken(accessToken);
    this.validateRequest(request);

    const endpoint = this.getEndpoint(config.region);

    try {
      const response = await this.axiosInstance.post(
        endpoint,
        { ...request, stream: true },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'anthropic-version': '2023-06-01',
          },
          timeout: config.timeout.read,
          responseType: 'stream',
        }
      );

      // Stream response chunks
      const stream = response.data;

      for await (const chunk of stream) {
        // Validate chunk encoding
        if (!Buffer.isBuffer(chunk)) {
          throw new Error('Invalid stream chunk: Expected Buffer');
        }

        // Convert to UTF-8 string
        const chunkStr = chunk.toString('utf-8');
        yield chunkStr;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        // Sanitize error before throwing
        const sanitized = this.sanitizeError(error);
        throw this.handleAxiosError(sanitized);
      }
      throw error;
    }
  }

  /**
   * Perform health check on Kiro API
   *
   * Sends a minimal request to verify connectivity and authentication.
   *
   * @param accessToken - OAuth Bearer token
   * @param config - API configuration
   * @returns True if health check succeeds
   */
  async healthCheck(accessToken: string, config: KiroAPIConfig): Promise<boolean> {
    try {
      // Minimal request to test connectivity
      const minimalRequest: AnthropicRequest = {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      };

      const response = await this.sendRequest(minimalRequest, accessToken, config);

      // Verify response has valid message ID
      return response.id.startsWith('msg_');
    } catch (error) {
      // Health check failed
      return false;
    }
  }

  /**
   * Get API endpoint URL for region
   *
   * Validates region against allowlist to prevent SSRF attacks.
   *
   * @param region - AWS region
   * @returns API endpoint URL
   * @throws Error if region is invalid
   */
  getEndpoint(region: string): string {
    // Validate region against strict allowlist
    if (!VALID_REGIONS.includes(region as ValidRegion)) {
      throw new Error(
        `Invalid region: ${region}. Must be one of: ${VALID_REGIONS.join(', ')}`
      );
    }

    return `https://codewhisperer.${region}.amazonaws.com/v1/messages`;
  }

  /**
   * Validate access token format
   *
   * @param token - Access token to validate
   * @throws Error if token is invalid
   */
  private validateAccessToken(token: string): void {
    if (!token || typeof token !== 'string') {
      throw new Error('Access token is required and must be a string');
    }

    if (token.trim().length === 0) {
      throw new Error('Access token cannot be empty');
    }

    // Basic format check - should be a reasonable length
    if (token.length < 20) {
      throw new Error('Access token appears to be invalid (too short)');
    }
  }

  /**
   * Validate request structure
   *
   * @param request - Request to validate
   * @throws Error if request is invalid
   */
  private validateRequest(request: AnthropicRequest): void {
    if (!request || typeof request !== 'object') {
      throw new Error('Request must be an object');
    }

    if (!request.model || typeof request.model !== 'string') {
      throw new Error('Request must include a valid model string');
    }

    if (!request.messages || !Array.isArray(request.messages)) {
      throw new Error('Request must include messages array');
    }

    if (request.messages.length === 0) {
      throw new Error('Request messages array cannot be empty');
    }

    if (typeof request.max_tokens !== 'number' || request.max_tokens < 1) {
      throw new Error('Request must include valid max_tokens (positive number)');
    }
  }

  /**
   * Handle axios errors and convert to KiroAPIError
   *
   * Classifies errors by type and determines if they are retryable.
   *
   * @param error - Axios error
   * @returns Structured KiroAPIError
   */
  private handleAxiosError(error: AxiosError): KiroAPIError {
    const statusCode = error.response?.status || 0;

    // 401/403 - Authentication failure (not retryable)
    if (statusCode === 401 || statusCode === 403) {
      return {
        statusCode,
        message: 'Authentication failed. Token may be expired or invalid.',
        type: 'auth',
        retryable: false,
      };
    }

    // 429 - Rate limit (retryable with backoff)
    if (statusCode === 429) {
      const retryAfter = this.parseRetryAfter(error);
      return {
        statusCode,
        message: `Rate limit exceeded. Retry after ${retryAfter}s`,
        type: 'rate-limit',
        retryable: true,
        retryAfter,
      };
    }

    // 402 - Quota exhausted (not retryable)
    if (statusCode === 402) {
      return {
        statusCode,
        message: 'Quota exhausted for this account',
        type: 'quota',
        retryable: false,
      };
    }

    // 5xx - Server error (retryable)
    if (statusCode >= 500 && statusCode < 600) {
      return {
        statusCode,
        message: `Server error: ${statusCode} ${error.response?.statusText || ''}`,
        type: 'server',
        retryable: true,
      };
    }

    // Network error (no response) - retryable
    if (!error.response) {
      return {
        statusCode: 0,
        message: `Network error: ${error.message}`,
        type: 'network',
        retryable: true,
      };
    }

    // Other errors (4xx client errors) - not retryable
    return {
      statusCode,
      message: `API error: ${statusCode} ${error.response?.statusText || ''}`,
      type: 'server',
      retryable: false,
    };
  }

  /**
   * Parse Retry-After header from rate limit response
   *
   * @param error - Axios error with response
   * @returns Retry delay in seconds
   */
  private parseRetryAfter(error: AxiosError): number {
    const headers = error.response?.headers;
    if (!headers) return 60;

    // Try standard Retry-After header
    const retryAfter = headers['retry-after'] || headers['Retry-After'];
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }

    // Try X-RateLimit-Reset header (Unix timestamp)
    const resetHeader = headers['x-ratelimit-reset'] || headers['X-RateLimit-Reset'];
    if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10);
      if (!isNaN(resetTime)) {
        const now = Math.floor(Date.now() / 1000);
        const delay = Math.max(0, resetTime - now);
        return delay > 0 ? delay : 60;
      }
    }

    // Default to 60 seconds
    return 60;
  }

  /**
   * Retry operation with exponential backoff
   *
   * Implements exponential backoff with jitter to prevent thundering herd.
   *
   * @param operation - Async operation to retry
   * @param maxRetries - Maximum number of retry attempts
   * @returns Result of successful operation
   * @throws Last error if all retries fail
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = KiroAPIClient.MAX_RETRIES
  ): Promise<T> {
    let lastError: Error | KiroAPIError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        // Don't retry if not retryable or max retries reached
        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        // Calculate exponential backoff with jitter
        const baseDelay = KiroAPIClient.BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        const jitter = Math.random() * KiroAPIClient.JITTER_MAX_MS;
        const delay = baseDelay + jitter;

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError!;
  }

  /**
   * Check if error is retryable
   *
   * @param error - Error to check
   * @returns True if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'retryable' in error) {
      return (error as KiroAPIError).retryable;
    }
    return false;
  }

  /**
   * Sanitize error by removing sensitive information
   *
   * Removes Authorization headers from error context to prevent token leakage.
   *
   * @param error - Axios error to sanitize
   * @returns Sanitized error
   */
  private sanitizeError(error: AxiosError): AxiosError {
    // Remove Authorization header from error config
    if (error.config?.headers) {
      const sanitizedConfig = { ...error.config };
      
      // Create new headers object without Authorization
      const headers = error.config.headers;
      const sanitizedHeaders: Record<string, string> = {};
      
      // Copy all headers except Authorization variants
      for (const key in headers) {
        if (key.toLowerCase() !== 'authorization') {
          sanitizedHeaders[key] = String(headers[key]);
        }
      }

      sanitizedConfig.headers = sanitizedHeaders as any;
      error.config = sanitizedConfig;
    }

    return error;
  }
}
