/**
 * AnthropicClient
 * 
 * Client for direct communication with Anthropic API.
 * Handles requests to api.anthropic.com with API key authentication.
 * 
 * CRITICAL: Validates that all responses are in raw Anthropic format.
 * ClaudeFlow ONLY supports raw Anthropic format - no format conversion.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type { AnthropicRequest, AnthropicResponse } from '../types/anthropic.types';
import { ResponseFormatValidator } from './ResponseFormatValidator.js';

/**
 * Anthropic API endpoint
 */
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Anthropic API version
 */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic client error
 */
export class AnthropicClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isAuthError: boolean = false
  ) {
    super(message);
    this.name = 'AnthropicClientError';
  }
}

/**
 * AnthropicClient class
 * 
 * Provides direct access to Anthropic API with format validation.
 */
export class AnthropicClient {
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
   * Send request to Anthropic API
   * 
   * @param request - Anthropic request
   * @param apiKey - Anthropic API key (sk-ant-...)
   * @returns Anthropic response in raw format
   * @throws AnthropicClientError if request fails or response format is invalid
   */
  async sendRequest(
    request: AnthropicRequest,
    apiKey: string
  ): Promise<AnthropicResponse> {
    try {
      const response = await this.axiosInstance.post<AnthropicResponse>(
        ANTHROPIC_API_URL,
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
        throw new AnthropicClientError(
          'Response from Anthropic API is not in expected raw Anthropic format. ' +
          'This should never happen with direct Anthropic API calls.',
          response.status,
          false
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error);
      }
      throw error;
    }
  }

  /**
   * Send streaming request to Anthropic API
   * 
   * @param request - Anthropic request with stream: true
   * @param apiKey - Anthropic API key (sk-ant-...)
   * @returns Async iterable of server-sent events
   * @throws AnthropicClientError if request fails
   */
  async *sendStreamingRequest(
    request: AnthropicRequest,
    apiKey: string
  ): AsyncIterable<string> {
    try {
      const response = await this.axiosInstance.post(
        ANTHROPIC_API_URL,
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
        throw this.handleAxiosError(error);
      }
      throw error;
    }
  }

  /**
   * Handle axios errors and convert to AnthropicClientError
   * 
   * @param error - Axios error
   * @returns AnthropicClientError with appropriate message
   */
  private handleAxiosError(error: AxiosError): AnthropicClientError {
    const statusCode = error.response?.status;
    const statusText = error.response?.statusText;

    // Check for authentication error (401)
    if (statusCode === 401) {
      return new AnthropicClientError(
        'Anthropic API authentication failed. Invalid API key.',
        statusCode,
        true // isAuthError
      );
    }

    // Check for rate limiting (429)
    if (statusCode === 429) {
      return new AnthropicClientError(
        'Anthropic API rate limit exceeded. Please retry later.',
        statusCode,
        false
      );
    }

    // Check for bad request (400)
    if (statusCode === 400) {
      const errorMessage = error.response?.data
        ? JSON.stringify(error.response.data)
        : 'Bad request';
      return new AnthropicClientError(
        `Invalid request to Anthropic API: ${errorMessage}`,
        statusCode,
        false
      );
    }

    // Check for service errors (500, 503)
    if (statusCode && statusCode >= 500) {
      return new AnthropicClientError(
        `Anthropic API service error: ${statusCode} ${statusText}`,
        statusCode,
        false
      );
    }

    // Network errors (no response)
    if (!error.response) {
      return new AnthropicClientError(
        `Network error connecting to Anthropic API: ${error.message}`,
        undefined,
        false
      );
    }

    // Generic error
    return new AnthropicClientError(
      `Anthropic API error: ${statusCode} ${statusText}`,
      statusCode,
      false
    );
  }

  /**
   * Test connection to Anthropic API
   * 
   * Makes a minimal request to verify API key and connectivity.
   * 
   * @param apiKey - Anthropic API key to test
   * @returns True if connection successful
   */
  async testConnection(apiKey: string): Promise<boolean> {
    try {
      await this.sendRequest(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        },
        apiKey
      );
      return true;
    } catch (error) {
      return false;
    }
  }
}
