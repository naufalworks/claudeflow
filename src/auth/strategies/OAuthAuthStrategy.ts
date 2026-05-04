/**
 * OAuthAuthStrategy
 * 
 * Authentication strategy for OAuth-based accounts.
 * Handles OAuth authentication flow with session management.
 * Supports session refresh and expiry checking.
 */

import axios from 'axios';
import type { AuthStrategy, AuthResult } from './AuthStrategy';
import type { Account, OAuthAccount } from '../../config/schema';

/**
 * Constants for OAuth authentication
 */
const SESSION_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds
const MIN_API_KEY_LENGTH = 20;

/**
 * Private IP ranges for SSRF protection
 */
const PRIVATE_IP_RANGES = [
  /^10\./,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,              // 192.168.0.0/16
  /^169\.254\./,              // Link-local (including AWS metadata)
  /^0\.0\.0\.0$/,             // Special address
];

/**
 * OAuth authentication response
 */
interface OAuthResponse {
  sessionToken: string;
  apiKey: string;
  expiresAt: string;
}

/**
 * Authentication strategy for OAuth-based accounts
 */
export class OAuthAuthStrategy implements AuthStrategy {
  /**
   * Authenticate an OAuth account
   * 
   * Performs OAuth login flow by calling /auth/login endpoint.
   * Returns session token and expiry time.
   * 
   * @param account - Account to authenticate
   * @returns Authentication result with session token or error
   */
  async authenticate(account: Account): Promise<AuthResult> {
    // Type guard: ensure this is an OAuth account
    if (account.provider !== 'kiro') {
      return {
        success: false,
        error: 'Invalid account type',
      };
    }

    const oauthAccount = account as OAuthAccount;

    // Validate required fields
    const validation = this.validateOAuthAccount(oauthAccount);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Invalid OAuth configuration',
      };
    }

    try {
      // Call OAuth router to authenticate
      const response = await axios.post<OAuthResponse>(
        `${oauthAccount.kiroConfig.mitmRouterUrl}/auth/login`,
        {
          machineId: oauthAccount.kiroConfig.machineId,
          apiKey: oauthAccount.apiKey,
        },
        {
          timeout: REQUEST_TIMEOUT_MS,
        }
      );

      // Validate response structure
      if (!this.isValidOAuthResponse(response.data)) {
        return {
          success: false,
          error: 'Invalid authentication response',
        };
      }

      return {
        success: true,
        sessionToken: response.data.sessionToken,
        expiresAt: new Date(response.data.expiresAt),
      };
    } catch (error) {
      // Generic error message for security
      return {
        success: false,
        error: 'OAuth authentication failed',
      };
    }
  }

  /**
   * Refresh an expired OAuth session
   * 
   * Performs OAuth refresh flow by calling /auth/refresh endpoint.
   * Returns new session token and expiry time.
   * 
   * @param account - Account with expired session
   * @returns Refreshed authentication result or error
   */
  async refreshSession(account: Account): Promise<AuthResult> {
    // Type guard: ensure this is an OAuth account
    if (account.provider !== 'kiro') {
      return {
        success: false,
        error: 'Invalid account type',
      };
    }

    const oauthAccount = account as OAuthAccount;

    // Validate required fields including session token
    if (!oauthAccount.kiroConfig.sessionToken) {
      return {
        success: false,
        error: 'Invalid OAuth configuration',
      };
    }

    const validation = this.validateOAuthAccount(oauthAccount);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Invalid OAuth configuration',
      };
    }

    try {
      // Call OAuth router to refresh session
      const response = await axios.post<OAuthResponse>(
        `${oauthAccount.kiroConfig.mitmRouterUrl}/auth/refresh`,
        {
          machineId: oauthAccount.kiroConfig.machineId,
          sessionToken: oauthAccount.kiroConfig.sessionToken,
        },
        {
          timeout: REQUEST_TIMEOUT_MS,
        }
      );

      // Validate response structure
      if (!this.isValidOAuthResponse(response.data)) {
        return {
          success: false,
          error: 'Invalid refresh response',
        };
      }

      return {
        success: true,
        sessionToken: response.data.sessionToken,
        expiresAt: new Date(response.data.expiresAt),
      };
    } catch (error) {
      // Generic error message for security
      return {
        success: false,
        error: 'Session refresh failed',
      };
    }
  }

  /**
   * Check if OAuth session needs refresh
   * 
   * Returns true if session is expired or will expire within 5 minutes.
   * 
   * @param account - Account to check
   * @returns True if session needs refresh
   */
  needsRefresh(account: Account): boolean {
    // Type guard
    if (account.provider !== 'kiro') {
      return false;
    }

    const oauthAccount = account as OAuthAccount;

    // No session expiry set, needs authentication
    if (!oauthAccount.kiroConfig.sessionExpiry) {
      return true;
    }

    const now = Date.now();
    const expiryTime = oauthAccount.kiroConfig.sessionExpiry.getTime();

    // Refresh if within 5 minutes of expiry
    return expiryTime - now < SESSION_REFRESH_BUFFER_MS;
  }

  /**
   * Validate OAuth account configuration
   * 
   * Checks:
   * - API key exists and has minimum length
   * - Machine ID exists
   * - MITM router URL is valid with SSRF protection
   * 
   * @param account - OAuth account to validate
   * @returns Validation result
   */
  private validateOAuthAccount(account: OAuthAccount): { valid: boolean; error?: string } {
    // Validate API key
    if (!account.apiKey || account.apiKey.trim().length < MIN_API_KEY_LENGTH) {
      return { valid: false, error: 'Invalid API key' };
    }

    // Validate machine ID
    if (!account.kiroConfig.machineId || account.kiroConfig.machineId.trim().length === 0) {
      return { valid: false, error: 'Invalid machine ID' };
    }

    // Validate MITM router URL
    if (!account.kiroConfig.mitmRouterUrl) {
      return { valid: false, error: 'Invalid MITM router URL' };
    }

    const urlValidation = this.validateMitmRouterUrl(account.kiroConfig.mitmRouterUrl);
    if (!urlValidation.valid) {
      return urlValidation;
    }

    return { valid: true };
  }

  /**
   * Validate MITM router URL with SSRF protection
   * 
   * Enforces:
   * - Valid URL format
   * - HTTP or HTTPS protocol
   * - Blocks private IP ranges (except localhost)
   * 
   * @param url - URL to validate
   * @returns Validation result
   */
  private validateMitmRouterUrl(url: string): { valid: boolean; error?: string } {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }

    // Validate protocol
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return { valid: false, error: 'Invalid protocol' };
    }

    // Validate hostname exists
    if (!parsedUrl.hostname) {
      return { valid: false, error: 'Missing hostname' };
    }

    // Check if this is localhost
    const isLocalhost = this.isLocalhostAddress(parsedUrl.hostname);

    // SSRF protection: block private IPs for non-localhost
    if (!isLocalhost && this.isPrivateIP(parsedUrl.hostname)) {
      return { valid: false, error: 'Private IP addresses not allowed' };
    }

    return { valid: true };
  }

  /**
   * Check if hostname is localhost
   * 
   * @param hostname - Hostname to check
   * @returns True if localhost
   */
  private isLocalhostAddress(hostname: string): boolean {
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1'
    );
  }

  /**
   * Check if hostname is a private IP address
   * 
   * @param hostname - Hostname to check
   * @returns True if private IP
   */
  private isPrivateIP(hostname: string): boolean {
    // Check against private IP patterns
    for (const pattern of PRIVATE_IP_RANGES) {
      if (pattern.test(hostname)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate OAuth response structure
   * 
   * @param response - Response to validate
   * @returns True if valid
   */
  private isValidOAuthResponse(response: any): response is OAuthResponse {
    return (
      response &&
      typeof response === 'object' &&
      typeof response.sessionToken === 'string' &&
      response.sessionToken.length > 0 &&
      typeof response.expiresAt === 'string' &&
      response.expiresAt.length > 0
    );
  }
}
