/**
 * Unit tests for UsageTrackingManager
 *
 * Tests core tracking functionality, cost calculation, error handling,
 * and event emission.
 */

import { UsageTrackingManager, TokenUsage, TrackingEvent } from './UsageTrackingManager.js';
import { TimeRange } from './TimeSeriesStorage.types.js';
import fs from 'fs';
import path from 'path';

describe('UsageTrackingManager', () => {
  let manager: UsageTrackingManager;
  let testDbPath: string;

  beforeEach(() => {
    // Create temporary database for testing
    testDbPath = path.join(__dirname, '../../test-data/test-usage-manager.db');

    // Ensure test directory exists
    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Clean up test database if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    manager = new UsageTrackingManager({ databasePath: testDbPath });
  });

  afterEach(() => {
    manager.close();
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('trackRequest', () => {
    it('should track a successful request with all token types', async () => {
      const event: TrackingEvent = {
        accountId: 'test-account',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 200,
          cacheReadTokens: 100,
        },
        latency: 1500,
        status: 'success',
        timestamp: new Date('2024-01-15T10:00:00Z'),
      };

      await manager.trackRequest(event);

      // Verify event was stored
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getAccountUsage('test-account', timeRange);
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTokens).toBe(1800); // 1000 + 500 + 200 + 100
    });

    it('should track a request with only input and output tokens', async () => {
      const event: TrackingEvent = {
        accountId: 'test-account',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-west-2',
        tokens: {
          inputTokens: 2000,
          outputTokens: 1000,
        },
        latency: 2000,
        status: 'success',
      };

      await manager.trackRequest(event);

      const timeRange: TimeRange = {
        start: new Date(Date.now() - 3600000),
        end: new Date(Date.now() + 3600000),
      };

      const stats = await manager.getAccountUsage('test-account', timeRange);
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTokens).toBe(3000);
    });

    it('should track an error request', async () => {
      const event: TrackingEvent = {
        accountId: 'test-account',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: {
          inputTokens: 500,
          outputTokens: 0,
        },
        latency: 500,
        status: 'error',
        errorCode: 'rate_limit_exceeded',
      };

      await manager.trackRequest(event);

      const timeRange: TimeRange = {
        start: new Date(Date.now() - 3600000),
        end: new Date(Date.now() + 3600000),
      };

      const stats = await manager.getAccountUsage('test-account', timeRange);
      expect(stats.totalRequests).toBe(1);
      expect(stats.successRate).toBe(0);
    });

    it('should emit usage_event when tracking succeeds', async () => {
      const eventListener = jest.fn();
      manager.on('usage_event', eventListener);

      const event: TrackingEvent = {
        accountId: 'test-account',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: {
          inputTokens: 1000,
          outputTokens: 500,
        },
        latency: 1000,
        status: 'success',
      };

      await manager.trackRequest(event);

      expect(eventListener).toHaveBeenCalledTimes(1);
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'test-account',
          model: 'claude-3-5-sonnet-20241022',
          inputTokens: 1000,
          outputTokens: 500,
        })
      );
    });

    it('should handle tracking failures gracefully', async () => {
      // Close storage to simulate failure
      manager.close();

      const event: TrackingEvent = {
        accountId: 'test-account',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: {
          inputTokens: 1000,
          outputTokens: 500,
        },
        latency: 1000,
        status: 'success',
      };

      // Should not throw
      await expect(manager.trackRequest(event)).resolves.toBeUndefined();

      // Should add to fallback queue
      expect(manager.getFallbackQueueSize()).toBeGreaterThan(0);
    });

    it('should emit tracking_error when tracking fails', async () => {
      const errorListener = jest.fn();
      manager.on('tracking_error', errorListener);

      // Close storage to simulate failure
      manager.close();

      const event: TrackingEvent = {
        accountId: 'test-account',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: {
          inputTokens: 1000,
          outputTokens: 500,
        },
        latency: 1000,
        status: 'success',
      };

      await manager.trackRequest(event);

      expect(errorListener).toHaveBeenCalledTimes(1);
      const callArgs = errorListener.mock.calls[0][0];
      expect(callArgs).toHaveProperty('error');
      expect(callArgs.error).toBeTruthy();
      expect(callArgs).toHaveProperty('event');
      expect(callArgs.event.accountId).toBe(event.accountId);
      expect(callArgs.event.model).toBe(event.model);
      expect(callArgs).toHaveProperty('timestamp');
      expect(typeof callArgs.timestamp).toBe('number');
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for input tokens only', () => {
      const tokens: TokenUsage = {
        inputTokens: 1_000_000,
        outputTokens: 0,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBe(15.0); // $15 per 1M tokens
    });

    it('should calculate cost for output tokens only', () => {
      const tokens: TokenUsage = {
        inputTokens: 0,
        outputTokens: 1_000_000,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBe(15.0); // $15 per 1M tokens
    });

    it('should calculate cost for cache creation tokens', () => {
      const tokens: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 1_000_000,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBe(15.0); // $15 per 1M tokens
    });

    it('should calculate cost for cache read tokens with 90% discount', () => {
      const tokens: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBe(1.5); // $1.50 per 1M tokens (90% discount)
    });

    it('should calculate cost for all token types combined', () => {
      const tokens: TokenUsage = {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBe(46.5); // 15 + 15 + 15 + 1.5
    });

    it('should calculate cost for fractional token counts', () => {
      const tokens: TokenUsage = {
        inputTokens: 500_000,
        outputTokens: 250_000,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBe(11.25); // (500k / 1M * 15) + (250k / 1M * 15)
    });

    it('should handle small token counts accurately', () => {
      const tokens: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBeCloseTo(0.0225, 4); // (1000 / 1M * 15) + (500 / 1M * 15)
    });

    it('should handle zero tokens', () => {
      const tokens: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
      };

      const cost = manager.calculateCost(tokens);
      expect(cost).toBe(0);
    });
  });

  describe('getAccountUsage', () => {
    beforeEach(async () => {
      // Add test data
      await manager.trackRequest({
        accountId: 'account-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: { inputTokens: 1000, outputTokens: 500 },
        latency: 1000,
        status: 'success',
        timestamp: new Date('2024-01-15T10:00:00Z'),
      });

      await manager.trackRequest({
        accountId: 'account-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-west-2',
        tokens: { inputTokens: 2000, outputTokens: 1000 },
        latency: 1500,
        status: 'success',
        timestamp: new Date('2024-01-15T11:00:00Z'),
      });

      await manager.trackRequest({
        accountId: 'account-2',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: { inputTokens: 500, outputTokens: 250 },
        latency: 800,
        status: 'success',
        timestamp: new Date('2024-01-15T10:30:00Z'),
      });
    });

    it('should return usage stats for a specific account', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getAccountUsage('account-1', timeRange);

      expect(stats.totalRequests).toBe(2);
      expect(stats.totalTokens).toBe(4500); // (1000+500) + (2000+1000)
      expect(stats.averageLatency).toBe(1250); // (1000 + 1500) / 2
      expect(stats.successRate).toBe(1);
    });

    it('should return breakdown by model', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getAccountUsage('account-1', timeRange);

      expect(stats.breakdown.byModel['claude-3-5-sonnet-20241022']).toBeDefined();
      expect(stats.breakdown.byModel['claude-3-5-sonnet-20241022'].requests).toBe(2);
    });

    it('should return breakdown by region', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getAccountUsage('account-1', timeRange);

      expect(stats.breakdown.byRegion['us-east-1']).toBeDefined();
      expect(stats.breakdown.byRegion['us-west-2']).toBeDefined();
      expect(stats.breakdown.byRegion['us-east-1'].requests).toBe(1);
      expect(stats.breakdown.byRegion['us-west-2'].requests).toBe(1);
    });

    it('should return empty stats for account with no usage', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getAccountUsage('nonexistent', timeRange);

      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
    });
  });

  describe('getTotalUsage', () => {
    beforeEach(async () => {
      // Add test data for multiple accounts
      await manager.trackRequest({
        accountId: 'account-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: { inputTokens: 1000, outputTokens: 500 },
        latency: 1000,
        status: 'success',
        timestamp: new Date('2024-01-15T10:00:00Z'),
      });

      await manager.trackRequest({
        accountId: 'account-2',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-west-2',
        tokens: { inputTokens: 2000, outputTokens: 1000 },
        latency: 1500,
        status: 'success',
        timestamp: new Date('2024-01-15T11:00:00Z'),
      });
    });

    it('should return total usage across all accounts', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getTotalUsage(timeRange);

      expect(stats.totalRequests).toBe(2);
      expect(stats.totalTokens).toBe(4500); // (1000+500) + (2000+1000)
    });
  });

  describe('getUsageByModel', () => {
    beforeEach(async () => {
      await manager.trackRequest({
        accountId: 'account-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: { inputTokens: 1000, outputTokens: 500 },
        latency: 1000,
        status: 'success',
        timestamp: new Date('2024-01-15T10:00:00Z'),
      });

      await manager.trackRequest({
        accountId: 'account-1',
        model: 'claude-3-opus-20240229',
        region: 'us-east-1',
        tokens: { inputTokens: 2000, outputTokens: 1000 },
        latency: 1500,
        status: 'success',
        timestamp: new Date('2024-01-15T11:00:00Z'),
      });
    });

    it('should return usage stats for a specific model', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getUsageByModel('claude-3-5-sonnet-20241022', timeRange);

      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTokens).toBe(1500);
    });

    it('should return empty stats for model with no usage', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getUsageByModel('nonexistent-model', timeRange);

      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('getUsageByRegion', () => {
    beforeEach(async () => {
      await manager.trackRequest({
        accountId: 'account-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        tokens: { inputTokens: 1000, outputTokens: 500 },
        latency: 1000,
        status: 'success',
        timestamp: new Date('2024-01-15T10:00:00Z'),
      });

      await manager.trackRequest({
        accountId: 'account-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-west-2',
        tokens: { inputTokens: 2000, outputTokens: 1000 },
        latency: 1500,
        status: 'success',
        timestamp: new Date('2024-01-15T11:00:00Z'),
      });
    });

    it('should return usage stats for a specific region', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getUsageByRegion('us-east-1', timeRange);

      expect(stats.totalRequests).toBe(1);
      expect(stats.totalTokens).toBe(1500);
    });

    it('should return empty stats for region with no usage', async () => {
      const timeRange: TimeRange = {
        start: new Date('2024-01-15T00:00:00Z'),
        end: new Date('2024-01-15T23:59:59Z'),
      };

      const stats = await manager.getUsageByRegion('eu-west-1', timeRange);

      expect(stats.totalRequests).toBe(0);
    });
  });
});
