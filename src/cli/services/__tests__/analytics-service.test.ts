/**
 * AnalyticsService Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AnalyticsService } from '../analytics-service.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await mkdtemp(join(tmpdir(), 'claudeflow-test-'));
    analyticsService = new AnalyticsService(tempDir);
    await analyticsService.initialize();
  });

  afterEach(async () => {
    // Close database connection
    await analyticsService.close();

    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create analytics database', async () => {
      const dbPath = join(tempDir, 'analytics.db');
      expect(existsSync(dbPath)).toBe(true);
    });

    it('should create requests table with indexes', async () => {
      // Insert a test record to verify table exists
      await analyticsService.recordRequest({
        accountId: 'test-account',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'simple',
        tokens: 100,
        cost: 0.001,
        duration: 500,
        cacheHit: false,
      });

      const metrics = await analyticsService.getMetrics('24h');
      expect(metrics.totalRequests).toBe(1);
    });
  });

  describe('recordRequest', () => {
    it('should record request successfully', async () => {
      await analyticsService.recordRequest({
        accountId: 'test-account',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'simple',
        tokens: 100,
        cost: 0.001,
        duration: 500,
        cacheHit: false,
      });

      const metrics = await analyticsService.getMetrics('24h');
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.totalTokens).toBe(100);
      expect(metrics.totalCost).toBeCloseTo(0.001, 6);
    });

    it('should record request with error', async () => {
      await analyticsService.recordRequest({
        accountId: 'test-account',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'simple',
        tokens: 0,
        cost: 0,
        duration: 100,
        cacheHit: false,
        error: 'Rate limit exceeded',
      });

      const metrics = await analyticsService.getMetrics('24h');
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.errorRate).toBeCloseTo(1.0, 2);
    });

    it('should record cache hit', async () => {
      await analyticsService.recordRequest({
        accountId: 'test-account',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'simple',
        tokens: 100,
        cost: 0.0005,
        duration: 200,
        cacheHit: true,
      });

      const metrics = await analyticsService.getMetrics('24h');
      expect(metrics.cacheHitRate).toBeCloseTo(1.0, 2);
    });
  });

  describe('getMetrics', () => {
    beforeEach(async () => {
      // Insert test data
      const now = Date.now();
      
      // Recent requests (within 24h)
      for (let i = 0; i < 5; i++) {
        await analyticsService.recordRequest({
          accountId: `account-${i % 2}`,
          accountType: 'single',
          model: 'claude-3-5-sonnet-20241022',
          complexity: i % 2 === 0 ? 'simple' : 'complex',
          tokens: 100 + i * 10,
          cost: 0.001 + i * 0.0001,
          duration: 500 + i * 50,
          cacheHit: i % 3 === 0,
        });
      }
    });

    it('should get metrics for 24h range', async () => {
      const metrics = await analyticsService.getMetrics('24h');

      expect(metrics.totalRequests).toBe(5);
      expect(metrics.totalTokens).toBe(600); // 100+110+120+130+140
      expect(metrics.totalCost).toBeCloseTo(0.006, 6); // 0.001+0.0011+0.0012+0.0013+0.0014
      expect(metrics.avgResponseTime).toBeGreaterThan(0);
      expect(metrics.cacheHitRate).toBeCloseTo(0.4, 2); // 2 out of 5
      expect(metrics.errorRate).toBe(0);
    });

    it('should get metrics for 7d range', async () => {
      const metrics = await analyticsService.getMetrics('7d');

      expect(metrics.totalRequests).toBe(5);
    });

    it('should get metrics for 30d range', async () => {
      const metrics = await analyticsService.getMetrics('30d');

      expect(metrics.totalRequests).toBe(5);
    });

    it('should return zero metrics for empty database', async () => {
      // Create new service with empty database
      const emptyDir = await mkdtemp(join(tmpdir(), 'claudeflow-empty-'));
      const emptyService = new AnalyticsService(emptyDir);
      await emptyService.initialize();

      const metrics = await emptyService.getMetrics('24h');

      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalTokens).toBe(0);
      expect(metrics.totalCost).toBe(0);
      expect(metrics.avgResponseTime).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.errorRate).toBe(0);

      await emptyService.close();
      await rm(emptyDir, { recursive: true, force: true });
    });
  });

  describe('getDetailedMetrics', () => {
    beforeEach(async () => {
      // Insert test data with different models and complexities
      await analyticsService.recordRequest({
        accountId: 'account-1',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'simple',
        tokens: 100,
        cost: 0.001,
        duration: 500,
        cacheHit: false,
      });

      await analyticsService.recordRequest({
        accountId: 'account-1',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'complex',
        tokens: 200,
        cost: 0.002,
        duration: 1000,
        cacheHit: true,
      });

      await analyticsService.recordRequest({
        accountId: 'account-2',
        accountType: 'combo',
        model: 'claude-3-opus-20240229',
        complexity: 'simple',
        tokens: 150,
        cost: 0.0015,
        duration: 750,
        cacheHit: false,
      });
    });

    it('should get detailed metrics with breakdowns', async () => {
      const detailed = await analyticsService.getDetailedMetrics('24h');

      expect(detailed.summary.totalRequests).toBe(3);
      expect(detailed.byModel).toBeDefined();
      expect(detailed.byComplexity).toBeDefined();
      expect(detailed.byAccount).toBeDefined();
      expect(detailed.hourlyBreakdown).toBeDefined();
    });

    it('should break down metrics by model', async () => {
      const detailed = await analyticsService.getDetailedMetrics('24h');

      expect(detailed.byModel['claude-3-5-sonnet-20241022']).toBeDefined();
      expect(detailed.byModel['claude-3-5-sonnet-20241022'].requests).toBe(2);
      expect(detailed.byModel['claude-3-opus-20240229']).toBeDefined();
      expect(detailed.byModel['claude-3-opus-20240229'].requests).toBe(1);
    });

    it('should break down metrics by complexity', async () => {
      const detailed = await analyticsService.getDetailedMetrics('24h');

      expect(detailed.byComplexity['simple']).toBeDefined();
      expect(detailed.byComplexity['simple'].requests).toBe(2);
      expect(detailed.byComplexity['complex']).toBeDefined();
      expect(detailed.byComplexity['complex'].requests).toBe(1);
    });

    it('should break down metrics by account', async () => {
      const detailed = await analyticsService.getDetailedMetrics('24h');

      expect(detailed.byAccount['account-1']).toBeDefined();
      expect(detailed.byAccount['account-1'].requests).toBe(2);
      expect(detailed.byAccount['account-2']).toBeDefined();
      expect(detailed.byAccount['account-2'].requests).toBe(1);
    });

    it('should include top accounts', async () => {
      const detailed = await analyticsService.getDetailedMetrics('24h');

      expect(detailed.topAccounts).toBeDefined();
      expect(detailed.topAccounts.length).toBeGreaterThan(0);
      expect(detailed.topAccounts[0].accountId).toBe('account-1');
      expect(detailed.topAccounts[0].requests).toBe(2);
    });
  });

  describe('generateInsights', () => {
    beforeEach(async () => {
      // Insert test data for insights
      for (let i = 0; i < 10; i++) {
        await analyticsService.recordRequest({
          accountId: 'account-1',
          accountType: 'single',
          model: 'claude-3-5-sonnet-20241022',
          complexity: 'simple',
          tokens: 100,
          cost: 0.001,
          duration: 500,
          cacheHit: i % 2 === 0,
        });
      }
    });

    it('should generate insights from metrics', async () => {
      const insights = await analyticsService.generateInsights('24h');

      expect(insights).toBeDefined();
      expect(insights.length).toBeGreaterThan(0);
      expect(insights[0]).toHaveProperty('type');
      expect(insights[0]).toHaveProperty('message');
    });

    it('should identify high cache hit rate', async () => {
      const insights = await analyticsService.generateInsights('24h');

      const cacheInsight = insights.find(i => i.type === 'cache');
      expect(cacheInsight).toBeDefined();
      expect(cacheInsight?.message).toContain('cache hit rate');
    });

    it('should identify cost patterns', async () => {
      const insights = await analyticsService.generateInsights('24h');

      const costInsight = insights.find(i => i.type === 'cost');
      expect(costInsight).toBeDefined();
    });
  });

  describe('exportToJSON', () => {
    beforeEach(async () => {
      await analyticsService.recordRequest({
        accountId: 'test-account',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'simple',
        tokens: 100,
        cost: 0.001,
        duration: 500,
        cacheHit: false,
      });
    });

    it('should export data to JSON', async () => {
      const json = await analyticsService.exportToJSON('24h');

      expect(json).toBeDefined();
      const data = JSON.parse(json);
      expect(data.metrics).toBeDefined();
      expect(data.detailed).toBeDefined();
      expect(data.insights).toBeDefined();
      expect(data.exportedAt).toBeDefined();
    });
  });

  describe('exportToCSV', () => {
    beforeEach(async () => {
      await analyticsService.recordRequest({
        accountId: 'test-account',
        accountType: 'single',
        model: 'claude-3-5-sonnet-20241022',
        complexity: 'simple',
        tokens: 100,
        cost: 0.001,
        duration: 500,
        cacheHit: false,
      });
    });

    it('should export data to CSV', async () => {
      const csv = await analyticsService.exportToCSV('24h');

      expect(csv).toBeDefined();
      expect(csv).toContain('timestamp,account_id,account_type,model,complexity,tokens,cost,duration,cache_hit,error');
      expect(csv).toContain('test-account');
      expect(csv).toContain('claude-3-5-sonnet-20241022');
    });

    it('should handle empty data', async () => {
      // Create new service with empty database
      const emptyDir = await mkdtemp(join(tmpdir(), 'claudeflow-empty-'));
      const emptyService = new AnalyticsService(emptyDir);
      await emptyService.initialize();

      const csv = await emptyService.exportToCSV('24h');

      expect(csv).toBeDefined();
      expect(csv).toContain('timestamp,account_id,account_type,model,complexity,tokens,cost,duration,cache_hit,error');

      await emptyService.close();
      await rm(emptyDir, { recursive: true, force: true });
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      await expect(analyticsService.close()).resolves.not.toThrow();
    });
  });
});
