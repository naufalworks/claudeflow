/**
 * Unit tests for AnalyticsEngine
 */

import { AnalyticsEngine, RequestMetadata } from '../analytics-engine';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';

describe('AnalyticsEngine', () => {
  let redis: Redis;
  let analyticsEngine: AnalyticsEngine;

  beforeEach(() => {
    redis = new RedisMock() as Redis;
    analyticsEngine = new AnalyticsEngine(redis);
  });

  afterEach(async () => {
    await redis.flushall();
    redis.disconnect();
  });

  describe('trackRequest', () => {
    it('should store request metadata in Redis', async () => {
      const metadata: RequestMetadata = {
        requestId: 'req_001',
        timestamp: new Date('2026-05-02T07:00:00Z'),
        model: 'claude-sonnet-4-20250514',
        complexity: 'moderate',
        accountId: 'acc_001',
        accountType: 'anthropic',
        provider: 'anthropic',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 800,
        thinkingTokens: 100,
        responseTimeMs: 1500,
        cacheHit: true,
        deduplicated: false,
        cacheOptimized: true,
        thinkingOptimized: true,
        contextOptimized: false,
      };

      await analyticsEngine.trackRequest(metadata);

      // Verify data stored in Redis
      const stored = await redis.get('analytics:request:req_001');
      expect(stored).toBeTruthy();
      
      const parsed = JSON.parse(stored!);
      expect(parsed.requestId).toBe('req_001');
      expect(parsed.model).toBe('claude-sonnet-4-20250514');
      expect(parsed.inputTokens).toBe(1000);
    });

    it('should add request to index sorted set', async () => {
      const metadata: RequestMetadata = {
        requestId: 'req_002',
        timestamp: new Date('2026-05-02T08:00:00Z'),
        model: 'claude-sonnet-4-20250514',
        complexity: 'simple',
        accountId: 'acc_001',
        accountType: 'kiro',
        provider: 'kiro',
        inputTokens: 500,
        outputTokens: 200,
        responseTimeMs: 1000,
        cacheHit: false,
        deduplicated: false,
        cacheOptimized: false,
        thinkingOptimized: false,
        contextOptimized: false,
      };

      await analyticsEngine.trackRequest(metadata);

      // Verify added to index
      const members = await redis.zrange('analytics:index', 0, -1);
      expect(members).toContain('req_002');
    });

    it('should set TTL on stored data', async () => {
      const metadata: RequestMetadata = {
        requestId: 'req_003',
        timestamp: new Date(),
        model: 'claude-sonnet-4-20250514',
        complexity: 'complex',
        accountId: 'acc_001',
        accountType: 'anthropic',
        provider: 'anthropic',
        inputTokens: 2000,
        outputTokens: 1000,
        responseTimeMs: 3000,
        cacheHit: false,
        deduplicated: false,
        cacheOptimized: true,
        thinkingOptimized: true,
        contextOptimized: true,
      };

      await analyticsEngine.trackRequest(metadata);

      // Verify TTL is set (7 days = 604800 seconds)
      const ttl = await redis.ttl('analytics:request:req_003');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(604800);
    });

    it('should not throw on Redis errors', async () => {
      // Disconnect Redis to simulate error
      redis.disconnect();

      const metadata: RequestMetadata = {
        requestId: 'req_004',
        timestamp: new Date(),
        model: 'claude-sonnet-4-20250514',
        complexity: 'simple',
        accountId: 'acc_001',
        accountType: 'kiro',
        provider: 'kiro',
        inputTokens: 100,
        outputTokens: 50,
        responseTimeMs: 500,
        cacheHit: false,
        deduplicated: false,
        cacheOptimized: false,
        thinkingOptimized: false,
        contextOptimized: false,
      };

      // Should not throw
      await expect(analyticsEngine.trackRequest(metadata)).resolves.not.toThrow();
    });
  });

  describe('getMetrics', () => {
    beforeEach(async () => {
      // Add sample data
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_101',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'kiro_001',
          accountType: 'kiro',
          provider: 'kiro',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_102',
          timestamp: new Date('2026-05-02T06:30:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'moderate',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 200,
          cacheReadTokens: 800,
          thinkingTokens: 100,
          responseTimeMs: 2000,
          cacheHit: true,
          deduplicated: false,
          cacheOptimized: true,
          thinkingOptimized: true,
          contextOptimized: false,
        },
        {
          requestId: 'req_103',
          timestamp: new Date('2026-05-02T07:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'complex',
          accountId: 'acc_002',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 1500,
          thinkingTokens: 500,
          responseTimeMs: 3000,
          cacheHit: true,
          deduplicated: true,
          cacheOptimized: true,
          thinkingOptimized: true,
          contextOptimized: true,
        },
        {
          requestId: 'req_104',
          timestamp: new Date('2026-05-02T07:30:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 300,
          outputTokens: 150,
          responseTimeMs: 800,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
          error: true,
          errorType: 'rate_limit',
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }
    });

    it('should aggregate metrics correctly', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
      });

      expect(metrics.totalRequests).toBe(4);
      expect(metrics.successfulRequests).toBe(3);
      expect(metrics.failedRequests).toBe(1);
      expect(metrics.totalInputTokens).toBe(3800);
      expect(metrics.totalOutputTokens).toBe(1850);
    });

    it('should calculate cache hit rate correctly', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
      });

      // 2 cache hits out of 4 requests = 0.5
      expect(metrics.cacheHitRate).toBe(0.5);
    });

    it('should calculate deduplication rate correctly', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
      });

      // 1 deduplicated out of 4 requests = 0.25
      expect(metrics.deduplicationRate).toBe(0.25);
    });

    it('should calculate Kiro percentage correctly', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
      });

      // 1 Kiro request out of 4 = 25%
      expect(metrics.kiroPercentage).toBe(25);
      expect(metrics.kiroRequests).toBe(1);
      expect(metrics.anthropicRequests).toBe(3);
    });

    it('should calculate error rate correctly', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
      });

      // 1 error out of 4 requests = 0.25
      expect(metrics.errorRate).toBe(0.25);
      expect(metrics.errorsByType).toEqual({ rate_limit: 1 });
    });

    it('should calculate response time percentiles correctly', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
      });

      // Response times: [800, 1000, 2000, 3000]
      expect(metrics.p50ResponseTime).toBe(1000);
      expect(metrics.p95ResponseTime).toBe(3000);
      expect(metrics.p99ResponseTime).toBe(3000);
      expect(metrics.averageResponseTime).toBe(1700);
    });

    it('should filter by model', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
        model: 'claude-sonnet-4-20250514',
      });

      expect(metrics.totalRequests).toBe(4);
    });

    it('should filter by complexity', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
        complexity: 'simple',
      });

      expect(metrics.totalRequests).toBe(2);
    });

    it('should filter by account type', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
        accountType: 'kiro',
      });

      expect(metrics.totalRequests).toBe(1);
      expect(metrics.kiroRequests).toBe(1);
    });

    it('should return empty metrics when no data', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-01T00:00:00Z'),
        endTime: new Date('2026-05-01T01:00:00Z'),
      });

      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalCost).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
    });

    it('should calculate cost correctly', async () => {
      const metrics = await analyticsEngine.getMetrics({
        startTime: new Date('2026-05-02T06:00:00Z'),
        endTime: new Date('2026-05-02T08:00:00Z'),
      });

      // Input: 3800 tokens * $3/M = $0.0114
      // Output: 1850 tokens * $15/M = $0.02775
      // Cache creation: 200 tokens * $3.75/M = $0.00075
      // Cache read: 2300 tokens * $0.30/M = $0.00069
      // Total ≈ $0.04059
      expect(metrics.totalCost).toBeCloseTo(0.04059, 4);
    });
  });

  describe('generateInsights', () => {
    beforeEach(async () => {
      // Add sample data for insights
      const requests: RequestMetadata[] = [];
      
      // Create 100 requests with various patterns
      for (let i = 0; i < 100; i++) {
        requests.push({
          requestId: `req_${i}`,
          timestamp: new Date(`2026-05-02T${String(Math.floor(i / 10)).padStart(2, '0')}:${String((i % 10) * 6).padStart(2, '0')}:00Z`),
          model: 'claude-sonnet-4-20250514',
          complexity: i < 60 ? 'simple' : i < 90 ? 'moderate' : 'complex',
          accountId: i < 20 ? 'kiro_001' : 'acc_001',
          accountType: i < 20 ? 'kiro' : 'anthropic',
          provider: i < 20 ? 'kiro' : 'anthropic',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: i < 50 ? 800 : 0,
          responseTimeMs: i < 90 ? 2000 : 8000,
          cacheHit: i < 50,
          deduplicated: i >= 50 && i < 60,
          cacheOptimized: true,
          thinkingOptimized: true,
          contextOptimized: false,
          error: i >= 94, // 6 errors (94-99) = 6% error rate
          errorType: i >= 94 ? 'timeout' : undefined,
        });
      }

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }
    });

    it('should generate low Kiro usage insight', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-02T00:00:00Z'),
        endTime: new Date('2026-05-02T23:59:59Z'),
      });

      // 20% Kiro usage (20 out of 100) - should trigger warning
      const kiroInsight = insights.find(i => i.title === 'Low Kiro Account Usage');
      expect(kiroInsight).toBeDefined();
      expect(kiroInsight?.type).toBe('cost_optimization');
      expect(kiroInsight?.severity).toBe('warning');
      expect(kiroInsight?.metrics?.kiroPercentage).toBe(20);
    });

    it('should generate low cache hit rate insight', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-02T00:00:00Z'),
        endTime: new Date('2026-05-02T23:59:59Z'),
      });

      const cacheInsight = insights.find(i => i.title === 'Low Cache Hit Rate');
      expect(cacheInsight).toBeDefined();
      expect(cacheInsight?.type).toBe('cost_optimization');
      expect(cacheInsight?.severity).toBe('warning');
    });

    it('should generate high error rate insight', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-02T00:00:00Z'),
        endTime: new Date('2026-05-02T23:59:59Z'),
      });

      // 6% error rate (6 out of 100) - above threshold, should trigger warning
      const errorInsight = insights.find(i => i.title === 'High Error Rate');
      expect(errorInsight).toBeDefined();
      expect(errorInsight?.type).toBe('reliability');
      expect(errorInsight?.severity).toBe('warning');
      expect(errorInsight?.metrics?.errorRate).toBe(0.06);
    });

    it('should generate slow response time insight', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-02T00:00:00Z'),
        endTime: new Date('2026-05-02T23:59:59Z'),
      });

      const perfInsight = insights.find(i => i.title === 'Slow Response Times');
      expect(perfInsight).toBeDefined();
      expect(perfInsight?.type).toBe('performance');
      expect(perfInsight?.severity).toBe('warning');
    });

    it('should generate low deduplication insight', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-02T00:00:00Z'),
        endTime: new Date('2026-05-02T23:59:59Z'),
      });

      // 10% deduplication rate (10 out of 100) - should generate info insight
      const dedupInsight = insights.find(i => i.title === 'Low Semantic Deduplication');
      expect(dedupInsight).toBeDefined();
      expect(dedupInsight?.type).toBe('cost_optimization');
      expect(dedupInsight?.severity).toBe('info');
      expect(dedupInsight?.metrics?.deduplicationRate).toBe(0.1);
    });

    it('should sort insights by severity', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-02T00:00:00Z'),
        endTime: new Date('2026-05-02T23:59:59Z'),
      });

      // Critical should come first, then warning, then info
      const severities = insights.map(i => i.severity);
      const criticalIndex = severities.indexOf('critical');
      const warningIndex = severities.indexOf('warning');
      const infoIndex = severities.indexOf('info');

      if (criticalIndex !== -1 && warningIndex !== -1) {
        expect(criticalIndex).toBeLessThan(warningIndex);
      }
      if (warningIndex !== -1 && infoIndex !== -1) {
        expect(warningIndex).toBeLessThan(infoIndex);
      }
    });

    it('should include metrics in insights', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-02T00:00:00Z'),
        endTime: new Date('2026-05-02T23:59:59Z'),
      });

      const insightWithMetrics = insights.find(i => i.metrics);
      expect(insightWithMetrics).toBeDefined();
      expect(insightWithMetrics?.metrics).toBeDefined();
    });

    it('should return empty array when no data', async () => {
      const insights = await analyticsEngine.generateInsights({
        startTime: new Date('2026-05-01T00:00:00Z'),
        endTime: new Date('2026-05-01T01:00:00Z'),
      });

      expect(insights).toEqual([]);
    });
  });
});
