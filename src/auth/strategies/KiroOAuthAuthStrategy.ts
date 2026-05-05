/**
 * KiroOAuthAuthStrategy
 * 
 * Authentication strategy for Kiro OAuth accounts.
 * Uses direct OAuth authentication with KeychainStore for secure credential storage.
 * 
 * Security features:
 * - Secure token retrieval from OS keychain
 * - JWT validation before use
 * - Comprehensive error handling with sanitized messages
 * - Audit logging without credential exposure
 * - Token refresh via TokenManager
 */

import type { AuthStrategy, AuthResult } from './AuthStrategy';
import type { Account, KiroOAuthAccount } from '../../config/schema';
import { KeychainStore } from '../KeychainStore.js';
import { TokenManager } from '../TokenManager.js';
import { JWTValidator } from '../JWTValidator.js';
import { DualAuthModeHandler } from '../DualAuthModeHandler.js';
import { ConfigurationManager } from '../../config/manager.js';
import { logger } from '../../cli/utils/logger.js';
import { logSecurityEvent } from '../../cli/utils/security.js';

/**
 * Expected JWT audience for Kiro OAuth tokens
 */
const KIRO_JWT_AUDIENCE = 'kiro-desktop-client';

/**
 * Authentication strategy for Kiro OAuth accounts
 * 
 * Implements direct OAuth authentication with:
 * - Secure credential storage in OS keychain
 * - JWT token validation
 * - Automatic token refresh
 * - Comprehensive error handling
 */
export class KiroOAuthAuthStrategy implements AuthStrategy {
  private keychainStore: KeychainStore;
  private tokenManager: TokenManager;
  private jwtValidator: JWTValidator;

  constructor() {
    this.keychainStore = new KeychainStore();
    const dualAuthModeHandler = new DualAuthModeHandler();
    const configManager = new ConfigurationManager();
    this.tokenManager = new TokenManager(
      this.keychainStore,
      dualAuthModeHandler,
      configManager
    );
    this.jwtValidator = new JWTValidator();
  }

  /**
   * Authenticate a Kiro OAuth account
   * 
   * Retrieves OAuth tokens from keychain and validates them.
   * 
   * Security measures:
   * - Validates account type before processing
   * - Null checks on all credential fields
   * - JWT validation with issuer/audience checks
   * - Sanitized error messages (no token exposure)
   * - Audit logging without credentials
   * 
   * @param account - Account to authenticate
   * @returns Authentication result with session token or error
   */
  async authenticate(account: Account): Promise<AuthResult> {
    // Validate account type
    if (account.provider !== 'kiro-oauth') {
      logger.warn('Invalid account type for KiroOAuthAuthStrategy', {
        accountId: account.id,
        provider: account.provider,
      });
      return {
        success: false,
        error: 'Invalid account type',
      };
    }

    const kiroAccount = account as KiroOAuthAccount;

    // Validate account ID
    if (!kiroAccount.id || typeof kiroAccount.id !== 'string') {
      logger.warn('Invalid account ID', { accountId: kiroAccount.id });
      return {
        success: false,
        error: 'Invalid account configuration',
      };
    }

    try {
      // Retrieve credentials from keychain
      const credentials = await this.keychainStore.retrieve(kiroAccount.id);

      // Validate credentials exist
      if (!credentials) {
        logger.warn('No credentials found in keychain', {
          accountId: kiroAccount.id,
        });
        logSecurityEvent('auth_failed', kiroAccount.id, 'failure', {
          reason: 'credentials_not_found',
        });
        return {
          success: false,
          error: 'Authentication required. Please run: claudeflow login',
        };
      }

      // Validate accessToken exists
      if (!credentials.accessToken || typeof credentials.accessToken !== 'string') {
        logger.warn('Invalid access token in credentials', {
          accountId: kiroAccount.id,
        });
        logSecurityEvent('auth_failed', kiroAccount.id, 'failure', {
          reason: 'invalid_token',
        });
        return {
          success: false,
          error: 'Invalid credentials. Please run: claudeflow login',
        };
      }

      // Validate JWT token
      const expectedIssuer = `https://prod.${kiroAccount.region}.auth.desktop.kiro.dev`;
      const validation = await this.jwtValidator.validate(
        credentials.accessToken,
        expectedIssuer,
        KIRO_JWT_AUDIENCE
      );

      if (!validation.valid) {
        logger.warn('JWT validation failed', {
          accountId: kiroAccount.id,
          error: validation.error,
        });
        logSecurityEvent('auth_failed', kiroAccount.id, 'failure', {
          reason: 'jwt_validation_failed',
        });
        return {
          success: false,
          error: 'Token validation failed. Please run: claudeflow login',
        };
      }

      // Parse expiry time
      let expiresAt: Date;
      try {
        expiresAt = new Date(credentials.expiresAt);
        if (isNaN(expiresAt.getTime())) {
          throw new Error('Invalid date');
        }
      } catch {
        logger.warn('Invalid expiry time in credentials', {
          accountId: kiroAccount.id,
        });
        return {
          success: false,
          error: 'Invalid credentials. Please run: claudeflow login',
        };
      }

      // Check if token is expired
      if (expiresAt.getTime() <= Date.now()) {
        logger.info('Token expired, refresh needed', {
          accountId: kiroAccount.id,
        });
        return {
          success: false,
          error: 'Token expired. Refresh required.',
        };
      }

      // Success - return session token (contains OAuth accessToken)
      logger.info('Authentication successful', {
        accountId: kiroAccount.id,
      });
      logSecurityEvent('auth_success', kiroAccount.id, 'success', {});

      return {
        success: true,
        sessionToken: credentials.accessToken, // OAuth accessToken stored in sessionToken field
        expiresAt,
      };
    } catch (error) {
      // Sanitized error message (no token exposure)
      logger.error('Authentication error', {
        accountId: kiroAccount.id,
        error: error instanceof Error ? error.message : String(error),
      });
      logSecurityEvent('auth_failed', kiroAccount.id, 'failure', {
        reason: 'exception',
      });

      return {
        success: false,
        error: 'Authentication failed. Please try again or run: claudeflow login',
      };
    }
  }

