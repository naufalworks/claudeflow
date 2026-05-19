/**
 * TokenManager - Manages token lifecycle for Kiro OAuth accounts
 *
 * Responsibilities:
 * - Detect auth mode (kiro-desktop vs aws-sso)
 * - Refresh tokens using correct endpoint per mode
 * - Update KeychainStore on successful refresh (token rotation)
 * - Mark account as re-auth-required on 401/403 failures
 * - Retry failed refreshes with exponential backoff (max 3 attempts)
 * - Background refresh worker (checks every 60 seconds)
 * - Check if token needs refresh (within 5-minute buffer)
 *
 * Security measures:
 * - Per-account refresh locks (prevents concurrent refresh race conditions)
 * - TLS 1.2+ enforcement with strict certificate validation
 * - Minimal sensitive data in memory (only metadata, tokens retrieved on-demand)
 * - Comprehensive security event logging
 * - Exponential backoff with jitter (prevents timing attacks)
 *
 * Correctness properties:
 * - Property 6: needsRefresh returns true when token is expired or within refresh buffer
 * - Property 7: Refresh updates stored credentials exactly (token rotation)
 * - Property 8: Failed refresh (401/403) marks account 're-auth-required'
 * - Property 9: Exponential backoff: delay(n) >= 2^n * base_delay, max 3 retries
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createHash } from 'crypto';
import { KeychainStore } from './KeychainStore.js';
import { DualAuthModeHandler } from './DualAuthModeHandler.js';
import { ConfigurationManager } from '../config/manager.js';
import { logger } from '../cli/utils/logger.js';
import { AuthenticationError, TokenRefreshError } from '../errors/kiro-errors.js';
import { createTLSAgent } from '../utils/tls-config.js';
import type {
  AuthModeConfig,
  KeychainCredentials,
  TokenRefreshResult,
  AccountStatus,
} from '../types/kiro-oauth.types.js';

// ============================================================================
// Constants
// ============================================================================

/** Buffer time before token expiry to trigger refresh (5 minutes) */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Background worker interval (60 seconds) */
const WORKER_INTERVAL_MS = 60 * 1000;

/** Maximum retry attempts for failed refreshes */
const MAX_RETRY_ATTEMPTS = 3;

/** Base delay for exponential backoff (1 second) */
const BASE_RETRY_DELAY_MS = 1000;

/** Maximum delay for exponential backoff (30 seconds) */
const MAX_RETRY_DELAY_MS = 30000;

/** HTTP timeout for token refresh requests (10 seconds) */
const HTTP_TIMEOUT_MS = 10000;

// ============================================================================
// Internal State Interface
// ============================================================================

/**
 * In-memory state for an account (minimal sensitive data)
 */
interface AccountState {
  /** Current health status */
  status: AccountStatus;
  /** Last refresh attempt timestamp */
  lastRefreshAttempt: Date | null;
  /** Last successful refresh timestamp */
  lastRefreshSuccess: Date | null;
  /** Consecutive error count */
  consecutiveErrors: number;
  /** Mutex lock to prevent concurrent refreshes */
  isRefreshing: boolean;
  /** Current retry count for exponential backoff */
  retryCount: number;
}

// ============================================================================
// TokenManager Class
// ============================================================================

/**
 * Manages token lifecycle for Kiro OAuth accounts
 */
export class TokenManager {
  private readonly keychainStore: KeychainStore;
  private readonly dualAuthModeHandler: DualAuthModeHandler;
  private readonly configManager: ConfigurationManager;
  private readonly httpClient: AxiosInstance;
  private readonly accountStates: Map<string, AccountState>;
  private workerIntervalId: NodeJS.Timeout | null = null;

