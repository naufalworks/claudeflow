/**
 * Dual Authentication Mode Handler
 *
 * Handles two authentication modes for Kiro:
 * 1. Kiro Desktop mode - Public client with PKCE (no client secret)
 * 2. AWS SSO mode - Confidential client with client credentials
 *
 * Auto-detects mode based on stored credentials and provides
 * mode-specific token endpoints and refresh request formatting.
 */

import type {
  AuthMode,
  AuthModeConfig,
  KeychainCredentials,
} from '../types/kiro-oauth.types.js';

/**
 * Handler for dual authentication modes
 */
export class DualAuthModeHandler {
  // Default region if not specified
  private static readonly DEFAULT_REGION = 'us-east-1';

  // Token endpoint templates
  private static readonly KIRO_DESKTOP_TOKEN_ENDPOINT = 'https://prod.{region}.auth.desktop.kiro.dev/token';
  private static readonly AWS_SSO_TOKEN_ENDPOINT = 'https://oidc.{region}.amazonaws.com/token';

  /**
   * Detect authentication mode from stored credentials
   *
   * AWS SSO mode requires both clientId and clientSecret.
   * Otherwise, defaults to Kiro Desktop mode (public client).
   *
   * @param credentials - Stored keychain credentials
   * @returns Authentication mode configuration
   */
  detectMode(credentials: KeychainCredentials): AuthModeConfig {
    // Check if both client ID and secret are present
    if (credentials.clientId && credentials.clientSecret) {
      return {
        mode: 'aws-sso',
        tokenEndpoint: '', // Will be set by getTokenEndpoint
        requiresClientSecret: true,
      };
    }

    // Default to Kiro Desktop mode (public client)
    return {
      mode: 'kiro-desktop',
      tokenEndpoint: '', // Will be set by getTokenEndpoint
      requiresClientSecret: false,
    };
  }

  /**
   * Get token endpoint URL for the specified mode and region
   *
   * @param mode - Authentication mode
   * @param region - AWS region (defaults to us-east-1)
   * @returns Token endpoint URL
   */
  getTokenEndpoint(mode: AuthMode, region?: string): string {
    const effectiveRegion = region || DualAuthModeHandler.DEFAULT_REGION;

    // Validate region format (basic check)
    if (!this.isValidRegion(effectiveRegion)) {
      throw new Error(`Invalid region: ${effectiveRegion}`);
    }

    if (mode === 'aws-sso') {
      return DualAuthModeHandler.AWS_SSO_TOKEN_ENDPOINT.replace('{region}', effectiveRegion);
    }

    // Kiro Desktop mode
    return DualAuthModeHandler.KIRO_DESKTOP_TOKEN_ENDPOINT.replace('{region}', effectiveRegion);
  }

  /**
   * Build refresh token request body based on authentication mode
   *
   * @param refreshToken - Refresh token to use
   * @param mode - Authentication mode configuration
   * @param credentials - Stored credentials (required for AWS SSO mode)
   * @returns Request body as key-value pairs
   */
  buildRefreshRequest(
    refreshToken: string,
    mode: AuthModeConfig,
    credentials?: KeychainCredentials
  ): Record<string, string> {
    const baseRequest = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    if (mode.mode === 'aws-sso') {
      // AWS SSO mode requires client credentials
      if (!credentials?.clientId || !credentials?.clientSecret) {
        throw new Error('AWS SSO mode requires clientId and clientSecret');
      }

      return {
        ...baseRequest,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      };
    }

    // Kiro Desktop mode - just the refresh token
    return baseRequest;
  }

  /**
   * Validate region format
   *
   * @param region - Region string to validate
   * @returns True if valid
   */
  private isValidRegion(region: string): boolean {
    // Basic validation: region should match pattern like us-east-1, eu-west-2, etc.
    const regionPattern = /^[a-z]{2}-[a-z]+-\d+$/;
    return regionPattern.test(region);
  }

  /**
   * Get default region
   *
   * @returns Default AWS region
   */
  static getDefaultRegion(): string {
    return DualAuthModeHandler.DEFAULT_REGION;
  }
}
