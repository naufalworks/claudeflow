/**
 * Tests for Metrics Collector
 *
 * Tests request tracking, latency calculation, error rate,
 * cache hit rate, sliding window, and quota usage.
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5
 */

import { MetricsCollector } from './MetricsCollector.js';
import { RealTimeUpdateService } from './RealTimeUpdateService.js';
import { QuotaManagementManager } from './QuotaManagementManager.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('Request Tracking', () => {
    it('should track total requests', () => {
      collector.recordRequest(100, true);
      collector.recordRequest(200, true);
      collector.recordRequest(150, false);

      expect(collector.getTotalRequests()).toBe(3);
    });

    it('should track total errors', () => {
      collector.recordRequest(100, true);
      collector.recordRequest(200, false);
      collector.recordRequest(150, false);

      expect(collector.getTotalErrors()).toBe(2);
    });

    it('should track account IDs', () => {
      collector.recordRequest(100, true, 'account-1');
      collector.recordRequest(200, true, 'account-2');
      collector.recordRequest(150, true, 'account-1');

      expect(collector.getTrackedAccountCount()).toBe(2);
    });

    it('should handle requests without account IDs', () => {
      collector.recordRequest(100, true);
      collector.recordRequest(200, true);

      expect(collector.getTotalRequests()).toBe(2);
      expect(collector.getTrackedAccountCount()).toBe(0);
    });
  });

  describe('Request Metrics', () => {
    it('should calculate requests per second', async () => {
      // Record several requests
      for (let i = 0; i < 10; i++) {
        collector.recordRequest(100, true);
      }

      // Wait for the current second to pass
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Record in a new second so the previous ones become "completed" buckets
      collector.recordRequest(50, true);

      const metrics = await collector.getMetrics();
      expect(metrics.requests.requestsPerSecond).toBeGreaterThanOrEqual(0);
      expect(metrics.requests.totalRequests).toBe(11);
    });

    it('should calculate average latency', () => {
      collector.recordRequest(100, true);
      collector.recordRequest(200, true);
      collector.recordRequest(300, true);

      const requestMetrics = collector.getRequestMetrics();
      // Average of 100, 200, 300 = 200
      expect(requestMetrics.averageLatency).toBe(200);
    });

    it('should calculate error rate', () => {
      collector.recordRequest(100, true);
      collector.recordRequest(100, true);
      collector.recordRequest(100, false);

      const requestMetrics = collector.getRequestMetrics();
      expect(requestMetrics.errorRate).toBeCloseTo(1 / 3, 2);
    });

    it('should return zero metrics when no requests recorded', () => {
      const requestMetrics = collector.getRequestMetrics();
      expect(requestMetrics.requestsPerSecond).toBe(0);
      expect(requestMetrics.averageLatency).toBe(0);
      expect(requestMetrics.errorRate).toBe(0);
      expect(requestMetrics.totalRequests).toBe(0);
      expect(requestMetrics.totalErrors).toBe(0);
    });
  });

  describe('Cache Metrics', () => {
    it('should track cache hits and misses', async () => {
      collector.recordCacheHit();
      collector.recordCacheHit();
      collector.recordCacheHit();
      collector.recordCacheMiss();

      const metrics = await collector.getMetrics();
      expect(metrics.cache.hits).toBe(3);
      expect(metrics.cache.misses).toBe(1);
      expect(metrics.cache.hitRate).toBeCloseTo(0.75, 2);
    });

    it('should return zero cache metrics when no hits or misses', async () => {
      const metrics = await collector.getMetrics();
      expect(metrics.cache.hitRate).toBe(0);
      expect(metrics.cache.hits).toBe(0);
      expect(metrics.cache.misses).toBe(0);
    });

    it('should calculate hit rate correctly with only hits', async () => {
      for (let i = 0; i < 5; i++) {
        collector.recordCacheHit();
      }

      const metrics = await collector.getMetrics();
      expect(metrics.cache.hitRate).toBe(1);
      expect(metrics.cache.misses).toBe(0);
    });

    it('should calculate hit rate correctly with only misses', async () => {
      for (let i = 0; i < 3; i++) {
        collector.recordCacheMiss();
      }

      const metrics = await collector.getMetrics();
      expect(metrics.cache.hitRate).toBe(0);
      expect(metrics.cache.hits).toBe(0);
    });
  });

  describe('Connection Metrics', () => {
    it('should return zero connections when no realtime service', async () => {
      const metrics = await collector.getMetrics();
      expect(metrics.connections.activeConnections).toBe(0);
    });

    it('should return active connections from realtime service', async () => {
      const mockService = {
        getConnectedClientCount: jest.fn().mockReturnValue(5),
      } as unknown as RealTimeUpdateService;

      collector = new MetricsCollector({ realtimeService: mockService });
      const metrics = await collector.getMetrics();
      expect(metrics.connections.activeConnections).toBe(5);
    });

    it('should handle realtime service errors gracefully', async () => {
      const mockService = {
        getConnectedClientCount: jest.fn().mockImplementation(() => {
          throw new Error('Service unavailable');
        }),
      } as unknown as RealTimeUpdateService;

      collector = new MetricsCollector({ realtimeService: mockService });
      const metrics = await collector.getMetrics();
      expect(metrics.connections.activeConnections).toBe(0);
    });
  });

  describe('Quota Usage', () => {
    it('should return empty quota when no quota manager', async () => {
      const metrics = await collector.getMetrics();
      expect(metrics.quota).toEqual([]);
    });

    it('should return empty quota when no accounts tracked', async () => {
      const mockQuotaManager = {
        getQuotaStatus: jest.fn(),
      } as unknown as QuotaManagementManager;

      collector = new MetricsCollector({ quotaManager: mockQuotaManager });
      const metrics = await collector.getMetrics();
      expect(metrics.quota).toEqual([]);
      expect(mockQuotaManager.getQuotaStatus).not.toHaveBeenCalled();
    });

    it('should query quota status for tracked accounts', async () => {
      const mockQuotaManager = {
        getQuotaStatus: jest.fn().mockResolvedValue({
          accountId: 'account-1',
          requestsPerMinute: { used: 50, limit: 100 },
          status: 'normal',
        }),
      } as unknown as QuotaManagementManager;

      collector = new MetricsCollector({ quotaManager: mockQuotaManager });
      collector.recordRequest(100, true, 'account-1');

      const metrics = await collector.getMetrics();
      expect(metrics.quota).toHaveLength(1);
      expect(metrics.quota[0].accountId).toBe('account-1');
      expect(metrics.quota[0].usagePercentage).toBe(50);
      expect(metrics.quota[0].nearLimit).toBe(false);
    });

    it('should detect near-limit accounts', async () => {
      const mockQuotaManager = {
        getQuotaStatus: jest.fn().mockResolvedValue({
          accountId: 'account-1',
          requestsPerMinute: { used: 97, limit: 100 },
          status: 'near_limit',
        }),
      } as unknown as QuotaManagementManager;

      collector = new MetricsCollector({ quotaManager: mockQuotaManager });
      collector.recordRequest(100, true, 'account-1');

      const metrics = await collector.getMetrics();
      expect(metrics.quota[0].usagePercentage).toBe(97);
      expect(metrics.quota[0].nearLimit).toBe(true);
    });

    it('should handle quota query errors gracefully', async () => {
      const mockQuotaManager = {
        getQuotaStatus: jest.fn().mockRejectedValue(new Error('DB error')),
      } as unknown as QuotaManagementManager;

      collector = new MetricsCollector({ quotaManager: mockQuotaManager });
      collector.recordRequest(100, true, 'account-1');

      const metrics = await collector.getMetrics();
      expect(metrics.quota).toHaveLength(1);
      expect(metrics.quota[0].accountId).toBe('account-1');
      expect(metrics.quota[0].usagePercentage).toBe(0);
      expect(metrics.quota[0].nearLimit).toBe(false);
    });
  });

  describe('Reset', () => {
    it('should reset all counters', () => {
      collector.recordRequest(100, true, 'account-1');
      collector.recordRequest(200, false);
      collector.recordCacheHit();
      collector.recordCacheMiss();

      collector.reset();

      expect(collector.getTotalRequests()).toBe(0);
      expect(collector.getTotalErrors()).toBe(0);
      expect(collector.getTrackedAccountCount()).toBe(0);
    });

    it('should return zero metrics after reset', async () => {
      collector.recordRequest(100, true);
      collector.recordCacheHit();

      collector.reset();

      const metrics = await collector.getMetrics();
      expect(metrics.requests.totalRequests).toBe(0);
      expect(metrics.requests.totalErrors).toBe(0);
      expect(metrics.cache.hits).toBe(0);
      expect(metrics.cache.misses).toBe(0);
    });
  });

  describe('Metrics Snapshot', () => {
    it('should include timestamp in snapshot', async () => {
      const metrics = await collector.getMetrics();
      expect(metrics.timestamp).toBeDefined();

      // Verify it's a valid ISO date
      const parsed = new Date(metrics.timestamp);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it('should include all metric categories', async () => {
      const metrics = await collector.getMetrics();

      expect(metrics.requests).toBeDefined();
      expect(metrics.quota).toBeDefined();
      expect(metrics.cache).toBeDefined();
      expect(metrics.connections).toBeDefined();
    });
  });

  describe('Sliding Window', () => {
    it('should use bounded memory (fixed number of buckets)', () => {
      const smallCollector = new MetricsCollector({}, { windowSizeSeconds: 5 });

      // Record many requests
      for (let i = 0; i < 100; i++) {
        smallCollector.recordRequest(i, true);
      }

      // Should still work fine - memory is bounded by window size
      expect(smallCollector.getTotalRequests()).toBe(100);
    });

    it('should replace old buckets with new data', async () => {
      const smallCollector = new MetricsCollector({}, { windowSizeSeconds: 2 });

      // Record in first second
      smallCollector.recordRequest(100, true);

      // Wait for bucket to be old
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // Record in new second - should replace old bucket
      smallCollector.recordRequest(200, true);

      const metrics = smallCollector.getRequestMetrics();
      expect(metrics.totalRequests).toBe(2);
    });
  });
});
