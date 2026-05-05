/**
 * AWS SSO OIDC Device Code Flow Client
 *
 * Implements the correct authentication flow for Kiro/AWS Builder ID:
 * 1. RegisterClient - Get clientId and clientSecret
 * 2. StartDeviceAuthorization - Get device code and user code
 * 3. Show user the verification URL and code
 * 4. Poll CreateToken until user authorizes
 *
 * This is the CORRECT flow used by 9router, not the Authorization Code Flow.
 */

import axios, { AxiosError } from 'axios';
import type { OAuthTokens } from '../types/kiro-oauth.types.js';
import { AuthenticationError } from '../errors/kiro-errors.js';
import { createTLSAgent } from '../utils/tls-config.js';

/**
 * Device authorization response
 */
export interface DeviceAuthorizationResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

/**
 * Client registration response
 */
export interface ClientRegistration {
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt: number;
}

/**
 * Device Code Flow client for AWS SSO OIDC
 */
export class DeviceCodeClient {
  // AWS SSO OIDC endpoints
  private static readonly SSO_OIDC_BASE = 'https://oidc.{region}.amazonaws.com';
  private static readonly REGISTER_CLIENT_PATH = '/client/register';
  private static readonly DEVICE_AUTH_PATH = '/device_authorization';
  private static readonly TOKEN_PATH = '/token';

  // Kiro configuration
  private static readonly CLIENT_NAME = 'claudeflow-kiro-client';
  private static readonly CLIENT_TYPE = 'public';
  private static readonly SCOPES = [
    'codewhisperer:completions',
    'codewhisperer:analysis',
    'codewhisperer:conversations',
  ];
  private static readonly GRANT_TYPES = [
    'urn:ietf:params:oauth:grant-type:device_code',
    'refresh_token',
  ];
  private static readonly ISSUER_URL = 'https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6';

  // AWS Builder ID start URL
  private static readonly BUILDER_ID_START_URL = 'https://view.awsapps.com/start';

  // Polling configuration
  private static readonly DEFAULT_POLL_INTERVAL = 5000; // 5 seconds
  private static readonly MAX_POLL_ATTEMPTS = 60; // 5 minutes total

