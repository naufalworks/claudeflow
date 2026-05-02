/**
 * KiroMitmClient
 * 
 * Client for communicating with Kiro MITM router.
 * Handles request proxying while preserving native Anthropic API format.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type { AnthropicRequest } from '../types/anthropic.types';
import type { AnthropicResponse } from '../types/anthropic.types';

/**
 * Kiro MITM request configuration
 */
export interface KiroMitmRequestConfig {
  machineId: string;
  sessionToken?: string;
  apiKey: string;
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

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 60000, // 60 second timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Send request to Anthropic API via MITM router
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
      const response = await this.axiosInstance.post<AnthropicResponse>(
        `${config.mitmRouterUrl}/v1/messages`,
        request,
        {
          headers: {
            'x-machine-id': config.machineId,
            'x-session-token': config.sessionToken || '',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          },
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error);
      }
      throw error;
    }
  }

  /**
   * Send streaming request to Anthropic API via MITM router
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
      const response = await this.axiosInstance.post(
        `${config.mitmRouterUrl}/v1/messages`,
        { ...request, stream: true },
        {
          headers: {
            'x-machine-id': config.machineId,
            'x-session-token': config.sessionToken || '',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
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
   * Handle axios errors and convert to KiroMitmError
   * 
   * @param error - Axios error
   * @returns KiroMitmError
   */
  private handleAxiosError(error: AxiosError): KiroMitmError {
    const statusCode = error.response?.status;
    const statusText = error.response?.statusText;

    // Check for session expiration (401)
    if (statusCode === 401) {
      return new KiroMitmError(
        'Kiro session expired',
        statusCode,
        true // isSessionExpired
      );
    }

    // Check for rate limiting (429)
    if (statusCode === 429) {
      return new KiroMitmError(
        'Rate limit exceeded',
        statusCode,
        false
      );
    }

    // Check for service unavailable (503)
    if (statusCode === 503) {
      return new KiroMitmError(
        'MITM router unavailable',
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
        `Invalid request: ${errorMessage}`,
        statusCode,
        false
      );
    }

    // Network errors (no response)
    if (!error.response) {
      return new KiroMitmError(
        `Network error: ${error.message}`,
        undefined,
        false
      );
    }

    // Generic error
    return new KiroMitmError(
      `MITM router error: ${statusCode} ${statusText}`,
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
