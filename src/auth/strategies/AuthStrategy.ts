/**
 * Authentication Strategy Interface
 * 
 * Defines the contract for authentication strategies supporting multiple account types.
 * Uses the Strategy Pattern to enable flexible authentication across:
 * - Direct Anthropic accounts (API key only)
 * - Proxy accounts (API key + baseURL)
 * - OAuth accounts (session-based with refresh)
 */

import type { Account } from '../../config/schema';

/**
 * Result of an authentication operation
 */
export interface AuthResult {
  /**
   * Whether authentication was successful
   */
  success: boolean;

  /**
   * API key for direct Anthropic or proxy accounts
   */
  apiKey?: string;

  /**
   * Base URL for proxy accounts
   */
  baseURL?: string;

  /**
   * Session token for OAuth accounts
   */
  sessionToken?: string;

  /**
   * Session expiry time for OAuth accounts
   */
  expiresAt?: Date;

  /**
   * Error message if authentication failed
   */
  error?: string;
}

/**
 * Authentication strategy interface
 * 
 * Implementations must provide an authenticate() method.
 * OAuth-based strategies should also implement refreshSession() and needsRefresh().
 */
export interface AuthStrategy {
  /**
   * Authenticate an account and return credentials
   * 
   * @param account - Account to authenticate
   * @returns Authentication result with credentials or error
   */
  authenticate(account: Account): Promise<AuthResult>;

  /**
   * Refresh an expired session (OAuth only)
   * 
   * @param account - Account with expired session
   * @returns Refreshed authentication result
   */
  refreshSession?(account: Account): Promise<AuthResult>;

  /**
   * Check if account session needs refresh (OAuth only)
   * 
   * @param account - Account to check
   * @returns True if session needs refresh
   */
  needsRefresh?(account: Account): boolean | Promise<boolean>;
}