  /**
   * Refresh an expired OAuth session
   * 
   * Delegates to TokenManager for token refresh.
   * Validates refresh result before returning.
   * 
   * Security measures:
   * - Validates account type
   * - Validates refresh result (success + new tokens)
   * - Sanitized error messages
   * - Audit logging
   * 
   * @param account - Account with expired session
   * @returns Refreshed authentication result or error
   */
  async refreshSession(account: Account): Promise<AuthResult> {
    // Validate account type
    if (account.provider !== 'kiro-oauth') {
      logger.warn('Invalid account type for refresh', {
        accountId: account.id,
        provider: account.provider,
      });
      return {
        success: false,
        error: 'Invalid account type',
      };
    }

    const kiroAccount = account as KiroOAuthAccount;

    // Validate account ID
    if (!kiroAccount.id || typeof kiroAccount.id !== 'string') {
      logger.warn('Invalid account ID for refresh', { accountId: kiroAccount.id });
      return {
        success: false,
        error: 'Invalid account configuration',
      };
    }

    try {
      logger.info('Refreshing OAuth session', {
        accountId: kiroAccount.id,
      });

      // Delegate to TokenManager
      const result = await this.tokenManager.refresh(kiroAccount.id);

      // Validate refresh result
      if (!result.success) {
        logger.warn('Token refresh failed', {
          accountId: kiroAccount.id,
        });
        logSecurityEvent('token_refresh_failed', kiroAccount.id, 'failure', {});
        return {
          success: false,
          error: 'Token refresh failed. Please run: claudeflow login',
        };
      }

      // Validate new tokens exist
      if (!result.accessToken || typeof result.accessToken !== 'string') {
        logger.error('Refresh succeeded but no access token returned', {
          accountId: kiroAccount.id,
        });
        logSecurityEvent('token_refresh_failed', kiroAccount.id, 'failure', {
          reason: 'missing_token',
        });
        return {
          success: false,
          error: 'Token refresh failed. Please run: claudeflow login',
        };
      }

      // Success
      logger.info('Token refresh successful', {
        accountId: kiroAccount.id,
      });
      logSecurityEvent('token_refresh_success', kiroAccount.id, 'success', {});

      return {
        success: true,
        sessionToken: result.accessToken, // OAuth accessToken stored in sessionToken field
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      // Sanitized error message
      logger.error('Token refresh error', {
        accountId: kiroAccount.id,
        error: error instanceof Error ? error.message : String(error),
      });
      logSecurityEvent('token_refresh_failed', kiroAccount.id, 'failure', {
        reason: 'exception',
      });

      return {
        success: false,
        error: 'Token refresh failed. Please try again or run: claudeflow login',
      };
    }
  }

  /**
   * Check if OAuth session needs refresh
   * 
   * Delegates to TokenManager which includes 5-minute buffer.
   * 
   * @param account - Account to check
   * @returns True if session needs refresh
   */
  async needsRefresh(account: Account): Promise<boolean> {
    // Validate account type
    if (account.provider !== 'kiro-oauth') {
      return false;
    }

    const kiroAccount = account as KiroOAuthAccount;

    // Validate account ID
    if (!kiroAccount.id || typeof kiroAccount.id !== 'string') {
      return false;
    }

    try {
      // Delegate to TokenManager (includes 5-minute buffer)
      return await this.tokenManager.needsRefresh(kiroAccount.id);
    } catch (error) {
      // On error, assume refresh needed
      logger.warn('Error checking refresh status', {
        accountId: kiroAccount.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }
}
