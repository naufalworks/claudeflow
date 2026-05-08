/**
 * Tests for Background Job Scheduler
 *
 * Tests aggregation correctness, idempotency, error handling, and job locking.
 */

import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { BackgroundJobScheduler } from './BackgroundJobScheduler.js';
import { UsageEvent } from './TimeSeriesStorage.types.js';
import fs from 'fs';
import path from 'path';

describe('BackgroundJobScheduler', () => {
  let storage: TimeSeriesStorage;
  let scheduler: BackgroundJobScheduler;
  let testDbPath: string;

  beforeEach(() => {
    // Create test database
    testDbPath = path.join(__dirname, `test-scheduler-${Date.now()}.db`);
    storage = new TimeSeriesStorage({ databasePath: testDbPath });
    scheduler = new BackgroundJobScheduler(storage, {
      enabled: false, // Don't auto-start cron jobs in tests
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    storage.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Hourly Aggregation', () => {
    it('should aggregate events from previous hour correctly', async () => {
      // Insert test events for previous hour
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      const events: UsageEvent[] = [
        {
          timestamp: previousHourStart + 1000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.00225,
          latency: 1000,
          status: 'success',
        },
        {
          timestamp: previousHourStart + 2000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.0045,
          latency: 1500,
          status: 'success',
        },
        {
          timestamp: previousHourStart + 3000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 150,
          outputTokens: 75,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.003375,
          latency: 1200,
          status: 'error',
          errorCode: 'rate_limit',
        },
      ];

      for (const event of events) {
        storage.insertEvent(event);
      }

      // Run hourly aggregation
      const result = await scheduler.triggerJob('hourly-aggregation');

      expect(result.success).toBe(true);
      expect('recordsProcessed' in result).toBe(true);
      if ('recordsProcessed' in result) {
        expect(result.recordsProcessed).toBe(3);
        expect(result.aggregationsCreated).toBe(1);
        expect(result.errors).toEqual([]);
      }

      // Verify aggregation data
      const aggs = storage
        .getDatabase()
        .prepare(
          'SELECT * FROM usage_hourly WHERE hour_timestamp = ? AND account_id = ?'
        )
        .all(previousHourStart, 'account1');

      expect(aggs).toHaveLength(1);
      const agg = aggs[0] as any;

      expect(agg.request_count).toBe(3);
      expect(agg.total_tokens).toBe(675); // 100+50 + 200+100 + 150+75
      expect(agg.total_cost).toBeCloseTo(0.010125, 6);
      expect(agg.avg_latency).toBeCloseTo(1233.33, 2); // (1000+1500+1200)/3
      expect(agg.success_count).toBe(2);
      expect(agg.error_count).toBe(1);
    });

    it('should handle multiple accounts, models, and regions', async () => {
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      const events: UsageEvent[] = [
        {
          timestamp: previousHourStart + 1000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.00225,
          latency: 1000,
          status: 'success',
        },
        {
          timestamp: previousHourStart + 2000,
          accountId: 'account2',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-west-2',
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.0045,
          latency: 1500,
          status: 'success',
        },
        {
          timestamp: previousHourStart + 3000,
          accountId: 'account1',
          model: 'claude-3-opus-20240229',
          region: 'us-east-1',
          inputTokens: 150,
          outputTokens: 75,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.003375,
          latency: 1200,
          status: 'success',
        },
      ];

      for (const event of events) {
        storage.insertEvent(event);
      }

      const result = await scheduler.triggerJob('hourly-aggregation');

      expect(result.success).toBe(true);
      expect('recordsProcessed' in result).toBe(true);
      if ('recordsProcessed' in result) {
        expect(result.recordsProcessed).toBe(3);
        expect(result.aggregationsCreated).toBe(3); // 3 unique combinations
      }

      // Verify all aggregations created
      const aggs = storage
        .getDatabase()
        .prepare('SELECT * FROM usage_hourly WHERE hour_timestamp = ?')
        .all(previousHourStart);

      expect(aggs).toHaveLength(3);
    });

    it('should be idempotent (running twice produces same result)', async () => {
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      const events: UsageEvent[] = [
        {
          timestamp: previousHourStart + 1000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.00225,
          latency: 1000,
          status: 'success',
        },
      ];

      for (const event of events) {
        storage.insertEvent(event);
      }

      // Run aggregation twice
      const result1 = await scheduler.triggerJob('hourly-aggregation');
      const result2 = await scheduler.triggerJob('hourly-aggregation');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Verify only one aggregation exists
      const aggs = storage
        .getDatabase()
        .prepare('SELECT * FROM usage_hourly WHERE hour_timestamp = ?')
        .all(previousHourStart);

      expect(aggs).toHaveLength(1);

      const agg = aggs[0] as any;
      expect(agg.request_count).toBe(1);
      expect(agg.total_tokens).toBe(150);
    });

    it('should handle empty event set gracefully', async () => {
      const result = await scheduler.triggerJob('hourly-aggregation');

      expect(result.success).toBe(true);
      expect('recordsProcessed' in result).toBe(true);
      if ('recordsProcessed' in result) {
        expect(result.recordsProcessed).toBe(0);
        expect(result.aggregationsCreated).toBe(0);
        expect(result.errors).toEqual([]);
      }
    });

    it('should handle events with cache tokens', async () => {
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      const events: UsageEvent[] = [
        {
          timestamp: previousHourStart + 1000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 200,
          cacheReadTokens: 300,
          cost: 0.00225,
          latency: 1000,
          status: 'success',
        },
      ];

      for (const event of events) {
        storage.insertEvent(event);
      }

      const result = await scheduler.triggerJob('hourly-aggregation');

      expect(result.success).toBe(true);

      const aggs = storage
        .getDatabase()
        .prepare('SELECT * FROM usage_hourly WHERE hour_timestamp = ?')
        .all(previousHourStart);

      const agg = aggs[0] as any;
      expect(agg.total_tokens).toBe(650); // 100+50+200+300
    });

    it('should validate event data and skip invalid events', async () => {
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      // Insert valid event
      storage.insertEvent({
        timestamp: previousHourStart + 1000,
        accountId: 'account1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.00225,
        latency: 1000,
        status: 'success',
      });

      // Manually insert invalid event (missing accountId)
      storage
        .getDatabase()
        .prepare(
          `INSERT INTO usage_events (timestamp, account_id, model, region, input_tokens, output_tokens, cost, latency, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(previousHourStart + 2000, '', 'model', 'region', 100, 50, 0.00225, 1000, 'success');

      const result = await scheduler.triggerJob('hourly-aggregation');

      expect(result.success).toBe(true);
      expect('recordsProcessed' in result).toBe(true);
      if ('recordsProcessed' in result) {
        expect(result.recordsProcessed).toBe(2);
        expect(result.aggregationsCreated).toBe(1); // Only valid event aggregated
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Daily Aggregation', () => {
    it('should aggregate events from previous day correctly', async () => {
      // Calculate previous day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const dayStart = yesterday.getTime();
      const dateString = yesterday.toISOString().split('T')[0];

      const events: UsageEvent[] = [
        {
          timestamp: dayStart + 1000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.00225,
          latency: 1000,
          status: 'success',
        },
        {
          timestamp: dayStart + 2000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.0045,
          latency: 1500,
          status: 'success',
        },
        {
          timestamp: dayStart + 3000,
          accountId: 'account2',
          model: 'claude-3-opus-20240229',
          region: 'us-west-2',
          inputTokens: 150,
          outputTokens: 75,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.003375,
          latency: 1200,
          status: 'success',
        },
      ];

      for (const event of events) {
        storage.insertEvent(event);
      }

      const result = await scheduler.triggerJob('daily-aggregation');

      expect(result.success).toBe(true);
      expect('recordsProcessed' in result).toBe(true);
      if ('recordsProcessed' in result) {
        expect(result.recordsProcessed).toBe(3);
        expect(result.aggregationsCreated).toBe(2); // 2 accounts
      }

      // Verify aggregation data
      const aggs = storage
        .getDatabase()
        .prepare('SELECT * FROM usage_daily WHERE date = ?')
        .all(dateString);

      expect(aggs).toHaveLength(2);

      const account1Agg = aggs.find((a: any) => a.account_id === 'account1') as any;
      expect(account1Agg.total_requests).toBe(2);
      expect(account1Agg.total_tokens).toBe(450); // 100+50 + 200+100
      expect(account1Agg.total_cost).toBeCloseTo(0.00675, 6);

      const account2Agg = aggs.find((a: any) => a.account_id === 'account2') as any;
      expect(account2Agg.total_requests).toBe(1);
      expect(account2Agg.total_tokens).toBe(225); // 150+75
      expect(account2Agg.total_cost).toBeCloseTo(0.003375, 6);
    });

    it('should be idempotent (running twice produces same result)', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const dayStart = yesterday.getTime();
      const dateString = yesterday.toISOString().split('T')[0];

      storage.insertEvent({
        timestamp: dayStart + 1000,
        accountId: 'account1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.00225,
        latency: 1000,
        status: 'success',
      });

      // Run aggregation twice
      const result1 = await scheduler.triggerJob('daily-aggregation');
      const result2 = await scheduler.triggerJob('daily-aggregation');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Verify only one aggregation exists
      const aggs = storage
        .getDatabase()
        .prepare('SELECT * FROM usage_daily WHERE date = ?')
        .all(dateString);

      expect(aggs).toHaveLength(1);

      const agg = aggs[0] as any;
      expect(agg.total_requests).toBe(1);
      expect(agg.total_tokens).toBe(150);
    });

    it('should handle empty event set gracefully', async () => {
      const result = await scheduler.triggerJob('daily-aggregation');

      expect(result.success).toBe(true);
      expect('recordsProcessed' in result).toBe(true);
      if ('recordsProcessed' in result) {
        expect(result.recordsProcessed).toBe(0);
        expect(result.aggregationsCreated).toBe(0);
        expect(result.errors).toEqual([]);
      }
    });
  });

  describe('Data Cleanup', () => {
    it('should delete old raw events based on retention policy', async () => {
      const now = Date.now();
      const oldTimestamp = now - 31 * 24 * 60 * 60 * 1000; // 31 days ago
      const recentTimestamp = now - 1 * 24 * 60 * 60 * 1000; // 1 day ago

      // Insert old event (should be deleted)
      storage.insertEvent({
        timestamp: oldTimestamp,
        accountId: 'account1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.00225,
        latency: 1000,
        status: 'success',
      });

      // Insert recent event (should be kept)
      storage.insertEvent({
        timestamp: recentTimestamp,
        accountId: 'account1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.00225,
        latency: 1000,
        status: 'success',
      });

      const result = await scheduler.triggerJob('cleanup');

      expect(result.success).toBe(true);
      expect('rawEventsDeleted' in result).toBe(true);
      if ('rawEventsDeleted' in result) {
        expect(result.rawEventsDeleted).toBe(1);
      }

      // Verify only recent event remains
      const events = storage
        .getDatabase()
        .prepare('SELECT * FROM usage_events')
        .all();

      expect(events).toHaveLength(1);
      expect((events[0] as any).timestamp).toBe(recentTimestamp);
    });

    it('should handle cleanup with no old data', async () => {
      const result = await scheduler.triggerJob('cleanup');

      expect(result.success).toBe(true);
      expect('rawEventsDeleted' in result).toBe(true);
      if ('rawEventsDeleted' in result) {
        expect(result.rawEventsDeleted).toBe(0);
        expect(result.hourlyAggregationsDeleted).toBe(0);
      }
    });
  });

  describe('Job Status', () => {
    it('should track job execution status', async () => {
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      storage.insertEvent({
        timestamp: previousHourStart + 1000,
        accountId: 'account1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.00225,
        latency: 1000,
        status: 'success',
      });

      await scheduler.triggerJob('hourly-aggregation');

      const status = scheduler.getJobStatus();
      const hourlyStatus = status.get('hourly-aggregation');

      expect(hourlyStatus).toBeDefined();
      expect(hourlyStatus!.runCount).toBe(1);
      expect(hourlyStatus!.errorCount).toBe(0);
      expect(hourlyStatus!.lastSuccess).toBeDefined();
      expect(hourlyStatus!.lastError).toBeUndefined();
    });

    it('should track job errors', async () => {
      // Close storage to cause error
      storage.close();

      const result = await scheduler.triggerJob('hourly-aggregation');

      // The job completes but with errors in the result
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const status = scheduler.getJobStatus();
      const hourlyStatus = status.get('hourly-aggregation');

      // Job ran but had errors (not a thrown exception)
      expect(hourlyStatus!.runCount).toBe(1);
      expect(hourlyStatus!.lastRun).toBeDefined();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should stop all jobs gracefully', async () => {
      scheduler.start();

      await scheduler.stop();

      const status = scheduler.getJobStatus();
      for (const jobStatus of status.values()) {
        expect(jobStatus.isRunning).toBe(false);
      }
    });
  });

  describe('Aggregation Correctness Property', () => {
    it('should satisfy: sum of hourly aggregations equals sum of raw events', async () => {
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      const events: UsageEvent[] = [
        {
          timestamp: previousHourStart + 1000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          cost: 0.00225,
          latency: 1000,
          status: 'success',
        },
        {
          timestamp: previousHourStart + 2000,
          accountId: 'account1',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 30,
          cacheReadTokens: 40,
          cost: 0.0045,
          latency: 1500,
          status: 'success',
        },
      ];

      for (const event of events) {
        storage.insertEvent(event);
      }

      // Calculate expected totals from raw events
      const expectedTotalTokens = events.reduce(
        (sum, e) =>
          sum +
          e.inputTokens +
          e.outputTokens +
          (e.cacheCreationTokens || 0) +
          (e.cacheReadTokens || 0),
        0
      );
      const expectedTotalCost = events.reduce((sum, e) => sum + e.cost, 0);
      const expectedRequestCount = events.length;

      // Run aggregation
      await scheduler.triggerJob('hourly-aggregation');

      // Get aggregation totals
      const aggs = storage
        .getDatabase()
        .prepare('SELECT * FROM usage_hourly WHERE hour_timestamp = ?')
        .all(previousHourStart);

      const actualTotalTokens = aggs.reduce((sum: number, a: any) => sum + a.total_tokens, 0);
      const actualTotalCost = aggs.reduce((sum: number, a: any) => sum + a.total_cost, 0);
      const actualRequestCount = aggs.reduce((sum: number, a: any) => sum + a.request_count, 0);

      // Verify Property 5: Aggregation Correctness
      expect(actualTotalTokens).toBe(expectedTotalTokens);
      expect(actualTotalCost).toBeCloseTo(expectedTotalCost, 6);
      expect(actualRequestCount).toBe(expectedRequestCount);
    });
  });
});
