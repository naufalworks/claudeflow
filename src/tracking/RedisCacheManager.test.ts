/**
 * Unit tests for RedisCacheManager
 *
 * Tests caching of usage stats, quota status, and ranked accounts
 * using ioredis-mock for Redis simulation.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5
 */

import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { RedisCacheManager } from './RedisCacheManager.js';
import { UsageStats } from './TimeSeriesStorage.types.js';
import { QuotaStatus, RankedAccount } from './QuotaManagementManager.types.js';
import { CacheKeyPrefixes } from './RedisCacheManager.types.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const mockUsageStats: UsageStats = {
  totalRequests: 100,
  totalTokens: 50000,
  totalCost: 0.75,
  averageLatency: 1500,
  successRate: 0.95,
  breakdown: { byModel: {}, byRegion: {} },
};

const mockQuotaStatus: QuotaStatus = {
  accountId: 'acc_001',
  requestsPerMinute: { used: 100, limit: 4000, resetTime: new Date() },
  tokensPerDay: { used: 500000, limit: 5000000, resetTime: new Date() },
  status: 'available',
};

const mockRankedAccounts: RankedAccount[] = [
  {
    accountId: 'acc_001',
    score: 0.85,
    quotaRemaining: 4500000,
    quotaPercentage: 0.9,
    resetTime: new Date(),
    averageLatency: 1000,
    successRate: 0.95,
    reason: 'Good availability',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RedisCacheManager', () => {
  let redis: Redis;
  let cacheManager: RedisCacheManager;

  beforeEach(() => {
    redis = new RedisMock() as Redis;
    cacheManager = new RedisCacheManager(redis);
  });

  afterEach(async () => {
    await redis.flushall();
    redis.disconnect();
  });

  // -------------------------------------------------------------------------
  // Construction & Health Check
  // -------------------------------------------------------------------------

  describe('Construction', () => {
    it('should create an instance with default config', () => {
      const manager = new RedisCacheManager(redis);
      expect(manager).toBeInstanceOf(RedisCacheManager);
    });

    it('should create an instance with custom config', () => {
      const manager = new RedisCacheManager(redis, {
        usageTTLSeconds: 3600,
        quotaTTLSeconds: 30,
        rankedTTLSeconds: 120,
        maxEntrySizeBytes: 512 * 1024,
      });
      expect(manager).toBeInstanceOf(RedisCacheManager);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Redis is available', async () => {
      const result = await cacheManager.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when Redis ping throws', async () => {
      // ioredis-mock doesn't fully simulate disconnect, so we override ping
      const originalPing = redis.ping.bind(redis);
      redis.ping = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await cacheManager.healthCheck();
      expect(result).toBe(false);

      // Restore
      redis.ping = originalPing;
    });
  });

  // -------------------------------------------------------------------------
  // Usage Stats Cache (Requirement: 15.1)
  // -------------------------------------------------------------------------

  describe('getCachedUsageStats / setCachedUsageStats', () => {
    it('should return null when no cached data exists', async () => {
      const result = await cacheManager.getCachedUsageStats('acc_001');
      expect(result).toBeNull();
    });

    it('should set and get usage stats for an account', async () => {
      await cacheManager.setCachedUsageStats('acc_001', mockUsageStats);
      const result = await cacheManager.getCachedUsageStats('acc_001');

      expect(result).not.toBeNull();
      expect(result!.totalRequests).toBe(100);
      expect(result!.totalTokens).toBe(50000);
      expect(result!.totalCost).toBe(0.75);
      expect(result!.averageLatency).toBe(1500);
      expect(result!.successRate).toBe(0.95);
    });

    it('should store data with correct Redis key', async () => {
      await cacheManager.setCachedUsageStats('acc_001', mockUsageStats);

      const key = `${CacheKeyPrefixes.USAGE_ACCOUNT}acc_001:24h`;
      const stored = await redis.get(key);
      expect(stored).toBeTruthy();
    });

    it('should set TTL on cached data', async () => {
      await cacheManager.setCachedUsageStats('acc_001', mockUsageStats);

      const key = `${CacheKeyPrefixes.USAGE_ACCOUNT}acc_001:24h`;
      const ttl = await redis.ttl(key);
      // Default usage TTL is 86400 seconds (24h)
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
    });

    it('should add accountId to tracker SET', async () => {
      await cacheManager.setCachedUsageStats('acc_001', mockUsageStats);

      const members = await redis.smembers(CacheKeyPrefixes.TRACKER_USAGE);
      expect(members).toContain('acc_001');
    });

    it('should return null for invalid accountId', async () => {
      const result = await cacheManager.getCachedUsageStats('acc;DROP TABLE');
      expect(result).toBeNull();
    });

    it('should skip caching for invalid accountId', async () => {
      await cacheManager.setCachedUsageStats('acc;DROP TABLE', mockUsageStats);

      const key = `${CacheKeyPrefixes.USAGE_ACCOUNT}acc;DROP TABLE:24h`;
      const stored = await redis.get(key);
      expect(stored).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Total Usage Cache (Requirement: 15.2)
  // -------------------------------------------------------------------------

  describe('getCachedTotalUsage / setCachedTotalUsage', () => {
    it('should return null when no cached total usage exists', async () => {
      const result = await cacheManager.getCachedTotalUsage();
      expect(result).toBeNull();
    });

    it('should set and get total usage stats', async () => {
      await cacheManager.setCachedTotalUsage(mockUsageStats);
      const result = await cacheManager.getCachedTotalUsage();

      expect(result).not.toBeNull();
      expect(result!.totalRequests).toBe(100);
      expect(result!.totalTokens).toBe(50000);
      expect(result!.totalCost).toBe(0.75);
    });

    it('should store data with correct Redis key', async () => {
      await cacheManager.setCachedTotalUsage(mockUsageStats);

      const stored = await redis.get(CacheKeyPrefixes.USAGE_TOTAL);
      expect(stored).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Quota Status Cache (Requirement: 15.3)
  // -------------------------------------------------------------------------

  describe('getCachedQuotaStatus / setCachedQuotaStatus', () => {
    it('should return null when no cached quota status exists', async () => {
      const result = await cacheManager.getCachedQuotaStatus('acc_001');
      expect(result).toBeNull();
    });

    it('should set and get quota status for an account', async () => {
      await cacheManager.setCachedQuotaStatus('acc_001', mockQuotaStatus);
      const result = await cacheManager.getCachedQuotaStatus('acc_001');

      expect(result).not.toBeNull();
      expect(result!.accountId).toBe('acc_001');
      expect(result!.requestsPerMinute.used).toBe(100);
      expect(result!.requestsPerMinute.limit).toBe(4000);
      expect(result!.tokensPerDay.used).toBe(500000);
      expect(result!.tokensPerDay.limit).toBe(5000000);
      expect(result!.status).toBe('available');
    });

    it('should store data with correct Redis key', async () => {
      await cacheManager.setCachedQuotaStatus('acc_001', mockQuotaStatus);

      const key = `${CacheKeyPrefixes.QUOTA_ACCOUNT}acc_001`;
      const stored = await redis.get(key);
      expect(stored).toBeTruthy();
    });

    it('should set TTL of 60 seconds on quota cache', async () => {
      await cacheManager.setCachedQuotaStatus('acc_001', mockQuotaStatus);

      const key = `${CacheKeyPrefixes.QUOTA_ACCOUNT}acc_001`;
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });

    it('should return null for invalid accountId', async () => {
      const result = await cacheManager.getCachedQuotaStatus('../etc/passwd');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Ranked Accounts Cache (Requirement: 15.4)
  // -------------------------------------------------------------------------

  describe('getCachedRankedAccounts / setCachedRankedAccounts', () => {
    it('should return null when no cached ranked accounts exist', async () => {
      const result = await cacheManager.getCachedRankedAccounts();
      expect(result).toBeNull();
    });

    it('should set and get ranked accounts', async () => {
      await cacheManager.setCachedRankedAccounts(mockRankedAccounts);
      const result = await cacheManager.getCachedRankedAccounts();

      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].accountId).toBe('acc_001');
      expect(result![0].score).toBe(0.85);
      expect(result![0].quotaRemaining).toBe(4500000);
      expect(result![0].reason).toBe('Good availability');
    });

    it('should store data with correct Redis key', async () => {
      await cacheManager.setCachedRankedAccounts(mockRankedAccounts);

      const stored = await redis.get(CacheKeyPrefixes.RANKED_ACCOUNTS);
      expect(stored).toBeTruthy();
    });

    it('should set TTL of 300 seconds on ranked accounts cache', async () => {
      await cacheManager.setCachedRankedAccounts(mockRankedAccounts);

      const ttl = await redis.ttl(CacheKeyPrefixes.RANKED_ACCOUNTS);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    });
  });

  // -------------------------------------------------------------------------
  // Cache Invalidation
  // -------------------------------------------------------------------------

  describe('invalidateUsageCache', () => {
    it('should invalidate specific account usage cache', async () => {
      await cacheManager.setCachedUsageStats('acc_001', mockUsageStats);
      await cacheManager.setCachedUsageStats('acc_002', mockUsageStats);

      await cacheManager.invalidateUsageCache('acc_001');

      const result1 = await cacheManager.getCachedUsageStats('acc_001');
      const result2 = await cacheManager.getCachedUsageStats('acc_002');

      expect(result1).toBeNull();
      expect(result2).not.toBeNull();
    });

    it('should invalidate all usage caches when no accountId provided', async () => {
      await cacheManager.setCachedUsageStats('acc_001', mockUsageStats);
      await cacheManager.setCachedUsageStats('acc_002', mockUsageStats);
      await cacheManager.setCachedTotalUsage(mockUsageStats);

      await cacheManager.invalidateUsageCache();

      const result1 = await cacheManager.getCachedUsageStats('acc_001');
      const result2 = await cacheManager.getCachedUsageStats('acc_002');
      const total = await cacheManager.getCachedTotalUsage();

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(total).toBeNull();
    });

    it('should clear the usage tracker SET on wildcard invalidation', async () => {
      await cacheManager.setCachedUsageStats('acc_001', mockUsageStats);
      await cacheManager.setCachedUsageStats('acc_002', mockUsageStats);

      await cacheManager.invalidateUsageCache();

      const members = await redis.smembers(CacheKeyPrefixes.TRACKER_USAGE);
      expect(members).toHaveLength(0);
    });
  });

  describe('invalidateQuotaCache', () => {
    it('should invalidate specific account quota cache', async () => {
      await cacheManager.setCachedQuotaStatus('acc_001', mockQuotaStatus);
      await cacheManager.setCachedQuotaStatus('acc_002', mockQuotaStatus);

      await cacheManager.invalidateQuotaCache('acc_001');

      const result1 = await cacheManager.getCachedQuotaStatus('acc_001');
      const result2 = await cacheManager.getCachedQuotaStatus('acc_002');

      expect(result1).toBeNull();
      expect(result2).not.toBeNull();
    });

    it('should invalidate all quota caches when no accountId provided', async () => {
      await cacheManager.setCachedQuotaStatus('acc_001', mockQuotaStatus);
      await cacheManager.setCachedQuotaStatus('acc_002', mockQuotaStatus);

      await cacheManager.invalidateQuotaCache();

      const result1 = await cacheManager.getCachedQuotaStatus('acc_001');
      const result2 = await cacheManager.getCachedQuotaStatus('acc_002');

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('should clear the quota tracker SET on wildcard invalidation', async () => {
      await cacheManager.setCachedQuotaStatus('acc_001', mockQuotaStatus);
      await cacheManager.setCachedQuotaStatus('acc_002', mockQuotaStatus);

      await cacheManager.invalidateQuotaCache();

      const members = await redis.smembers(CacheKeyPrefixes.TRACKER_QUOTA);
      expect(members).toHaveLength(0);
    });
  });

  describe('invalidateRankedAccounts', () => {
    it('should invalidate the ranked accounts cache', async () => {
      await cacheManager.setCachedRankedAccounts(mockRankedAccounts);

      await cacheManager.invalidateRankedAccounts();

      const result = await cacheManager.getCachedRankedAccounts();
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should return null on getCachedUsageStats when Redis errors', async () => {
      // Disconnect Redis to simulate error
      redis.disconnect();

      const result = await cacheManager.getCachedUsageStats('acc_001');
      expect(result).toBeNull();
    });

    it('should not throw on setCachedUsageStats when Redis errors', async () => {
      redis.disconnect();

      await expect(
        cacheManager.setCachedUsageStats('acc_001', mockUsageStats)
      ).resolves.not.toThrow();
    });

    it('should return null on getCachedTotalUsage when Redis errors', async () => {
      redis.disconnect();

      const result = await cacheManager.getCachedTotalUsage();
      expect(result).toBeNull();
    });

    it('should not throw on invalidateUsageCache when Redis errors', async () => {
      redis.disconnect();

      await expect(cacheManager.invalidateUsageCache()).resolves.not.toThrow();
    });

    it('should not throw on invalidateQuotaCache when Redis errors', async () => {
      redis.disconnect();

      await expect(cacheManager.invalidateQuotaCache()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('should handle accountId with special characters', async () => {
      // Invalid account IDs with special characters
      const invalidIds = ['acc<script>', 'acc OR 1=1', '../secret', 'acc&id', 'acc path'];

      for (const invalidId of invalidIds) {
        const result = await cacheManager.getCachedUsageStats(invalidId);
        expect(result).toBeNull();

        await cacheManager.setCachedUsageStats(invalidId, mockUsageStats);
        const afterSet = await cacheManager.getCachedUsageStats(invalidId);
        expect(afterSet).toBeNull();
      }
    });

    it('should handle accountId with valid special characters (underscore, hyphen)', async () => {
      await cacheManager.setCachedUsageStats('acc_001-test', mockUsageStats);
      const result = await cacheManager.getCachedUsageStats('acc_001-test');

      expect(result).not.toBeNull();
      expect(result!.totalRequests).toBe(100);
    });

    it('should handle empty ranked accounts array', async () => {
      await cacheManager.setCachedRankedAccounts([]);
      const result = await cacheManager.getCachedRankedAccounts();

      expect(result).not.toBeNull();
      expect(result).toHaveLength(0);
    });

    it('should handle large data exceeding size limit', async () => {
      // Create a cache manager with very small size limit
      const smallCache = new RedisCacheManager(redis, {
        maxEntrySizeBytes: 10,
      });

      await smallCache.setCachedUsageStats('acc_001', mockUsageStats);
      const result = await smallCache.getCachedUsageStats('acc_001');

      // Data should not have been cached due to size limit
      expect(result).toBeNull();
    });

    it('should handle quota status with near_limit status', async () => {
      const nearLimitStatus: QuotaStatus = {
        accountId: 'acc_002',
        requestsPerMinute: { used: 3900, limit: 4000, resetTime: new Date() },
        tokensPerDay: { used: 4900000, limit: 5000000, resetTime: new Date() },
        status: 'near_limit',
      };

      await cacheManager.setCachedQuotaStatus('acc_002', nearLimitStatus);
      const result = await cacheManager.getCachedQuotaStatus('acc_002');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('near_limit');
    });

    it('should handle quota status with exceeded status', async () => {
      const exceededStatus: QuotaStatus = {
        accountId: 'acc_003',
        requestsPerMinute: { used: 4000, limit: 4000, resetTime: new Date() },
        tokensPerDay: { used: 5000000, limit: 5000000, resetTime: new Date() },
        status: 'exceeded',
      };

      await cacheManager.setCachedQuotaStatus('acc_003', exceededStatus);
      const result = await cacheManager.getCachedQuotaStatus('acc_003');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('exceeded');
    });

    it('should handle multiple ranked accounts', async () => {
      const manyAccounts: RankedAccount[] = Array.from({ length: 10 }, (_, i) => ({
        accountId: `acc_${String(i).padStart(3, '0')}`,
        score: 0.9 - i * 0.05,
        quotaRemaining: 4000000 - i * 200000,
        quotaPercentage: 0.8 + i * 0.015,
        resetTime: new Date(),
        averageLatency: 1000 + i * 100,
        successRate: 0.99 - i * 0.01,
        reason: `Account ${i} - ${i < 3 ? 'good' : 'moderate'} availability`,
      }));

      await cacheManager.setCachedRankedAccounts(manyAccounts);
      const result = await cacheManager.getCachedRankedAccounts();

      expect(result).not.toBeNull();
      expect(result).toHaveLength(10);
      expect(result![0].accountId).toBe('acc_000');
      expect(result![9].accountId).toBe('acc_009');
    });
  });
});