  /**
   * Create a new TokenManager
   *
   * @param keychainStore - Secure credential storage
   * @param dualAuthModeHandler - Auth mode detection and endpoint selection
   * @param configManager - Configuration manager for account lookup
   */
  constructor(
    keychainStore: KeychainStore,
    dualAuthModeHandler: DualAuthModeHandler,
    configManager: ConfigurationManager
  ) {
    this.keychainStore = keychainStore;
    this.dualAuthModeHandler = dualAuthModeHandler;
    this.configManager = configManager;
    this.accountStates = new Map();
    this.httpClient = this.createHttpClient();
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Detect authentication mode for an account
   *
   * @param accountId - Account identifier
   * @returns Authentication mode configuration
   */
  async detectAuthMode(accountId: string): Promise<AuthModeConfig> {
    const credentials = await this.keychainStore.retrieve(accountId);

    if (!credentials) {
      throw new AuthenticationError(accountId, 'No credentials found in keychain');
    }

    return this.dualAuthModeHandler.detectMode(credentials);
  }

  /**
   * Refresh an account's access token
   *
   * Implements token rotation (Property 7) and exponential backoff (Property 9).
   *
   * @param accountId - Account identifier
   * @returns Token refresh result with new tokens
   * @throws AuthenticationError on 401/403 (Property 8)
   * @throws TokenRefreshError on transient failures after max retries
   */
  async refresh(accountId: string): Promise<TokenRefreshResult> {
    // Get or create account state
    const state = this.getOrCreateState(accountId);

    // Thread safety: check if refresh is already in progress
    if (state.isRefreshing) {
      throw new Error(`Refresh already in progress for account: ${accountId}`);
    }

    // Acquire refresh lock
    state.isRefreshing = true;
    state.lastRefreshAttempt = new Date();

    try {
      // Retrieve current credentials from KeychainStore
      const credentials = await this.keychainStore.retrieve(accountId);

      if (!credentials) {
        throw new AuthenticationError(accountId, 'No credentials found in keychain');
      }

      if (!credentials.refreshToken) {
        throw new AuthenticationError(accountId, 'No refresh token found in keychain');
      }

      // Detect auth mode
      const modeConfig = this.dualAuthModeHandler.detectMode(credentials);

      // Get account region from config
      const region = await this.getAccountRegion(accountId);

      // Get token endpoint
      const tokenEndpoint = this.dualAuthModeHandler.getTokenEndpoint(modeConfig.mode, region);

      // Build refresh request body
      const requestBody = this.dualAuthModeHandler.buildRefreshRequest(
        credentials.refreshToken,
        modeConfig,
        credentials
      );

      logger.info('Starting token refresh', {
        accountId,
        mode: modeConfig.mode,
        endpoint: tokenEndpoint,
      });

      // Make HTTP POST request
      const response = await this.makeRefreshRequest(tokenEndpoint, requestBody);

      // Parse token response
      const newCredentials = this.parseTokenResponse(response, credentials);

      // Update KeychainStore (token rotation - Property 7)
      await this.keychainStore.store(accountId, newCredentials);

      // Update state
      state.status = 'healthy';
      state.lastRefreshSuccess = new Date();
      state.consecutiveErrors = 0;
      state.retryCount = 0;

      logger.info('Token refresh successful', { accountId });

      return {
        success: true,
        accessToken: newCredentials.accessToken,
        refreshToken: newCredentials.refreshToken,
        expiresAt: new Date(newCredentials.expiresAt),
        refreshedAt: new Date(),
      };
    } catch (error: any) {
      // Handle errors
      state.consecutiveErrors++;

      // Property 8: Mark as re-auth-required on 401/403
      if (this.isAuthError(error)) {
        state.status = 're-auth-required';
        logger.warn('Authentication failed, re-auth required', {
          accountId,
          statusCode: error.response?.status,
        });
        throw new AuthenticationError(accountId, 'Token refresh failed with 401/403');
      }

      // Retry with exponential backoff for transient errors (Property 9)
      if (this.isRetryableError(error) && state.retryCount < MAX_RETRY_ATTEMPTS - 1) {
        const delay = this.calculateBackoffDelay(state.retryCount);
        logger.warn('Retryable error, will retry after delay', {
          accountId,
          retryCount: state.retryCount,
          delayMs: delay,
        });

        state.retryCount++;

        // Wait with exponential backoff
        await this.sleep(delay);

        // Recursive retry (will release lock in finally block when done)
        state.isRefreshing = false;
        return this.refresh(accountId);
      }

      // Mark as unhealthy after max retries
      state.status = 'unhealthy';
      logger.error('Token refresh failed after max retries', { accountId, error: error.message });
      throw new TokenRefreshError(accountId, error.message);
    } finally {
      // Release refresh lock
      state.isRefreshing = false;
    }
  }

  /**
   * Refresh multiple accounts in parallel
   *
   * @param accountIds - Array of account identifiers
   * @returns Map of accountId to refresh result
   */
  async refreshAll(accountIds: string[]): Promise<Map<string, TokenRefreshResult>> {
    logger.info('Starting parallel refresh', { count: accountIds.length });

    // Use Promise.allSettled for parallel execution
    const results = await Promise.allSettled(accountIds.map((id) => this.refresh(id)));

    // Build result map
    const resultMap = new Map<string, TokenRefreshResult>();

    for (let i = 0; i < accountIds.length; i++) {
      const accountId = accountIds[i];
      const result = results[i];

      if (result.status === 'fulfilled') {
        resultMap.set(accountId, result.value);
      } else {
        // Log error but don't throw - partial success is OK
        logger.error('Refresh failed for account', {
          accountId,
          error: result.reason?.message || String(result.reason),
        });

        // Add failed result
        resultMap.set(accountId, {
          success: false,
          accessToken: '',
          refreshToken: '',
          expiresAt: new Date(0),
          refreshedAt: new Date(),
          // We need to extend TokenRefreshResult to include error field
          // For now, we'll just mark success as false
        } as any);
      }
    }

    logger.info('Parallel refresh completed', {
      total: accountIds.length,
      successful: Array.from(resultMap.values()).filter((r) => r.success).length,
    });

    return resultMap;
  }

  /**
   * Check if an account's token needs refresh
   *
   * Property 6: returns true when token is expired or within refresh buffer
   *
   * @param accountId - Account identifier
   * @returns true if token expires within 5 minutes
   */
  async needsRefresh(accountId: string): Promise<boolean> {
    try {
      // Retrieve credentials from KeychainStore
      const credentials = await this.keychainStore.retrieve(accountId);

      if (!credentials) {
        logger.warn('No stored credentials found for account; refresh skipped', { accountId });
        return false;
      }

      // Parse expiry time
      const expiresAt = new Date(credentials.expiresAt);
      const now = new Date();

      // Calculate time until expiry
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();

      // Refresh expired tokens too; a valid refresh token can still recover them.
      const needsRefresh = timeUntilExpiry < REFRESH_BUFFER_MS;

      if (needsRefresh) {
        logger.debug('Token needs refresh', {
          accountId,
          expiresAt: expiresAt.toISOString(),
          minutesUntilExpiry: Math.floor(timeUntilExpiry / 60000),
        });
      }

      return needsRefresh;
    } catch (error: any) {
      logger.error('Failed to check if token needs refresh', { accountId, error: error.message });
      return false;
    }
  }

  /**
   * Start background refresh worker
   *
   * Runs every 60 seconds and refreshes tokens expiring within 5 minutes.
   */
  startRefreshWorker(): void {
    if (this.workerIntervalId) {
      logger.warn('Refresh worker already running');
      return;
    }

    logger.info('Starting background refresh worker');

    this.workerIntervalId = setInterval(async () => {
      try {
        // Get all Kiro OAuth account IDs
        const accountIds = await this.getAllAccountIds();

        if (accountIds.length === 0) {
          return; // No accounts to refresh
        }

        // Check which accounts need refresh
        const accountsToRefresh: string[] = [];

        for (const accountId of accountIds) {
          if (await this.needsRefresh(accountId)) {
            accountsToRefresh.push(accountId);
          }
        }

        if (accountsToRefresh.length > 0) {
          logger.info('Background refresh starting', { count: accountsToRefresh.length });
          await this.refreshAll(accountsToRefresh);
        }
      } catch (error: any) {
        logger.error('Background refresh worker error', { error: error.message });
      }
    }, WORKER_INTERVAL_MS);
    this.workerIntervalId.unref?.();

    logger.info('Background refresh worker started', { intervalMs: WORKER_INTERVAL_MS });
  }

  /**
   * Stop background refresh worker
   */
  stopRefreshWorker(): void {
    if (this.workerIntervalId) {
      clearInterval(this.workerIntervalId);
      this.workerIntervalId = null;
      logger.info('Background refresh worker stopped');
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get or create account state
   */
  private getOrCreateState(accountId: string): AccountState {
    if (!this.accountStates.has(accountId)) {
      this.accountStates.set(accountId, this.createDefaultState());
    }
    return this.accountStates.get(accountId)!;
  }

  /**
   * Create default account state
   */
  private createDefaultState(): AccountState {
    return {
      status: 'unknown',
      lastRefreshAttempt: null,
      lastRefreshSuccess: null,
      consecutiveErrors: 0,
      isRefreshing: false,
      retryCount: 0,
    };
  }

  /**
   * Calculate exponential backoff delay with jitter
   *
   * Property 9: delay(n) >= 2^n * base_delay
   */
  private calculateBackoffDelay(retryCount: number): number {
    // Exponential delay
    const exponentialDelay = Math.pow(2, retryCount) * BASE_RETRY_DELAY_MS;

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);

    // Add jitter (0-500ms) to prevent thundering herd
    const jitter = Math.random() * 500;

    return cappedDelay + jitter;
  }

  /**
   * Create HTTP client with TLS validation
   */
  private createHttpClient(): AxiosInstance {
    return axios.create({
      timeout: HTTP_TIMEOUT_MS,
      httpsAgent: createTLSAgent(),
    });
  }

  /**
   * Make refresh request to token endpoint
   */
  private async makeRefreshRequest(
    endpoint: string,
    requestBody: Record<string, string>
  ): Promise<any> {
    const endpointUrl = new URL(endpoint);
    const isAwsOidcEndpoint =
      endpointUrl.hostname.startsWith('oidc.') &&
      endpointUrl.hostname.endsWith('.amazonaws.com') &&
      endpointUrl.pathname === '/token';
    const isKiroDesktopRefreshEndpoint =
      endpointUrl.hostname.endsWith('.auth.desktop.kiro.dev') &&
      endpointUrl.pathname === '/refreshToken';

    if (isAwsOidcEndpoint) {
      const response = await this.httpClient.post(
        endpoint,
        {
          clientId: requestBody.client_id,
          clientSecret: requestBody.client_secret,
          refreshToken: requestBody.refresh_token,
          grantType: 'refresh_token',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }
      );

      return response.data;
    }

    if (isKiroDesktopRefreshEndpoint) {
      const response = await this.httpClient.post(
        endpoint,
        {
          refreshToken: requestBody.refresh_token,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'kiro-cli/1.0.0',
          },
        }
      );

      return response.data;
    }

    const response = await this.httpClient.post(endpoint, new URLSearchParams(requestBody), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });

    return response.data;
  }