  /**
   * Register a new OIDC client with AWS SSO
   */
  async registerClient(region: string = 'us-east-1'): Promise<ClientRegistration> {
    const endpoint = DeviceCodeClient.SSO_OIDC_BASE.replace('{region}', region) +
                     DeviceCodeClient.REGISTER_CLIENT_PATH;

    try {
      const response = await axios.post(
        endpoint,
        {
          clientName: DeviceCodeClient.CLIENT_NAME,
          clientType: DeviceCodeClient.CLIENT_TYPE,
          scopes: DeviceCodeClient.SCOPES,
          grantTypes: DeviceCodeClient.GRANT_TYPES,
          issuerUrl: DeviceCodeClient.ISSUER_URL,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
          httpsAgent: createTLSAgent(),
        }
      );

      return {
        clientId: response.data.clientId,
        clientSecret: response.data.clientSecret,
        clientSecretExpiresAt: response.data.clientSecretExpiresAt,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new AuthenticationError(
          'Client registration',
          `Failed to register client: ${error.response?.data?.error_description || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Start device authorization flow
   */
  async startDeviceAuthorization(
    clientId: string,
    clientSecret: string,
    startUrl: string = DeviceCodeClient.BUILDER_ID_START_URL,
    region: string = 'us-east-1'
  ): Promise<DeviceAuthorizationResponse> {
    const endpoint = DeviceCodeClient.SSO_OIDC_BASE.replace('{region}', region) +
                     DeviceCodeClient.DEVICE_AUTH_PATH;

    try {
      const response = await axios.post(
        endpoint,
        {
          clientId,
          clientSecret,
          startUrl,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
          httpsAgent: createTLSAgent(),
        }
      );

      return {
        deviceCode: response.data.deviceCode,
        userCode: response.data.userCode,
        verificationUri: response.data.verificationUri,
        verificationUriComplete: response.data.verificationUriComplete,
        expiresIn: response.data.expiresIn,
        interval: response.data.interval || DeviceCodeClient.DEFAULT_POLL_INTERVAL / 1000,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new AuthenticationError(
          'Device authorization',
          `Failed to start device authorization: ${error.response?.data?.error_description || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Poll for token using device code
   * Returns null if authorization is still pending
   */
  async pollForToken(
    clientId: string,
    clientSecret: string,
    deviceCode: string,
    region: string = 'us-east-1'
  ): Promise<OAuthTokens | null> {
    const endpoint = DeviceCodeClient.SSO_OIDC_BASE.replace('{region}', region) +
                     DeviceCodeClient.TOKEN_PATH;

    try {
      const response = await axios.post(
        endpoint,
        {
          clientId,
          clientSecret,
          deviceCode,
          grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000, // Shorter timeout for polling
          httpsAgent: createTLSAgent(),
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        }
      );

      const data = response.data;

      // Check for errors in response
      if (data.error) {
        const errorCode = data.error;

        // Authorization pending - user hasn't authorized yet
        if (errorCode === 'authorization_pending') {
          return null;
        }

        // Slow down - we're polling too fast
        if (errorCode === 'slow_down') {
          return null;
        }

        // Expired token - device code expired
        if (errorCode === 'expired_token') {
          throw new AuthenticationError(
            'Device code expired',
            'The device code has expired. Please start the login process again.'
          );
        }

        // Access denied - user denied authorization
        if (errorCode === 'access_denied') {
          throw new AuthenticationError(
            'Access denied',
            'User denied authorization request.'
          );
        }

        // Other errors
        throw new AuthenticationError(
          'Token polling',
          `Token error: ${data.error_description || data.error}`
        );
      }

      const { accessToken, refreshToken, expiresIn, tokenType } = data;

      if (!accessToken || !refreshToken) {
        throw new Error('Token response missing required fields');
      }

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      return {
        accessToken,
        refreshToken,
        expiresAt,
        tokenType: tokenType || 'Bearer',
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      if (error instanceof AxiosError) {
        // Network errors - return null to retry
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
          console.log(`Network error during polling (${error.code}), will retry...`);
          return null;
        }

        throw new AuthenticationError(
          'Token polling',
          `Failed to poll for token: ${error.response?.data?.error_description || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Complete device code flow with automatic polling
   */
  async completeDeviceCodeFlow(
    clientId: string,
    clientSecret: string,
    deviceCode: string,
    pollInterval: number = DeviceCodeClient.DEFAULT_POLL_INTERVAL,
    region: string = 'us-east-1'
  ): Promise<OAuthTokens> {
    let attempts = 0;

    while (attempts < DeviceCodeClient.MAX_POLL_ATTEMPTS) {
      // Wait before polling (except first attempt)
      if (attempts > 0) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      const tokens = await this.pollForToken(clientId, clientSecret, deviceCode, region);

      if (tokens) {
        return tokens;
      }

      attempts++;
    }

    throw new AuthenticationError(
      'Device code flow timeout',
      'User did not authorize within the time limit. Please try again.'
    );
  }

  /**
   * Full device code login flow
   */
  async login(
    startUrl: string = DeviceCodeClient.BUILDER_ID_START_URL,
    region: string = 'us-east-1'
  ): Promise<{
    tokens: OAuthTokens;
    clientId: string;
    clientSecret: string;
  }> {
    // Step 1: Register client
    const registration = await this.registerClient(region);

    // Step 2: Start device authorization
    const deviceAuth = await this.startDeviceAuthorization(
      registration.clientId,
      registration.clientSecret,
      startUrl,
      region
    );

    // Step 3: Display user code and verification URL
    console.log('\n🔐 AWS Builder ID Authentication\n');
    console.log('Visit the login URL below and authorize:\n');
    console.log('Login URL:');
    console.log(deviceAuth.verificationUriComplete);
    console.log('\nYour Code:');
    console.log(deviceAuth.userCode);
    console.log('\nWaiting for authorization...\n');

    // Step 4: Poll for token
    const tokens = await this.completeDeviceCodeFlow(
      registration.clientId,
      registration.clientSecret,
      deviceAuth.deviceCode,
      deviceAuth.interval * 1000,
      region
    );

    return {
      tokens,
      clientId: registration.clientId,
      clientSecret: registration.clientSecret,
    };
  }

  /**
   * Refresh token using refresh token
   */
  async refreshToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    region: string = 'us-east-1'
  ): Promise<OAuthTokens> {
    const endpoint = DeviceCodeClient.SSO_OIDC_BASE.replace('{region}', region) +
                     DeviceCodeClient.TOKEN_PATH;

    try {
      const response = await axios.post(
        endpoint,
        {
          clientId,
          clientSecret,
          refreshToken,
          grantType: 'refresh_token',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
          httpsAgent: createTLSAgent(),
        }
      );

      const { accessToken, refreshToken: newRefreshToken, expiresIn, tokenType } = response.data;

      if (!accessToken) {
        throw new Error('Token response missing access token');
      }

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      return {
        accessToken,
        refreshToken: newRefreshToken || refreshToken,
        expiresAt,
        tokenType: tokenType || 'Bearer',
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new AuthenticationError(
            'Token refresh',
            'Refresh token expired or invalid. Please login again.'
          );
        }
        throw new Error(`Token refresh failed: ${error.response?.data?.error_description || error.message}`);
      }
      throw error;
    }
  }
}
