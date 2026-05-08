/**
 * Tests for Performance Optimizer
 *
 * Tests cached prepared statements, batch inserts, ranking cache,
 * and optimized cost calculation.
 *
 * Requirements: 3.5, 11.5, 16.1, 16.2, 16.5
 */

import {
  calculateCostOptimized,
  TOKEN_PRICING_PER_TOKEN,
  PreparedStatementCache,
  batchInsertEvents,
  RankingCache,
} from './PerformanceOptimizer.js';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import path from 'path';
import os from 'os';

describe('PerformanceOptimizer', () => {
  describe('calculateCostOptimized', () => {
    it('should calculate cost correctly for input tokens', () => {
      const cost = calculateCostOptimized({
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
      expect(cost).toBeCloseTo(15, 2); // $15 per 1M
    });

    it('should calculate cost correctly for output tokens', () => {
      const cost = calculateCostOptimized({
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
      expect(cost).toBeCloseTo(15, 2); // $15 per 1M
    });

    it('should calculate cost correctly for cache read tokens', () => {
      const cost = calculateCostOptimized({
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 1_000_000,
      });
      expect(cost).toBeCloseTo(1.5, 2); // $1.50 per 1M
    });

    it('should calculate cost correctly for mixed tokens', () => {
      const cost = calculateCostOptimized({
        inputTokens: 500_000,
        outputTokens: 500_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 1_000_000,
      });
      // 0.5M * $15 + 0.5M * $15 + 1M * $1.50 = 7.5 + 7.5 + 1.5 = 16.5
      expect(cost).toBeCloseTo(16.5, 2);
    });

    it('should return 0 for zero tokens', () => {
      const cost = calculateCostOptimized({
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      });
      expect(cost).toBe(0);
    });

    it('should be fast (no division in hot path)', () => {
      const start = Date.now();
      for (let i = 0; i < 100_000; i++) {
        calculateCostOptimized({
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 200,
          cacheReadTokens: 300,
        });
      }
      const elapsed = Date.now() - start;

      // 100K cost calculations should be well under 100ms
      expect(elapsed).toBeLessThan(100);
    });

    it('should match per-token pricing constants', () => {
      // Verify precomputed constants are correct
      expect(TOKEN_PRICING_PER_TOKEN.INPUT).toBeCloseTo(15 / 1_000_000, 10);
      expect(TOKEN_PRICING_PER_TOKEN.OUTPUT).toBeCloseTo(15 / 1_000_000, 10);
      expect(TOKEN_PRICING_PER_TOKEN.CACHE_CREATION).toBeCloseTo(15 / 1_000_000, 10);
      expect(TOKEN_PRICING_PER_TOKEN.CACHE_READ).toBeCloseTo(1.5 / 1_000_000, 10);
    });
  });

  describe('PreparedStatementCache', () => {
    let storage: TimeSeriesStorage;
    let cache: PreparedStatementCache;
    let testDbPath: string;

    beforeEach(() => {
      testDbPath = path.join(os.tmpdir(), `claudeflow-perf-test-${Date.now()}.db`);
      storage = new TimeSeriesStorage({ databasePath: testDbPath });
      cache = new PreparedStatementCache();
    });

    afterEach(() => {
      storage.close();
    });

    it('should cache and reuse prepared statements', () => {
      const db = storage.getDatabase();
      const sql = 'SELECT 1';

      const stmt1 = cache.getOrPrepare(db, sql);
      const stmt2 = cache.getOrPrepare(db, sql);

      expect(stmt1).toBe(stmt2); // Same reference
      expect(cache.size()).toBe(1);
    });

    it('should cache different statements separately', () => {
      const db = storage.getDatabase();

      cache.getOrPrepare(db, 'SELECT 1');
      cache.getOrPrepare(db, 'SELECT 2');

      expect(cache.size()).toBe(2);
    });

    it('should evict oldest entries when at max capacity', () => {
      const smallCache = new PreparedStatementCache(3);
      const db = storage.getDatabase();

      smallCache.getOrPrepare(db, 'SELECT 1');
      smallCache.getOrPrepare(db, 'SELECT 2');
      smallCache.getOrPrepare(db, 'SELECT 3');
      smallCache.getOrPrepare(db, 'SELECT 4'); // Should evict first

      expect(smallCache.size()).toBe(3);
    });

    it('should clear the cache', () => {
      const db = storage.getDatabase();
      cache.getOrPrepare(db, 'SELECT 1');
      cache.getOrPrepare(db, 'SELECT 2');

      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe('batchInsertEvents', () => {
    let storage: TimeSeriesStorage;
    let testDbPath: string;

    beforeEach(() => {
      testDbPath = path.join(os.tmpdir(), `claudeflow-batch-test-${Date.now()}.db`);
      storage = new TimeSeriesStorage({ databasePath: testDbPath });
    });

    afterEach(() => {
      storage.close();
    });

    it('should batch insert events in a transaction', () => {
      const events = Array.from({ length: 100 }, (_, i) => ({
        timestamp: Date.now() - i * 1000,
        accountId: `account-${i % 5}`,
        model: 'claude-3.5-sonnet',
        region: 'us-east-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.015,
        latency: 200,
        status: 'success' as const,
        errorCode: undefined,
      }));

      const count = batchInsertEvents(storage.getDatabase(), events);
      expect(count).toBe(100);
    });

    it('should return 0 for empty array', () => {
      const count = batchInsertEvents(storage.getDatabase(), []);
      expect(count).toBe(0);
    });

    it('should insert all events atomically (transaction)', () => {
      const events = Array.from({ length: 50 }, () => ({
        timestamp: Date.now(),
        accountId: 'test-account',
        model: 'claude-3.5-sonnet',
        region: 'us-east-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.002,
        latency: 100,
        status: 'success' as const,
        errorCode: undefined,
      }));

      batchInsertEvents(storage.getDatabase(), events);

      // Verify all inserted
      const results = storage.queryEvents({
        start: new Date(Date.now() - 60000),
        end: new Date(Date.now() + 1000),
      });
      expect(results.length).toBe(50);
    });
  });

  describe('RankingCache', () => {
    let rankingCache: RankingCache;

    beforeEach(() => {
      rankingCache = new RankingCache(1000, 10); // 1s TTL for testing, max 10 entries
    });

    it('should store and retrieve rankings', () => {
      const accounts = [
        {
          accountId: 'account-1',
          score: 0.9,
          quotaRemaining: 0.9,
          quotaPercentage: 10,
          resetTime: new Date(),
          averageLatency: 100,
          successRate: 0.95,
          reason: 'Best available',
        },
      ];

      rankingCache.set('rankings', accounts);
      const cached = rankingCache.get('rankings');

      expect(cached).toEqual(accounts);
    });

    it('should return null for missing entries', () => {
      expect(rankingCache.get('nonexistent')).toBeNull();
    });

    it('should expire entries after TTL', async () => {
      const accounts = [
        {
          accountId: 'account-1',
          score: 0.9,
          quotaRemaining: 0.9,
          quotaPercentage: 10,
          resetTime: new Date(),
          averageLatency: 100,
          successRate: 0.95,
          reason: 'Best available',
        },
      ];

      rankingCache.set('rankings', accounts);

      // Wait for TTL to expire (1 second)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(rankingCache.get('rankings')).toBeNull();
    });

    it('should invalidate specific entries', () => {
      rankingCache.set('key-1', []);
      rankingCache.set('key-2', []);

      rankingCache.invalidate('key-1');

      expect(rankingCache.get('key-1')).toBeNull();
      expect(rankingCache.has('key-2')).toBe(true);
    });

    it('should invalidate all entries', () => {
      rankingCache.set('key-1', []);
      rankingCache.set('key-2', []);

      rankingCache.invalidateAll();

      expect(rankingCache.size()).toBe(0);
    });

    it('should evict oldest entries when at max capacity', () => {
      const smallCache = new RankingCache(60000, 3);

      smallCache.set('key-1', []);
      smallCache.set('key-2', []);
      smallCache.set('key-3', []);
      smallCache.set('key-4', []); // Should evict key-1

      expect(smallCache.size()).toBe(3);
      expect(smallCache.has('key-1')).toBe(false);
    });

    it('should report has() correctly', () => {
      expect(rankingCache.has('key')).toBe(false);

      rankingCache.set('key', []);
      expect(rankingCache.has('key')).toBe(true);
    });
  });
});
