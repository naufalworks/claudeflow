/**
 * AccountPoolManager
 *
 * Manages a pool of Anthropic API accounts with intelligent selection
 * based on quota availability, performance, and cost efficiency.
 *
 * Supports four account types:
 * - Direct Anthropic (provider: 'anthropic')
 * - Anthropic-compatible proxies (provider: 'proxy')
 * - OAuth routers (provider: 'kiro') - LEGACY 9router-based
 * - Kiro OAuth (provider: 'kiro-oauth') - NEW direct OAuth implementation
 *
 * CRITICAL: All account types MUST return raw Anthropic format.
 */

import type { RedisClientWrapper } from '../infrastructure/redis';
import type { Account, KiroOAuthAccount } from '../config/schema';
import type { AnthropicRequest, AnthropicResponse } from '../types/anthropic.types';
import { AuthManager } from '../auth/AuthManager.js';
import { AnthropicClient } from '../clients/AnthropicClient.js';
import { ProxyClient } from '../clients/ProxyClient.js';
import { OAuthClient } from '../clients/OAuthClient.js';
import { KiroAPIClient } from '../clients/KiroAPIClient.js';
import { ResponseFormatValidator } from '../clients/ResponseFormatValidator.js';
import { KeychainStore } from '../auth/KeychainStore.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { RateLimiter } from './rate-limiter.js';
import { HealthMonitor, type TokenProvider } from './health-monitor.js';
import { QuotaTracker } from './quota-tracker.js';
import { LogSanitizer } from '../utils/log-sanitizer.js';
import { QuotaManagementManager } from '../tracking/QuotaManagementManager.js';
import { createHash } from 'crypto';
import {
  NoHealthyAccountsError,
  AuthenticationError,
  QuotaExhaustedError,
} from '../errors/kiro-errors.js';
import { needsTokenRefresh, TokenRefreshDeduplicator } from './tokenRefresh.js';

/**
 * Pool account - wraps config Account with runtime fields
 */
export type PoolAccount = Account & {
  quota: AccountQuota;
  performance: AccountPerformance;
  costEfficiency: number; // 0-1, where 1 is most efficient (free)
};

/**
 * Account quota information
 */
export interface AccountQuota {
  requestsPerMinute: number;
  requestsPerMinuteUsed: number;
  tokensPerDay: number;
  tokensPerDayUsed: number;
  resetTime: number; // Unix timestamp
}

/**
 * Account performance metrics
 */
export interface AccountPerformance {
  averageLatency: number; // milliseconds
  successRate: number; // 0-1
  lastUsed: number; // Unix timestamp
}

/**
 * Account selection result
 */
export interface AccountSelectionResult {
  account: PoolAccount;
  score: number;
  reason: string;
}

/**
 * AccountPoolManager class
 */
export class AccountPoolManager {
  private accounts: Map<string, PoolAccount>;
  private redisClient: RedisClientWrapper;
  private config: any;
  private authManager: AuthManager;
  private anthropicClient: AnthropicClient;
  private proxyClient: ProxyClient;
  private oauthClient: OAuthClient;
  private kiroApiClient: KiroAPIClient;
  private responseValidator: ResponseFormatValidator;
  private keychainStore: KeychainStore;

  // Component instances for kiro-oauth accounts
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private healthMonitors: Map<string, HealthMonitor> = new Map();
  private quotaTrackers: Map<string, QuotaTracker> = new Map();

  // Optional QuotaManagementManager for quota-aware ranking
  private quotaManagementManager?: QuotaManagementManager;

  // Token refresh mutex to prevent concurrent refresh race conditions
  private tokenRefreshLocks: Map<string, Promise<void>> = new Map();
  private tokenRefreshDeduplicator = new TokenRefreshDeduplicator();

  // Error recovery constants
  private static readonly MAX_AUTH_RETRIES = 1; // Max refresh+retry for 401 errors
  private static readonly MAX_RATE_LIMIT_RETRIES = 3; // Max retries for 429 errors
  private static readonly MAX_RETRY_AFTER_MS = 60000; // Cap retry-after at 60s (DoS prevention)
  private static readonly BASE_BACKOFF_MS = 1000; // Base exponential backoff delay

