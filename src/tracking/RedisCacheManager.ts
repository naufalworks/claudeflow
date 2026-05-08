/**
 * RedisCacheManager
 *
 * Redis caching layer for usage tracking data. Caches usage stats,
 * quota status, and ranked accounts with configurable TTLs.
 *
 * Security: Validates account IDs, enforces max entry size, never throws.
 * Never uses KEYS command - uses tracker SETs for wildcard invalidation.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5
 */

import Redis from 'ioredis';
import { UsageStats } from './TimeSeriesStorage.types.js';
import { QuotaStatus, RankedAccount } from './QuotaManagementManager.types.js';
import {
  CacheConfig,
  DEFAULT_CACHE_CONFIG,
  CacheKeyPrefixes,
  ACCOUNT_ID_PATTERN,
} from './RedisCacheManager.types.js';

/**
 * Redis Cache Manager for usage tracking data
 *
 * Provides caching for usage stats, quota status, and ranked accounts.
 * All methods are safe - they catch errors internally and never throw.
 */
export class RedisCacheManager {
  private readonly redis: Redis;
  private readonly config: CacheConfig;

  /**
   * Create a new RedisCacheManager
   *
   * @param redis - ioredis Redis instance
   * @param config - Optional cache configuration (uses defaults if not provided)
   */
  constructor(redis: Redis, config?: Partial<CacheConfig>) {
    this.redis = redis;
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Usage Stats Cache (Requirements: 15.1, 15.2)
  // ---------------------------------------------------------------------------

  /**
   * Get cached usage stats for a specific account
   *
   * @param accountId - Account identifier (must match /^[a-zA-Z0-9_-]+$/)
   * @returns Cached UsageStats or null if not found / on error
   */
  async getCachedUsageStats(accountId: string): Promise<UsageStats | null> {
    try {
      if (!this.isValidAccountId(accountId)) {
        return null;
      }
      const key = `${CacheKeyPrefixes.USAGE_ACCOUNT}${accountId}:24h`;
      const data = await this.redis.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as UsageStats;
    } catch (error) {
      console.error('Error getting cached usage stats:', error);
      return null;
    }
  }

  /**
   * Set cached usage stats for a specific account
   *
   * @param accountId - Account identifier (must match /^[a-zA-Z0-9_-]+$/)
   * @param stats - UsageStats to cache
   */
  async setCachedUsageStats(accountId: string, stats: UsageStats): Promise<void> {
    try {
      if (!this.isValidAccountId(accountId)) {
        return;
      }
      const key = `${CacheKeyPrefixes.USAGE_ACCOUNT}${accountId}:24h`;
      const serialized = JSON.stringify(stats);

      if (!this.isWithinSizeLimit(serialized)) {
        return;
      }

      await this.redis.set(key, serialized, 'EX', this.config.usageTTLSeconds);
      // Track this account in the usage tracker SET for wildcard invalidation
      await this.redis.sadd(CacheKeyPrefixes.TRACKER_USAGE, accountId);
    } catch (error) {
      console.error('Error setting cached usage stats:', error);
    }
  }

  /**
   * Get cached total usage stats across all accounts
   *
   * @returns Cached UsageStats or null if not found / on error
   */
  async getCachedTotalUsage(): Promise<UsageStats | null> {
    try {
      const data = await this.redis.get(CacheKeyPrefixes.USAGE_TOTAL);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as UsageStats;
    } catch (error) {
      console.error('Error getting cached total usage:', error);
      return null;
    }
  }

  /**
   * Set cached total usage stats across all accounts
   *
   * @param stats - UsageStats to cache
   */
  async setCachedTotalUsage(stats: UsageStats): Promise<void> {
    try {
      const serialized = JSON.stringify(stats);

      if (!this.isWithinSizeLimit(serialized)) {
        return;
      }

      await this.redis.set(
        CacheKeyPrefixes.USAGE_TOTAL,
        serialized,
        'EX',
        this.config.usageTTLSeconds
      );
    } catch (error) {
      console.error('Error setting cached total usage:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Quota Status Cache (Requirement: 15.3)
  // ---------------------------------------------------------------------------

  /**
   * Get cached quota status for a specific account
   *
   * @param accountId - Account identifier (must match /^[a-zA-Z0-9_-]+$/)
   * @returns Cached QuotaStatus or null if not found / on error
   */
  async getCachedQuotaStatus(accountId: string): Promise<QuotaStatus | null> {
    try {
      if (!this.isValidAccountId(accountId)) {
        return null;
      }
      const key = `${CacheKeyPrefixes.QUOTA_ACCOUNT}${accountId}`;
      const data = await this.redis.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as QuotaStatus;
    } catch (error) {
      console.error('Error getting cached quota status:', error);
      return null;
    }
  }

  /**
   * Set cached quota status for a specific account
   *
   * @param accountId - Account identifier (must match /^[a-zA-Z0-9_-]+$/)
   * @param status - QuotaStatus to cache
   */
  async setCachedQuotaStatus(accountId: string, status: QuotaStatus): Promise<void> {
    try {
      if (!this.isValidAccountId(accountId)) {
        return;
      }
      const key = `${CacheKeyPrefixes.QUOTA_ACCOUNT}${accountId}`;
      const serialized = JSON.stringify(status);

      if (!this.isWithinSizeLimit(serialized)) {
        return;
      }

      await this.redis.set(key, serialized, 'EX', this.config.quotaTTLSeconds);
      // Track this account in the quota tracker SET for wildcard invalidation
      await this.redis.sadd(CacheKeyPrefixes.TRACKER_QUOTA, accountId);
    } catch (error) {
      console.error('Error setting cached quota status:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Ranked Accounts Cache (Requirement: 15.4)
  // ---------------------------------------------------------------------------

  /**
   * Get cached ranked accounts list
   *
   * @returns Cached RankedAccount[] or null if not found / on error
   */
  async getCachedRankedAccounts(): Promise<RankedAccount[] | null> {
    try {
      const data = await this.redis.get(CacheKeyPrefixes.RANKED_ACCOUNTS);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as RankedAccount[];
    } catch (error) {
      console.error('Error getting cached ranked accounts:', error);
      return null;
    }
  }

  /**
   * Set cached ranked accounts list
   *
   * @param accounts - RankedAccount[] to cache
   */
  async setCachedRankedAccounts(accounts: RankedAccount[]): Promise<void> {
    try {
      const serialized = JSON.stringify(accounts);

      if (!this.isWithinSizeLimit(serialized)) {
        return;
      }

      await this.redis.set(
        CacheKeyPrefixes.RANKED_ACCOUNTS,
        serialized,
        'EX',
        this.config.rankedTTLSeconds
      );
    } catch (error) {
      console.error('Error setting cached ranked accounts:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Cache Invalidation
  // ---------------------------------------------------------------------------

  /**
   * Invalidate usage stats cache
   *
   * If accountId is provided, deletes the cache for that specific account.
   * If no accountId is provided, deletes total usage cache and all tracked
   * account usage caches, then clears the tracker SET.
   *
   * @param accountId - Optional account ID to invalidate (wildcard if omitted)
   */
  async invalidateUsageCache(accountId?: string): Promise<void> {
    try {
      if (accountId) {
        if (!this.isValidAccountId(accountId)) {
          return;
        }
        const key = `${CacheKeyPrefixes.USAGE_ACCOUNT}${accountId}:24h`;
        await this.redis.del(key);
        await this.redis.srem(CacheKeyPrefixes.TRACKER_USAGE, accountId);
      } else {
        // Delete total usage key
        await this.redis.del(CacheKeyPrefixes.USAGE_TOTAL);

        // Get all tracked account IDs and delete their keys
        const trackedAccountIds = await this.redis.smembers(CacheKeyPrefixes.TRACKER_USAGE);
        if (trackedAccountIds.length > 0) {
          const keys = trackedAccountIds.map((id) => `${CacheKeyPrefixes.USAGE_ACCOUNT}${id}:24h`);
          await this.redis.del(...keys);
          await this.redis.del(CacheKeyPrefixes.TRACKER_USAGE);
        }
      }
    } catch (error) {
      console.error('Error invalidating usage cache:', error);
    }
  }

  /**
   * Invalidate quota status cache
   *
   * If accountId is provided, deletes the cache for that specific account.
   * If no accountId is provided, deletes all tracked quota caches
   * and clears the tracker SET.
   *
   * @param accountId - Optional account ID to invalidate (wildcard if omitted)
   */
  async invalidateQuotaCache(accountId?: string): Promise<void> {
    try {
      if (accountId) {
        if (!this.isValidAccountId(accountId)) {
          return;
        }
        const key = `${CacheKeyPrefixes.QUOTA_ACCOUNT}${accountId}`;
        await this.redis.del(key);
        await this.redis.srem(CacheKeyPrefixes.TRACKER_QUOTA, accountId);
      } else {
        // Get all tracked account IDs and delete their keys
        const trackedAccountIds = await this.redis.smembers(CacheKeyPrefixes.TRACKER_QUOTA);
        if (trackedAccountIds.length > 0) {
          const keys = trackedAccountIds.map((id) => `${CacheKeyPrefixes.QUOTA_ACCOUNT}${id}`);
          await this.redis.del(...keys);
          await this.redis.del(CacheKeyPrefixes.TRACKER_QUOTA);
        }
      }
    } catch (error) {
      console.error('Error invalidating quota cache:', error);
    }
  }

  /**
   * Invalidate the ranked accounts cache
   */
  async invalidateRankedAccounts(): Promise<void> {
    try {
      await this.redis.del(CacheKeyPrefixes.RANKED_ACCOUNTS);
    } catch (error) {
      console.error('Error invalidating ranked accounts cache:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  /**
   * Check Redis connectivity with a PING command
   *
   * @returns true if Redis responds to PING, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }

  /**
   * Disconnect from Redis gracefully
   */
  disconnect(): void {
    try {
      this.redis.disconnect();
    } catch (error) {
      console.error('Error disconnecting from Redis:', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate accountId format to prevent injection attacks
   */
  private isValidAccountId(accountId: string): boolean {
    return ACCOUNT_ID_PATTERN.test(accountId);
  }

  /**
   * Check if serialized data is within the configured size limit
   */
  private isWithinSizeLimit(serialized: string): boolean {
    return Buffer.byteLength(serialized, 'utf-8') <= this.config.maxEntrySizeBytes;
  }
}
