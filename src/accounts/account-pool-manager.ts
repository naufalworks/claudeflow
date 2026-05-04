/**
 * AccountPoolManager
 * 
 * Manages a pool of Anthropic API accounts with intelligent selection
 * based on quota availability, performance, and cost efficiency.
 * 
 * Supports three account types:
 * - Direct Anthropic (provider: 'anthropic')
 * - Anthropic-compatible proxies (provider: 'proxy')
 * - OAuth routers (provider: 'kiro')
 * 
 * CRITICAL: All account types MUST return raw Anthropic format.
 */

import type { RedisClientWrapper } from '../infrastructure/redis';
import type { Account } from '../config/schema';
import type { AnthropicRequest, AnthropicResponse } from '../types/anthropic.types';
import { AuthManager } from '../auth/AuthManager.js';
import { AnthropicClient } from '../clients/AnthropicClient.js';
import { ProxyClient } from '../clients/ProxyClient.js';
import { OAuthClient } from '../clients/OAuthClient.js';
import { ResponseFormatValidator } from '../clients/ResponseFormatValidator.js';

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
  private responseValidator: ResponseFormatValidator;

  constructor(redisClient: RedisClientWrapper, config: any) {
    this.accounts = new Map();
    this.redisClient = redisClient;
    this.config = config;
    
    // Initialize clients
    this.authManager = new AuthManager();
    this.anthropicClient = new AnthropicClient();
    this.proxyClient = new ProxyClient();
    this.oauthClient = new OAuthClient();
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
   * Add account to the pool
   * 
   * @param account - Account to add
   */
  addAccount(account: PoolAccount): void {
    this.accounts.set(account.id, account);
  }

  /**
   * Select best available account for request
   * 
   * @returns Account selection result
   */
  async selectAccount(): Promise<AccountSelectionResult> {
    if (this.accounts.size === 0) {
      throw new Error('No accounts available in pool');
    }

    // Load quota information from Redis for all accounts
    await this.loadQuotaFromRedis();

    // Score all accounts
    const scoredAccounts = Array.from(this.accounts.values())
      .map((account) => ({
        account,
        score: this.calculateAccountScore(account),
        reason: this.getSelectionReason(account),
      }))
      .filter((result) => result.score > 0); // Filter out accounts with no quota

    if (scoredAccounts.length === 0) {
      throw new Error('No accounts with available quota');
    }

    // Sort by score (highest first)
    scoredAccounts.sort((a, b) => b.score - a.score);

    const selectedResult = scoredAccounts[0];
    
    // For OAuth accounts, check if session needs refresh
    if (selectedResult.account.provider === 'kiro') {
      const needsRefresh = await this.authManager.needsRefresh(selectedResult.account);
      if (needsRefresh) {
        try {
          await this.authManager.refreshSession(selectedResult.account);
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
          response = await this.proxyClient.sendRequest(
            request,
            account.apiKey,
            account.baseURL
          );
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
          
        default:
          throw new Error(`Unsupported account provider: ${(account as any).provider}`);
      }
      
      // Response is already validated by the client, but double-check
      if (!this.responseValidator.isAnthropicFormat(response)) {
        throw new Error(`Invalid response format from ${account.provider} account`);
      }
      
      return response;
      
    } catch (error) {
      // Re-throw with context
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Request failed for ${account.provider} account ${account.id}: ${errorMessage}`);
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
  }

  /**
   * Update account performance metrics
   * 
   * @param accountId - Account ID
   * @param latency - Request latency in milliseconds
   * @param success - Whether request was successful
   */
  async updatePerformance(
    accountId: string,
    latency: number,
    success: boolean
  ): Promise<void> {
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

    const avgInterval =
      intervals.reduce((sum, val) => sum + val, 0) / intervals.length;

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
}