  constructor(redisClient: RedisClientWrapper, config: any, keychainStore: KeychainStore) {
    this.accounts = new Map();
    this.redisClient = redisClient;
    this.config = config;
    this.keychainStore = keychainStore;

    // Initialize clients
    this.authManager = new AuthManager();
    this.anthropicClient = new AnthropicClient();
    this.proxyClient = new ProxyClient();
    this.oauthClient = new OAuthClient();
    this.kiroApiClient = new KiroAPIClient();
    this.responseValidator = new ResponseFormatValidator();

    // Initialize accounts from configuration
    this.initializeAccounts();
  }

  /**
   * Initialize accounts from configuration
   */
  private initializeAccounts(): void {
    // Load all accounts from unified accounts array
    if (this.config.accounts) {
      for (const accountConfig of this.config.accounts) {
        // Handle kiro-oauth accounts (new direct OAuth implementation)
        if (accountConfig.provider === 'kiro-oauth') {
          const kiroAccount = accountConfig as KiroOAuthAccount;

          // Generate deterministic account ID from profileArn
          const accountId = this.generateAccountId(kiroAccount.profileArn);

          // Create pool account with runtime fields
          const poolAccount: PoolAccount = {
            ...kiroAccount,
            id: accountId,
            quota: {
              requestsPerMinute: 1000,
              requestsPerMinuteUsed: 0,
              tokensPerDay: 1000000,
              tokensPerDayUsed: 0,
              resetTime: Date.now() + 24 * 60 * 60 * 1000,
            },
            performance: {
              averageLatency: 0,
              successRate: 1.0,
              lastUsed: 0,
            },
            costEfficiency: 1.0, // Free tier
          };

          // Initialize components for this account
          this.circuitBreakers.set(accountId, new CircuitBreaker(accountId));
          this.rateLimiters.set(accountId, new RateLimiter(accountId));
          this.quotaTrackers.set(accountId, new QuotaTracker(accountId));

          // Initialize health monitor with token provider
          const healthMonitor = new HealthMonitor(
            accountId,
            this.kiroApiClient,
            this.createTokenProvider()
          );
          this.healthMonitors.set(accountId, healthMonitor);

          this.addAccount(poolAccount);
          continue;
        }

        // Create pool account with runtime fields based on provider type
        const poolAccount: PoolAccount = {
          ...accountConfig,
          quota: {
            requestsPerMinute: accountConfig.provider === 'kiro' ? 1000 : 50,
            requestsPerMinuteUsed: 0,
            tokensPerDay: accountConfig.provider === 'kiro' ? 1000000 : 100000,
            tokensPerDayUsed: 0,
            resetTime: Date.now() + 24 * 60 * 60 * 1000,
          },
          performance: {
            averageLatency: 0,
            successRate: 1.0,
            lastUsed: 0,
          },
          costEfficiency: accountConfig.provider === 'kiro' ? 1.0 : 0.7,
        };

        this.addAccount(poolAccount);
      }
    }
  }

  /**
   * Generate deterministic account ID from profile ARN
   *
   * @param profileArn - AWS CodeWhisperer profile ARN
   * @returns Account ID in format: kiro-{hash}
   * @throws {Error} If profileArn is invalid
   */
  private generateAccountId(profileArn: string): string {
    // Validate profileArn format
    const arnPattern = /^arn:aws:codewhisperer:[a-z0-9-]+:[0-9]+:profile\/[a-zA-Z0-9-]+$/;
    if (!arnPattern.test(profileArn)) {
      throw new Error(`Invalid profileArn format: ${profileArn}`);
    }

    // Hash the profileArn using SHA-256
    const hash = createHash('sha256').update(profileArn).digest('hex');

    // Take first 16 hex characters
    const shortHash = hash.substring(0, 16);

    // Return in format: kiro-{hash}
    return `kiro-${shortHash}`;
  }

