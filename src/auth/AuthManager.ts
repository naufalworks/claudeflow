/**
 * AuthManager
 * 
 * Manages authentication across multiple account types using the Strategy Pattern.
 * Delegates authentication to appropriate strategy based on account provider.
 * 
 * Supports three account types:
 * - Direct Anthropic (provider: 'anthropic')
 * - Proxy (provider: 'proxy')
 * - OAuth (provider: 'kiro')
 */

import type { AuthStrategy, AuthResult } from './strategies/AuthStrategy';
import type { Account } from '../config/schema';
import { AnthropicAuthStrategy } from './strategies/AnthropicAuthStrategy.js';
import { ProxyAuthStrategy } from './strategies/ProxyAuthStrategy.js';
import { OAuthAuthStrategy } from './strategies/OAuthAuthStrategy.js';

/**
 * Valid account provider types
 */
const VALID_PROVIDERS = ['anthropic', 'proxy', 'kiro'] as const;

/**
 * Authentication manager using Strategy Pattern
 */
export class AuthManager {
  private strategies: Map<string, AuthStrategy>;

  constructor() {
    // Initialize strategy map with all three strategies
    this.strategies = new Map<string, AuthStrategy>([
      ['anthropic', new AnthropicAuthStrategy()],
      ['proxy', new ProxyAuthStrategy()],
      ['kiro', new OAuthAuthStrategy()],
    ]);
  }

  /**
   * Authenticate an account using the appropriate strategy
   * 
   * Delegates to the strategy based on account.provider.
   * 
   * @param account - Account to authenticate
   * @returns Authentication result with credentials or error
   */
  async authenticate(account: Account): Promise<AuthResult> {
    // Validate provider
    if (!this.isValidProvider(account.provider)) {
      return {
        success: false,
        error: 'Invalid account configuration',
      };
    }

    const strategy = this.strategies.get(account.provider);
    
    if (!strategy) {
      // This should never happen if VALID_PROVIDERS and strategy map are in sync
      return {
        success: false,
        error: 'Authentication not available',
      };
    }

    return strategy.authenticate(account);
  }

  /**
   * Refresh an expired session
   * 
   * Only supported for OAuth accounts. Returns error for other account types.
   * 
   * @param account - Account with expired session
   * @returns Refreshed authentication result or error
   */
  async refreshSession(account: Account): Promise<AuthResult> {
    // Validate provider
    if (!this.isValidProvider(account.provider)) {
      return {
        success: false,
        error: 'Invalid account configuration',
      };
    }

    const strategy = this.strategies.get(account.provider);
    
    if (!strategy) {
      return {
        success: false,
        error: 'Authentication not available',
      };
    }

    // Check if strategy supports session refresh
    if (!strategy.refreshSession) {
      return {
        success: false,
        error: 'Session refresh not supported',
      };
    }

    return strategy.refreshSession(account);
  }

  /**
   * Check if account session needs refresh
   * 
   * Returns true for OAuth accounts that need refresh.
   * Returns false for other account types (no session management).
   * 
   * @param account - Account to check
   * @returns True if session needs refresh
   */
  needsRefresh(account: Account): boolean {
    // Validate provider
    if (!this.isValidProvider(account.provider)) {
      return false;
    }

    const strategy = this.strategies.get(account.provider);
    
    // If strategy doesn't exist or doesn't support refresh, no refresh needed
    if (!strategy || !strategy.needsRefresh) {
      return false;
    }

    return strategy.needsRefresh(account);
  }

  /**
   * Validate account provider
   * 
   * @param provider - Provider to validate
   * @returns True if valid
   */
  private isValidProvider(provider: string): boolean {
    return VALID_PROVIDERS.includes(provider as any);
  }
}