  /**
   * Parse token response and merge with existing credentials
   *
   * Preserves clientId/clientSecret from existing credentials (for AWS SSO mode).
   */
  private parseTokenResponse(
    data: any,
    existingCredentials: KeychainCredentials
  ): KeychainCredentials {
    const accessToken = data.access_token || data.accessToken;
    const refreshToken =
      data.refresh_token || data.refreshToken || existingCredentials.refreshToken;

    // Validate response structure. AWS OIDC returns camelCase; Kiro desktop/social
    // may return snake_case.
    if (!accessToken || !refreshToken) {
      throw new Error('Invalid token response: missing required fields');
    }

    // Calculate expiry time
    const expiresIn = data.expires_in || data.expiresIn || 3600; // Default 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    return {
      accessToken,
      refreshToken,
      expiresAt,
      scopes: existingCredentials.scopes,
      // Preserve client credentials from existing credentials (for AWS SSO mode)
      clientId: existingCredentials.clientId,
      clientSecret: existingCredentials.clientSecret,
    };
  }

  /**
   * Check if error is an authentication error (401/403)
   */
  private isAuthError(error: any): boolean {
    if (error instanceof AxiosError) {
      return error.response?.status === 401 || error.response?.status === 403;
    }
    return false;
  }

  /**
   * Check if error is retryable (network, 5xx)
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof AxiosError) {
      // Network error
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND'
      ) {
        return true;
      }

      // 5xx server errors
      const status = error.response?.status;
      return status ? status >= 500 && status < 600 : false;
    }

    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get account region from config
   */
  private async getAccountRegion(accountId: string): Promise<string> {
    const config = this.configManager.getConfig();
    const account = config.accounts.find(
      (a: any) =>
        a.id === accountId ||
        (a.provider === 'kiro-oauth' &&
          a.profileArn &&
          `kiro-${createHash('sha256').update(a.profileArn).digest('hex').substring(0, 16)}` ===
            accountId)
    );

    if (!account) {
      throw new Error(`Account ${accountId} not found in config`);
    }

    // Check if this is a KiroOAuthAccount
    if (account.provider !== 'kiro-oauth') {
      throw new Error(
        `Account ${accountId} is not a Kiro OAuth account (provider: ${account.provider})`
      );
    }

    // Extract region (KiroOAuthAccount has region field)
    const region = (account as any).region;
    if (!region) {
      throw new Error(`Account ${accountId} has no region configured`);
    }

    return region;
  }

  /**
   * Get all Kiro OAuth account IDs from config
   */
  private async getAllAccountIds(): Promise<string[]> {
    const config = this.configManager.getConfig();
    return config.accounts.filter((a) => a.provider === 'kiro-oauth').map((a) => a.id);
  }
}