  /**
   * Create token provider callback for health monitors
   *
   * @returns TokenProvider function that retrieves access tokens from keychain
   */
  private createTokenProvider(): TokenProvider {
    return async (accountId: string): Promise<string> => {
      const credentials = await this.keychainStore.retrieve(accountId);

      if (!credentials || !credentials.accessToken) {
        throw new AuthenticationError(accountId, 'No credentials found in keychain');
      }

      return credentials.accessToken;
    };
  }

  /**
   * Add account to the pool
   *
   * @param account - Account to add
   */
  addAccount(account: PoolAccount): void {
    this.accounts.set(account.id, account);
  }

  /**
   * Set QuotaManagementManager for quota-aware account ranking
   *
   * When set, selectAccount() will use QuotaManagementManager rankings
   * to enhance account selection with quota-aware scoring.
   *
   * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
   *
   * @param manager - QuotaManagementManager instance
   */
  setQuotaManagementManager(manager: QuotaManagementManager): void {
    this.quotaManagementManager = manager;
    console.log('[AccountPool] QuotaManagementManager integrated for quota-aware selection');
  }

  /**
   * Select best available account for request
   *
   * Multi-stage filtering process:
   * 1. Filter out accounts with open circuit breakers
   * 2. Filter out unhealthy accounts
   * 3. Filter out accounts near rate limit
   * 4. Filter out accounts near quota limit
   * 5. Score remaining accounts
   * 6. Return highest scoring account
   *
   * @returns Account selection result
   */
  async selectAccount(): Promise<AccountSelectionResult> {
    if (this.accounts.size === 0) {
      throw new Error('No accounts available in pool');
    }

    // Load quota information from Redis for all accounts
    await this.loadQuotaFromRedis();

    // Stage 1: Filter by circuit breaker state
    let availableAccounts = Array.from(this.accounts.values()).filter((account) => {
      // For kiro-oauth accounts, check circuit breaker
      if (account.provider === 'kiro-oauth') {
        const circuitBreaker = this.circuitBreakers.get(account.id);
        if (circuitBreaker && !circuitBreaker.canExecute()) {
          return false; // Circuit is open, skip this account
        }
      }
      return true;
    });

    // Stage 2: Filter by health status
    availableAccounts = availableAccounts.filter((account) => {
      // For kiro-oauth accounts, check health monitor
      if (account.provider === 'kiro-oauth') {
        const healthMonitor = this.healthMonitors.get(account.id);
        if (healthMonitor && !healthMonitor.isHealthy()) {
          return false; // Account is unhealthy, skip
        }
      }
      return true;
    });

    // Stage 3: Filter by rate limit status
    availableAccounts = availableAccounts.filter((account) => {
      // For kiro-oauth accounts, check rate limiter
      if (account.provider === 'kiro-oauth') {
        const rateLimiter = this.rateLimiters.get(account.id);
        if (rateLimiter && rateLimiter.isNearLimit()) {
          return false; // Near rate limit, skip for preemptive switching
        }
      }
      return true;
    });

    // Stage 4: Filter by quota status
    availableAccounts = availableAccounts.filter((account) => {
      // For kiro-oauth accounts, check quota tracker
      if (account.provider === 'kiro-oauth') {
        const quotaTracker = this.quotaTrackers.get(account.id);
        if (quotaTracker && quotaTracker.isNearLimit()) {
          return false; // Near quota limit, skip for preemptive switching
        }
      }
      return true;
    });

    // Stage 5: Score all remaining accounts
    const scoredAccounts = availableAccounts
      .map((account) => ({
        account,
        score: this.calculateAccountScore(account),
        reason: this.getSelectionReason(account),
      }))
      .filter((result) => result.score > 0); // Filter out accounts with no quota

    if (scoredAccounts.length === 0) {
      throw new NoHealthyAccountsError();
    }

    // Sort by score (highest first)
    scoredAccounts.sort((a, b) => b.score - a.score);

    // Stage 6: Enhance scoring with QuotaManagementManager rankings (if available)
    // Requirements: 12.1, 12.2, 12.3
    if (this.quotaManagementManager && scoredAccounts.length > 0) {
      try {
        const rankedAccounts = await this.quotaManagementManager.getAvailableAccounts();

        // Create a map for quick lookup by account ID
        const rankMap = new Map(rankedAccounts.map((r) => [r.accountId, r]));

        // Adjust scores based on quota manager rankings
        for (const scored of scoredAccounts) {
          const ranked = rankMap.get(scored.account.id);
          if (ranked) {
            // Blend existing score with quota manager score (50/50 weight)
            scored.score = scored.score * 0.5 + ranked.score * 0.5;
            scored.reason = ranked.reason;
          }
        }

        // Re-sort after score adjustment
        scoredAccounts.sort((a, b) => b.score - a.score);
      } catch (error) {
        // Graceful degradation: use existing scores if quota manager fails
        // Requirement 17.2: Log error and continue with fallback behavior
        console.error('[AccountPool] Failed to get quota rankings, using default scores:', error);
      }
    }

    const selectedResult = scoredAccounts[0];

    // Log selection decision with account, score, and reason
    // Requirement: 12.4
    console.log(
      `[AccountPool] Selected account ${selectedResult.account.id} ` +
        `(score: ${selectedResult.score.toFixed(3)}, reason: ${selectedResult.reason})`
    );

    const selectedAccount = selectedResult.account;

    // For kiro-oauth accounts, check if token needs refresh before use
    if (selectedAccount.provider === 'kiro-oauth') {
      const credentials = await this.keychainStore.retrieve(selectedAccount.id);
      if (credentials?.expiresAt) {
        if (needsTokenRefresh(credentials.expiresAt, 'kiro-oauth')) {
          console.log(`[AccountPool] Token expiring soon, refreshing ${selectedAccount.id}`);
          try {
            await this.refreshTokenWithLock(selectedAccount.id, selectedAccount);
            // Refresh may have updated credentials, re-fetch
            const refreshed = await this.keychainStore.retrieve(selectedAccount.id);
            if (refreshed) {
              credentials.accessToken = refreshed.accessToken;
              credentials.expiresAt = refreshed.expiresAt;
            }
          } catch (error) {
            // If refresh fails, try next account
            if (scoredAccounts.length > 1) {
              return scoredAccounts[1];
            }
            throw new Error(`Failed to refresh token for ${selectedAccount.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    // For legacy OAuth accounts, check if session needs refresh
    if (selectedAccount.provider === 'kiro') {
      const needsRefresh = await this.authManager.needsRefresh(selectedAccount);
      if (needsRefresh) {
        try {
          await this.authManager.refreshSession(selectedAccount);
        } catch (error) {
          // If refresh fails, try next account
          if (scoredAccounts.length > 1) {
            return scoredAccounts[1];
          }
          throw new Error('Failed to refresh OAuth session and no alternative accounts available');
        }
      }
    }

    return selectedResult;
  }

  /**
   * Route request to appropriate client based on account provider
   *
   * @param account - Account to use
   * @param request - Anthropic API request
   * @returns Anthropic API response
   */
  async routeRequest(account: PoolAccount, request: AnthropicRequest): Promise<AnthropicResponse> {
    try {
      let response: AnthropicResponse;

      // Route to appropriate client based on provider
      switch (account.provider) {
        case 'anthropic':
          response = await this.anthropicClient.sendRequest(request, account.apiKey);
          break;

        case 'proxy':
          response = await this.proxyClient.sendRequest(request, account.apiKey, account.baseURL);
          break;

        case 'kiro':
          if (!account.kiroConfig.sessionToken) {
            throw new Error('OAuth account missing sessionToken');
          }
          response = await this.oauthClient.sendRequest(
            request,
            account.kiroConfig.sessionToken,
            account.kiroConfig.mitmRouterUrl
          );
          break;

        case 'kiro-oauth': {
          const kiroAccount = account as KiroOAuthAccount;
          let authRetries = 0;
          let rateLimitRetries = 0;

          while (true) {
            try {
              // Proactively refresh token if expiring soon (before each request)
              const credentials = await this.getRefreshedCredentials(account.id, account);
              if (!credentials || !credentials.accessToken) {
                throw new AuthenticationError(account.id, 'No credentials found in keychain');
              }

              // Send request via KiroAPIClient
              response = await this.kiroApiClient.sendRequest(request, credentials.accessToken, {
                region: kiroAccount.region,
                timeout: {
                  connect: 10,
                  read: 60,
                },
                retries: 3,
              });

              // Success - update metrics and return
              const quotaTracker = this.quotaTrackers.get(account.id);
              if (quotaTracker) {
                quotaTracker.trackRequest('minute');
                quotaTracker.trackRequest('hour');
                quotaTracker.trackRequest('day');
              }

              const circuitBreaker = this.circuitBreakers.get(account.id);
              if (circuitBreaker) {
                circuitBreaker.recordSuccess();
              }

              break; // Exit retry loop on success
            } catch (error: any) {
              const statusCode = error.statusCode || error.status;

              // Handle 401 - refresh token and retry once
              if (statusCode === 401 && authRetries < AccountPoolManager.MAX_AUTH_RETRIES) {
                try {
                  await this.refreshTokenWithLock(account.id, account);
                  authRetries++;
                  continue; // Retry with new token
                } catch (refreshError: any) {
                  // Refresh failed - sanitize error and re-throw
                  const sanitized = LogSanitizer.sanitize(refreshError.message);
                  throw new AuthenticationError(account.id, `Token refresh failed: ${sanitized}`);
                }
              }

              // Handle 429 - exponential backoff with retry-after header validation
              if (
                statusCode === 429 &&
                rateLimitRetries < AccountPoolManager.MAX_RATE_LIMIT_RETRIES
              ) {
                // Validate and cap retry-after to prevent DoS (Property 9)
                const retryAfter = Math.min(
                  error.retryAfter ||
                    Math.pow(2, rateLimitRetries) * AccountPoolManager.BASE_BACKOFF_MS,
                  AccountPoolManager.MAX_RETRY_AFTER_MS
                );

                await this.sleep(retryAfter);
                rateLimitRetries++;
                continue; // Retry after backoff
              }

              // Handle 402 - quota exhausted, trigger failover
              if (statusCode === 402) {
                throw new QuotaExhaustedError(account.id);
              }

              // All other errors or max retries reached
              // Record failure in circuit breaker
              const circuitBreaker = this.circuitBreakers.get(account.id);
              if (circuitBreaker) {
                circuitBreaker.recordFailure();
              }

              // Sanitize error message to prevent token leakage (Property 18)
              const sanitized = LogSanitizer.sanitize(error.message || 'Unknown error');
              throw new Error(`Request failed for kiro-oauth account ${account.id}: ${sanitized}`);
            }
          }

          break;
        }

        default:
          throw new Error(`Unsupported account provider: ${(account as any).provider}`);
      }

      // Response is already validated by the client, but double-check
      if (!this.responseValidator.isAnthropicFormat(response)) {
        throw new Error(`Invalid response format from ${account.provider} account`);
      }

      return response;
    } catch (error) {
      // Record failure for kiro-oauth accounts (only if not already recorded in retry loop)
      // Note: kiro-oauth accounts handle their own circuit breaker updates in the retry loop
      // This catch block only handles errors from other providers (anthropic, proxy, kiro)
      if (account.provider !== 'kiro-oauth') {
        // For non-kiro-oauth accounts, we don't have circuit breakers, so no action needed
      }

      // Sanitize error message to prevent token leakage (Property 18)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const sanitizedMessage = LogSanitizer.sanitize(errorMessage);

      // Re-throw with context
      throw new Error(
        `Request failed for ${account.provider} account ${account.id}: ${sanitizedMessage}`
      );
    }
  }

  /**
   * Calculate account score based on multiple factors
   *
   * @param account - Account to score
   * @returns Score (0-1, higher is better)
   */
  private calculateAccountScore(account: PoolAccount): number {
    // Factor 1: Quota availability (40% weight)
    const quotaScore = this.calculateQuotaScore(account.quota);

    // Factor 2: Performance (30% weight)
    const performanceScore = this.calculatePerformanceScore(account.performance);

    // Factor 3: Cost efficiency (30% weight)
    const costScore = account.costEfficiency;

    // Weighted average
    const score = quotaScore * 0.4 + performanceScore * 0.3 + costScore * 0.3;

    return score;
  }

  /**
   * Calculate quota availability score
   *
   * @param quota - Account quota
   * @returns Score (0-1)
   */
  private calculateQuotaScore(quota: AccountQuota): number {
    // Calculate usage percentages
    const rpmUsage = quota.requestsPerMinuteUsed / quota.requestsPerMinute;
    const tokensUsage = quota.tokensPerDayUsed / quota.tokensPerDay;

    // If either quota is >90% used, heavily penalize
    if (rpmUsage > 0.9 || tokensUsage > 0.9) {
      return 0.1; // Very low score
    }

    // If either quota is >80% used, penalize
    if (rpmUsage > 0.8 || tokensUsage > 0.8) {
      return 0.5; // Medium score
    }

    // Calculate average remaining quota
    const rpmRemaining = 1 - rpmUsage;
    const tokensRemaining = 1 - tokensUsage;
    const avgRemaining = (rpmRemaining + tokensRemaining) / 2;

    return avgRemaining;
  }

  /**
   * Calculate performance score
   *
   * @param performance - Account performance metrics
   * @returns Score (0-1)
   */
  private calculatePerformanceScore(performance: AccountPerformance): number {
    // Factor 1: Success rate (70% weight)
    const successScore = performance.successRate;

    // Factor 2: Latency (30% weight)
    // Lower latency is better, normalize to 0-1 scale
    // Assume 100ms is excellent, 1000ms is poor
    const latencyScore = Math.max(0, 1 - performance.averageLatency / 1000);

    return successScore * 0.7 + latencyScore * 0.3;
  }

  /**
   * Get human-readable selection reason
   *
   * @param account - Selected account
   * @returns Reason string
   */
  private getSelectionReason(account: PoolAccount): string {
    if (account.provider === 'kiro') {
      return 'Kiro account (free, high priority)';
    }

    const quotaScore = this.calculateQuotaScore(account.quota);
    const performanceScore = this.calculatePerformanceScore(account.performance);

    if (quotaScore > 0.8 && performanceScore > 0.8) {
      return 'High quota availability and excellent performance';
    } else if (quotaScore > 0.8) {
      return 'High quota availability';
    } else if (performanceScore > 0.8) {
      return 'Excellent performance';
    } else {
      return 'Best available option';
    }
  }

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Refresh token with mutex lock to prevent concurrent refresh race conditions
   *
   * This method ensures that only one refresh operation occurs at a time per account.
   * If a refresh is already in progress, the caller waits for it to complete.
   *
   * @param accountId - Account ID to refresh
   * @param account - PoolAccount object
   * @throws {AuthenticationError} If token refresh fails
   */
  private async refreshTokenWithLock(accountId: string, account: PoolAccount): Promise<void> {
    // Check if refresh already in progress
    if (this.tokenRefreshLocks.has(accountId)) {
      // Wait for existing refresh to complete
      await this.tokenRefreshLocks.get(accountId);
      return;
    }

    // Start new refresh with automatic cleanup
    const refreshPromise = (async () => {
      try {
        await this.authManager.refreshSession(account);
      } finally {
        // Always clean up the lock, even on failure
        this.tokenRefreshLocks.delete(accountId);
      }
    })();

    // Store promise in map before awaiting
    this.tokenRefreshLocks.set(accountId, refreshPromise);
    await refreshPromise;
  }

  /**
   * Get refreshed credentials for an account
   *
   * Refreshes the token if needed and returns updated credentials.
   * Uses in-flight deduplication to prevent concurrent refreshes.
   *
   * @param accountId - Account ID to refresh
   * @param account - PoolAccount object
   * @returns Updated credentials or null if refresh failed
   */
  async getRefreshedCredentials(accountId: string, account: PoolAccount): Promise<any> {
    // Check if refresh is already in progress via deduplicator
    if (this.tokenRefreshDeduplicator.hasPending(accountId)) {
      // Wait for existing refresh to complete
      await this.tokenRefreshDeduplicator.runWithLock(accountId, async () => {});
      // Refresh already happened, re-fetch credentials
      return this.keychainStore.retrieve(accountId);
    }

    // Check if token needs refresh
    const credentials = await this.keychainStore.retrieve(accountId);
    if (!credentials?.expiresAt) {
      return credentials; // No expiry info, return as-is
    }

    const provider = account.provider === 'kiro' ? 'kiro' : 'kiro-oauth';
    if (!needsTokenRefresh(credentials.expiresAt, provider)) {
      return credentials; // No refresh needed
    }

    // Run refresh with deduplication
    try {
      await this.tokenRefreshDeduplicator.runWithLock(accountId, async () => {
        await this.authManager.refreshSession(account);
      });
      // Refresh completed, re-fetch credentials
      return await this.keychainStore.retrieve(accountId);
    } catch (error) {
      // Refresh failed, clear the deduplicator and re-throw
      this.tokenRefreshDeduplicator.clear(accountId);
      throw error;
    }
  }

  /**
   * Update account quota after request
   *
   * @param accountId - Account ID
   * @param tokensUsed - Tokens used in request
   */
  async updateQuota(accountId: string, tokensUsed: number): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Update in-memory quota
    account.quota.requestsPerMinuteUsed += 1;
    account.quota.tokensPerDayUsed += tokensUsed;

    // Store in Redis with TTL
    await this.storeQuotaInRedis(account);

    // Also update QuotaManagementManager if available
    // Requirement: 12.1
    if (this.quotaManagementManager) {
      try {
        await this.quotaManagementManager.updateQuotaUsage(accountId, tokensUsed);
      } catch (error) {
        // Graceful degradation: don't fail quota update if quota manager fails
        console.error('[AccountPool] Failed to update quota management:', error);
      }
    }
  }

  /**
   * Update account performance metrics
   *
   * @param accountId - Account ID
   * @param latency - Request latency in milliseconds
   * @param success - Whether request was successful
   */
  async updatePerformance(accountId: string, latency: number, success: boolean): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Update average latency (exponential moving average)
    const alpha = 0.2; // Smoothing factor
    account.performance.averageLatency =
      alpha * latency + (1 - alpha) * account.performance.averageLatency;

    // Update success rate (exponential moving average)
    const successValue = success ? 1.0 : 0.0;
    account.performance.successRate =
      alpha * successValue + (1 - alpha) * account.performance.successRate;

    // Update last used timestamp
    account.performance.lastUsed = Date.now();
  }

  /**
   * Predict quota reset time based on historical data
   *
   * @param accountId - Account ID
   * @returns Predicted reset time (Unix timestamp)
   */
  async predictReset(accountId: string): Promise<number> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Load historical reset times from Redis
    const historyKey = `quota:history:${accountId}`;
    const history = await this.redisClient.getClient().lrange(historyKey, 0, 9);

    if (history.length < 2) {
      // Not enough data, return current reset time
      return account.quota.resetTime;
    }

    // Calculate average interval between resets
    const intervals: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prev = parseInt(history[i - 1], 10);
      const curr = parseInt(history[i], 10);
      intervals.push(curr - prev);
    }

    const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;

    // Predict next reset time
    const lastReset = parseInt(history[0], 10);
    const predictedReset = lastReset + avgInterval;

    return predictedReset;
  }

  /**
   * Store quota information in Redis
   *
   * @param account - Account with updated quota
   */
  private async storeQuotaInRedis(account: PoolAccount): Promise<void> {
    const key = `quota:${account.id}`;
    const data = JSON.stringify(account.quota);

    // Calculate TTL until reset time
    const ttl = Math.max(60, Math.floor((account.quota.resetTime - Date.now()) / 1000));

    await this.redisClient.getClient().setex(key, ttl, data);
  }

  /**
   * Load quota information from Redis for all accounts
   */
  private async loadQuotaFromRedis(): Promise<void> {
    const promises = Array.from(this.accounts.values()).map(async (account) => {
      const key = `quota:${account.id}`;
      const data = await this.redisClient.getClient().get(key);

      if (data) {
        try {
          const quota = JSON.parse(data) as AccountQuota;
          account.quota = quota;
        } catch (error) {
          console.error(`Failed to parse quota for account ${account.id}:`, error);
        }
      }
    });

    await Promise.all(promises);
  }

  /**
   * Record quota reset event
   *
   * @param accountId - Account ID
   * @param resetTime - Reset time (Unix timestamp)
   */
  async recordQuotaReset(accountId: string, resetTime: number): Promise<void> {
    const historyKey = `quota:history:${accountId}`;

    // Add to history (keep last 10 resets)
    await this.redisClient.getClient().lpush(historyKey, resetTime.toString());
    await this.redisClient.getClient().ltrim(historyKey, 0, 9);

    // Set expiry on history (30 days)
    await this.redisClient.getClient().expire(historyKey, 30 * 24 * 60 * 60);
  }

  /**
   * Get all accounts in pool
   *
   * @returns Array of accounts
   */
  getAccounts(): PoolAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * Get account by ID
   *
   * @param accountId - Account ID
   * @returns Account or undefined
   */
  getAccount(accountId: string): PoolAccount | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * Failover to next available account after current account fails
   *
   * @param currentAccountId - ID of account that failed
   * @returns Next available account selection result
   * @throws {NoHealthyAccountsError} If no healthy accounts available
   */
  async failover(currentAccountId: string): Promise<AccountSelectionResult> {
    // Mark current account unhealthy
    this.markUnhealthy(currentAccountId, 'Failover triggered');

    // Record failure in circuit breaker for kiro-oauth accounts
    const account = this.accounts.get(currentAccountId);
    if (account && account.provider === 'kiro-oauth') {
      const circuitBreaker = this.circuitBreakers.get(currentAccountId);
      if (circuitBreaker) {
        circuitBreaker.recordFailure();
      }
    }

    // Select next available account
    try {
      return await this.selectAccount();
    } catch (error) {
      if (error instanceof NoHealthyAccountsError) {
        throw error;
      }
      throw new NoHealthyAccountsError();
    }
  }

  /**
   * Mark account as unhealthy
   *
   * @param accountId - Account ID
   * @param reason - Reason for marking unhealthy
   */
  markUnhealthy(accountId: string, reason: string): void {
    const account = this.accounts.get(accountId);
    if (!account) {
      return;
    }

    // Update account status (if it has a status field)
    if ('status' in account) {
      (account as any).status = 'unhealthy';
    }

    // Increment error count for kiro-oauth accounts
    if (account.provider === 'kiro-oauth' && 'errorCount' in account) {
      (account as any).errorCount = ((account as any).errorCount || 0) + 1;
    }

    // Log sanitized reason
    const sanitizedReason = LogSanitizer.sanitize(reason);
    console.warn(`Account ${accountId} marked unhealthy: ${sanitizedReason}`);
  }

  /**
   * Mark account as healthy
   *
   * @param accountId - Account ID
   */
  markHealthy(accountId: string): void {
    const account = this.accounts.get(accountId);
    if (!account) {
      return;
    }

    // Update account status (if it has a status field)
    if ('status' in account) {
      (account as any).status = 'healthy';
    }

    // Reset error count for kiro-oauth accounts
    if (account.provider === 'kiro-oauth' && 'errorCount' in account) {
      (account as any).errorCount = 0;
    }

    console.info(`Account ${accountId} marked healthy`);
  }

  /**
   * Start periodic health checks for all kiro-oauth accounts
   */
  startHealthChecks(): void {
    for (const [accountId, healthMonitor] of this.healthMonitors.entries()) {
      healthMonitor.startHealthChecks();
      console.info(`Started health checks for account ${accountId}`);
    }
  }

  /**
   * Stop periodic health checks for all kiro-oauth accounts
   */
  stopHealthChecks(): void {
    for (const [accountId, healthMonitor] of this.healthMonitors.entries()) {
      healthMonitor.stopHealthChecks();
      console.info(`Stopped health checks for account ${accountId}`);
    }
  }
}
