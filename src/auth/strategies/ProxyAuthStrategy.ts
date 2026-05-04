/**
 * ProxyAuthStrategy
 * 
 * Authentication strategy for Anthropic-compatible proxy accounts.
 * 
 * CRITICAL: This is ONLY for proxies that forward raw Anthropic format unchanged.
 * NOT for 9router (it converts to OpenAI format).
 * 
 * Validates API key and baseURL format with SSRF protection.
 * No OAuth flow or session management required.
 */

import type { AuthStrategy, AuthResult } from './AuthStrategy';
import type { Account, ProxyAccount } from '../../config/schema';

/**
 * Validation constants
 */
const MIN_API_KEY_LENGTH = 20;
const VALID_API_KEY_PATTERN = /^[a-zA-Z0-9_\-\.]+$/;

/**
 * Private IP ranges for SSRF protection
 */
const PRIVATE_IP_RANGES = [
  /^10\./,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,              // 192.168.0.0/16
  /^169\.254\./,              // Link-local (including AWS metadata)
  /^127\./,                   // Loopback (except for localhost exception)
  /^0\.0\.0\.0$/,             // Special address
];

/**
 * Authentication strategy for Anthropic-compatible proxy accounts
 */
export class ProxyAuthStrategy implements AuthStrategy {
  /**
   * Authenticate a proxy account
   * 
   * Validates API key and baseURL format without making external calls.
   * Enforces HTTPS for non-localhost hosts and provides SSRF protection.
   * 
   * @param account - Account to authenticate
   * @returns Authentication result with API key and baseURL or error
   */
  async authenticate(account: Account): Promise<AuthResult> {
    // Type guard: ensure this is a proxy account
    if (account.provider !== 'proxy') {
      return {
        success: false,
        error: 'Invalid account type',
      };
    }

    const proxyAccount = account as ProxyAccount;

    // Validate API key
    if (!this.isValidApiKey(proxyAccount.apiKey)) {
      return {
        success: false,
        error: 'Invalid API key format',
      };
    }

    // Validate baseURL
    if (!proxyAccount.baseURL) {
      return {
        success: false,
        error: 'Invalid proxy configuration',
      };
    }

    const baseURLValidation = this.validateBaseURL(proxyAccount.baseURL);
    if (!baseURLValidation.valid) {
      return {
        success: false,
        error: 'Invalid proxy configuration',
      };
    }

    // Return success with validated credentials
    return {
      success: true,
      apiKey: proxyAccount.apiKey,
      baseURL: proxyAccount.baseURL,
    };
  }

  /**
   * Validate API key format
   * 
   * Checks:
   * - Not empty after trimming
   * - Minimum length requirement
   * - Valid character set
   * 
   * @param apiKey - API key to validate
   * @returns True if format is valid
   */
  private isValidApiKey(apiKey: string): boolean {
    if (!apiKey) {
      return false;
    }

    const trimmedKey = apiKey.trim();

    // Check not empty after trimming
    if (trimmedKey.length === 0) {
      return false;
    }

    // Check minimum length
    if (trimmedKey.length < MIN_API_KEY_LENGTH) {
      return false;
    }

    // Check character set
    if (!VALID_API_KEY_PATTERN.test(trimmedKey)) {
      return false;
    }

    return true;
  }

  /**
   * Validate proxy baseURL with SSRF protection
   * 
   * Enforces:
   * - Valid URL format
   * - HTTPS for non-localhost hosts
   * - HTTP allowed only for localhost/127.0.0.1
   * - Blocks private IP ranges and metadata endpoints
   * 
   * @param baseURL - Base URL to validate
   * @returns Validation result
   */
  private validateBaseURL(baseURL: string): { valid: boolean; error?: string } {
    let url: URL;

    try {
      url = new URL(baseURL);
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }

    // Validate protocol
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { valid: false, error: 'Invalid protocol' };
    }

    // Validate hostname exists
    if (!url.hostname) {
      return { valid: false, error: 'Missing hostname' };
    }

    // Check if this is localhost
    const isLocalhost = this.isLocalhostAddress(url.hostname);

    // HTTP is only allowed for localhost
    if (url.protocol === 'http:' && !isLocalhost) {
      return { valid: false, error: 'HTTPS required for non-localhost hosts' };
    }

    // SSRF protection: block private IPs for non-localhost
    if (!isLocalhost && this.isPrivateIP(url.hostname)) {
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
   * Blocks:
   * - Private IP ranges (10.x, 172.16-31.x, 192.168.x)
   * - Link-local addresses (169.254.x)
   * - Loopback addresses (127.x)
   * - Special addresses (0.0.0.0)
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
}
