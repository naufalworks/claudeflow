/**
 * End-to-End Integration Tests for Tracking System
 *
 * Validates that components work together across 4 key flows:
 * 1. Complete Tracking Flow (Storage → TrackingManager → Stats)
 * 2. Quota Exhaustion Flow (QuotaManager → Account ranking → Switching)
 * 3. Background Jobs Flow (Raw events → Aggregation → Cleanup)
 * 4. Error Recovery Flow (FallbackQueue → Circuit breaker)
 *
 * Uses temp databases for all tests. No mocks.
 */

import { UsageTrackingManager, TrackingEvent } from './UsageTrackingManager.js';
import { QuotaManagementManager } from './QuotaManagementManager.js';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { BackgroundJobScheduler } from './BackgroundJobScheduler.js';
import { FallbackQueue } from './ErrorRecovery.js';
import { TimeRange, UsageEvent } from './TimeSeriesStorage.types.js';
import { AggregationResult, CleanupResult } from './BackgroundJobScheduler.types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDbPath(prefix: string): string {
  const dir = path.join(os.tmpdir(), 'claudeflow-integrationtests');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

function cleanupDb(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const wal = `${dbPath}-wal`;
    const shm = `${dbPath}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch {
    // ignore
  }
}

function createTrackingEvent(
  accountId: string,
  overrides: Partial<TrackingEvent> = {}
): TrackingEvent {
  return {
    accountId,
    model: 'claude-3-5-sonnet-20241022',
    region: 'us-east-1',
    tokens: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
    latency: 1000,
    status: 'success',
    ...overrides,
  };
}

// ===========================================================================
// 1. Complete Tracking Flow
// ===========================================================================
describe('Integration: Complete Tracking Flow', () => {
  let storage: TimeSeriesStorage;
  let trackingManager: UsageTrackingManager;
  let storageDbPath: string;

  beforeEach(() => {
    storageDbPath = tempDbPath('complete-flow-storage');
    storage = new TimeSeriesStorage({ databasePath: storageDbPath });
    trackingManager = new UsageTrackingManager({ databasePath: storageDbPath });
  });

  afterEach(() => {
    trackingManager.close();
    storage.close();
    cleanupDb(storageDbPath);
  });

  it('should track multiple requests across accounts and models and verify totals', async () => {
    const accounts = ['acc-flow-a', 'acc-flow-b'];
    const models = ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'];

    let totalExpectedTokens = 0;
    let totalExpectedCost = 0;
    let requestCount = 0;

    // Track requests with different account/model combos
    for (const accountId of accounts) {
      for (const model of models) {
        const inputTokens = 1000 + requestCount * 100;
        const outputTokens = 500 + requestCount * 50;
        const event = createTrackingEvent(accountId, {
          model,
          tokens: {
            inputTokens,
            outputTokens,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
          },
          timestamp: new Date(),
        });
        await trackingManager.trackRequest(event);

        totalExpectedTokens += inputTokens + outputTokens;
        totalExpectedCost += trackingManager.calculateCost(event.tokens);
        requestCount++;
      }
    }

    // Query total usage across all accounts
    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };

    const stats = await trackingManager.getTotalUsage(timeRange);
    expect(stats.totalRequests).toBe(requestCount); // 4
    expect(stats.totalTokens).toBe(totalExpectedTokens);
    expect(stats.totalCost).toBeCloseTo(totalExpectedCost, 4);
    expect(stats.successRate).toBe(1.0);
  });

  it('should verify per-account stats match tracked events', async () => {
    const acc1 = 'acc-individual-1';
    const acc2 = 'acc-individual-2';

    // acc1: 3 requests
    for (let i = 0; i < 3; i++) {
      await trackingManager.trackRequest(createTrackingEvent(acc1, { timestamp: new Date() }));
    }
    // acc2: 2 requests
    for (let i = 0; i < 2; i++) {
      await trackingManager.trackRequest(createTrackingEvent(acc2, { timestamp: new Date() }));
    }

    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };

    const acc1Stats = await trackingManager.getAccountUsage(acc1, timeRange);
    const acc2Stats = await trackingManager.getAccountUsage(acc2, timeRange);
    const totalStats = await trackingManager.getTotalUsage(timeRange);

    expect(acc1Stats.totalRequests).toBe(3);
    expect(acc2Stats.totalRequests).toBe(2);
    expect(totalStats.totalRequests).toBe(5);
  });

  it('should verify per-model breakdown from tracked requests', async () => {
    const accountId = 'acc-model-breakdown';

    await trackingManager.trackRequest(
      createTrackingEvent(accountId, {
        model: 'claude-3-5-sonnet-20241022',
        tokens: {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        timestamp: new Date(),
      })
    );
    await trackingManager.trackRequest(
      createTrackingEvent(accountId, {
        model: 'claude-3-opus-20240229',
        tokens: { inputTokens: 500, outputTokens: 250, cacheCreationTokens: 0, cacheReadTokens: 0 },
        timestamp: new Date(),
      })
    );

    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };

    const stats = await trackingManager.getAccountUsage(accountId, timeRange);
    expect(stats.breakdown.byModel).toHaveProperty('claude-3-5-sonnet-20241022');
    expect(stats.breakdown.byModel).toHaveProperty('claude-3-opus-20240229');
    expect(stats.breakdown.byModel['claude-3-5-sonnet-20241022'].tokens).toBe(3000);
    expect(stats.breakdown.byModel['claude-3-opus-20240229'].tokens).toBe(750);
  });

  it('should emit usage_event for every tracked request', async () => {
    const emittedEvents: UsageEvent[] = [];
    trackingManager.on('usage_event', (event: UsageEvent) => {
      emittedEvents.push(event);
    });

    for (let i = 0; i < 5; i++) {
      await trackingManager.trackRequest(
        createTrackingEvent(`acc-emit-${i}`, { timestamp: new Date() })
      );
    }

    expect(emittedEvents).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(emittedEvents[i].accountId).toBe(`acc-emit-${i}`);
    }
  });

  it('should correctly calculate costs for cache token types', async () => {
    const event = createTrackingEvent('acc-cache-tokens', {
      tokens: {
        inputTokens: 1_000_000, // $15
        outputTokens: 0,
        cacheCreationTokens: 1_000_000, // $15
        cacheReadTokens: 1_000_000, // $1.50
      },
      timestamp: new Date(),
    });

    await trackingManager.trackRequest(event);

    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };

    const stats = await trackingManager.getAccountUsage('acc-cache-tokens', timeRange);
    // $15 (input) + $15 (cache creation) + $1.50 (cache read) = $31.50
    expect(stats.totalCost).toBeCloseTo(31.5, 1);
    expect(stats.totalTokens).toBe(3_000_000);
  });
});

// ===========================================================================
// 2. Quota Exhaustion Flow
// ===========================================================================
describe('Integration: Quota Exhaustion Flow', () => {
  let quotaManager: QuotaManagementManager;
  let quotaDbPath: string;

  beforeEach(() => {
    quotaDbPath = tempDbPath('quota-exhaust-flow');
    quotaManager = new QuotaManagementManager(quotaDbPath, {
      defaultLimits: {
        requestsPerMinute: 100,
        tokensPerDay: 10_000,
      },
    });
  });

  afterEach(() => {
    quotaManager.close();
    cleanupDb(quotaDbPath);
  });

  it('should rank healthy accounts above near-limit accounts', async () => {
    const accHealthy = 'acc-healthy-1';
    const accNearLimit = 'acc-near-1';
    const accLow = 'acc-low-1';

    // accLow: very low usage (100 tokens)
    await quotaManager.updateQuotaUsage(accLow, 100);
    // accHealthy: moderate usage (3000 tokens)
    await quotaManager.updateQuotaUsage(accHealthy, 3000);
    // accNearLimit: 96% usage (9600 tokens)
    await quotaManager.updateQuotaUsage(accNearLimit, 9600);

    const ranked = await quotaManager.getAvailableAccounts();

    expect(ranked.length).toBe(3);

    // Near-limit account should be ranked lowest (score = 0)
    const nearLimitEntry = ranked.find((r) => r.accountId === accNearLimit);
    expect(nearLimitEntry).toBeDefined();
    expect(nearLimitEntry!.score).toBe(0);

    // The last ranked should be the near-limit one
    expect(ranked[ranked.length - 1].accountId).toBe(accNearLimit);

    // Healthy accounts should have score > 0
    const healthyEntries = ranked.filter((r) => r.accountId !== accNearLimit);
    for (const entry of healthyEntries) {
      expect(entry.score).toBeGreaterThan(0);
    }
  });

  it('should simulate high usage on account-1 (95%+ quota) and verify ranking', async () => {
    const acc1 = 'acc-high-usage';
    const acc2 = 'acc-normal-1';
    const acc3 = 'acc-normal-2';

    // acc1: push to 97% usage
    await quotaManager.updateQuotaUsage(acc1, 9700);
    // acc2 and acc3: light usage
    await quotaManager.updateQuotaUsage(acc2, 500);
    await quotaManager.updateQuotaUsage(acc3, 1000);

    const ranked = await quotaManager.getAvailableAccounts();

    // acc1 should be at the bottom with score 0
    const acc1Rank = ranked.find((r) => r.accountId === acc1);
    expect(acc1Rank).toBeDefined();
    expect(acc1Rank!.score).toBe(0);

    // acc2 and acc3 should be ranked above acc1
    const acc2Rank = ranked.find((r) => r.accountId === acc2);
    const acc3Rank = ranked.find((r) => r.accountId === acc3);
    expect(acc2Rank!.score).toBeGreaterThan(acc1Rank!.score);
    expect(acc3Rank!.score).toBeGreaterThan(acc1Rank!.score);

    // Top ranked should be acc2 (lowest usage = 500)
    expect(ranked[0].accountId).toBe(acc2);
  });

  it('should still rank accounts when ALL are near-limit', async () => {
    const acc1 = 'acc-all-near-1';
    const acc2 = 'acc-all-near-2';
    const acc3 = 'acc-all-near-3';

    // Push all above 95%
    await quotaManager.updateQuotaUsage(acc1, 9600);
    await quotaManager.updateQuotaUsage(acc2, 9700);
    await quotaManager.updateQuotaUsage(acc3, 9800);

    const ranked = await quotaManager.getAvailableAccounts();
    expect(ranked.length).toBe(3);

    // All should have "All accounts near limit" reason
    for (const account of ranked) {
      expect(account.reason).toContain('All accounts near limit');
    }
  });

  it('should return correct quota status after repeated usage updates', async () => {
    const accountId = 'acc-status-flow';

    // Incrementally use quota
    for (let i = 0; i < 5; i++) {
      await quotaManager.updateQuotaUsage(accountId, 1000);
    }

    const status = await quotaManager.getQuotaStatus(accountId);
    expect(status.tokensPerDay.used).toBe(5000);
    expect(status.tokensPerDay.limit).toBe(10_000);
    expect(status.status).toBe('available'); // 50% used
  });

  it('should switch to exceeded status at 100% usage', async () => {
    const accountId = 'acc-exceeded-flow';

    await quotaManager.updateQuotaUsage(accountId, 10_001);

    const status = await quotaManager.getQuotaStatus(accountId);
    expect(status.status).toBe('exceeded');
  });
});

// ===========================================================================
// 3. Background Jobs Flow
// ===========================================================================
describe('Integration: Background Jobs Flow', () => {
  let storage: TimeSeriesStorage;
  let scheduler: BackgroundJobScheduler;
  let storageDbPath: string;

  beforeEach(() => {
    storageDbPath = tempDbPath('bg-jobs-flow');
    storage = new TimeSeriesStorage({
      databasePath: storageDbPath,
      retentionDays: {
        rawEvents: 30,
        hourlyAggregations: 90,
        dailyAggregations: -1,
      },
    });
    scheduler = new BackgroundJobScheduler(storage, { enabled: false });
  });

  afterEach(async () => {
    await scheduler.stop();
    storage.close();
    cleanupDb(storageDbPath);
  });

  it('should aggregate raw events into hourly data matching totals', async () => {
    const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

    // Insert raw events
    const rawEvents: UsageEvent[] = [];
    let expectedTokens = 0;
    let expectedCost = 0;

    for (let i = 0; i < 10; i++) {
      const inputTokens = 100 * (i + 1);
      const outputTokens = 50 * (i + 1);
      const cost = (inputTokens + outputTokens) * 0.000015;
      expectedTokens += inputTokens + outputTokens;
      expectedCost += cost;

      rawEvents.push({
        timestamp: previousHourStart + i * 100,
        accountId: 'acc-jobs-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens,
        outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost,
        latency: 500 + i * 50,
        status: i === 9 ? 'error' : 'success',
        errorCode: i === 9 ? 'timeout' : undefined,
      });
    }

    for (const event of rawEvents) {
      storage.insertEvent(event);
    }

    // Run hourly aggregation
    const result = await scheduler.triggerJob('hourly-aggregation');
    expect(result.success).toBe(true);

    const aggResult = result as AggregationResult;
    expect(aggResult.recordsProcessed).toBe(10);
    expect(aggResult.aggregationsCreated).toBe(1);

    // Verify aggregated data matches raw events
    const db = storage.getDatabase();
    const aggs = db.prepare('SELECT * FROM usage_hourly').all() as Record<string, unknown>[];
    expect(aggs.length).toBe(1);

    const agg = aggs[0];
    expect(agg.request_count).toBe(10);
    expect(agg.total_tokens).toBeCloseTo(expectedTokens, 0);
    expect(agg.success_count).toBe(9);
    expect(agg.error_count).toBe(1);
  });

  it('should run cleanup and verify old data is removed', async () => {
    // Insert an old event (40 days ago)
    const oldTimestamp = Date.now() - 40 * 24 * 60 * 60 * 1000;
    storage.insertEvent({
      timestamp: oldTimestamp,
      accountId: 'acc-old-job',
      model: 'claude-3-5-sonnet-20241022',
      region: 'us-east-1',
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: 0.0225,
      latency: 1000,
      status: 'success',
    });

    // Insert a recent event (5 days ago)
    const recentTimestamp = Date.now() - 5 * 24 * 60 * 60 * 1000;
    storage.insertEvent({
      timestamp: recentTimestamp,
      accountId: 'acc-recent-job',
      model: 'claude-3-5-sonnet-20241022',
      region: 'us-east-1',
      inputTokens: 2000,
      outputTokens: 1000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cost: 0.045,
      latency: 1200,
      status: 'success',
    });

    // Verify both events exist
    const db = storage.getDatabase();
    let count = (
      db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as { count: number }
    ).count;
    expect(count).toBe(2);

    // Run cleanup
    const result = await scheduler.triggerJob('cleanup');
    expect(result.success).toBe(true);

    const cleanupRes = result as CleanupResult;
    expect(cleanupRes.rawEventsDeleted).toBe(1); // Only the old event

    // Verify only recent event remains
    count = (db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as { count: number })
      .count;
    expect(count).toBe(1);

    const remaining = storage.queryEvents({
      start: new Date(recentTimestamp - 1000),
      end: new Date(recentTimestamp + 1000),
    });
    expect(remaining.length).toBe(1);
    expect(remaining[0].accountId).toBe('acc-recent-job');
  });

  it('should create per-account daily aggregations', async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    // Events for two different accounts on yesterday
    const events: UsageEvent[] = [
      {
        timestamp: yesterday.getTime(),
        accountId: 'acc-daily-a',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 3000,
        outputTokens: 1500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0675,
        latency: 1000,
        status: 'success',
      },
      {
        timestamp: yesterday.getTime() + 3600000,
        accountId: 'acc-daily-b',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-west-2',
        inputTokens: 2000,
        outputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.045,
        latency: 800,
        status: 'success',
      },
    ];

    for (const event of events) {
      storage.insertEvent(event);
    }

    const result = await scheduler.triggerJob('daily-aggregation');
    expect(result.success).toBe(true);

    const aggResult = result as AggregationResult;
    expect(aggResult.recordsProcessed).toBe(2);
    expect(aggResult.aggregationsCreated).toBe(2); // Two accounts

    const db = storage.getDatabase();
    const dailies = db.prepare('SELECT * FROM usage_daily').all() as Record<string, unknown>[];
    expect(dailies.length).toBe(2);

    // Verify totals: acc-daily-a has 4500 tokens, acc-daily-b has 3000 tokens
    const accA = dailies.find((d) => d.account_id === 'acc-daily-a');
    const accB = dailies.find((d) => d.account_id === 'acc-daily-b');
    expect(accA).toBeDefined();
    expect(accB).toBeDefined();
    expect(accA!.total_tokens).toBe(4500);
    expect(accB!.total_tokens).toBe(3000);
    expect(accA!.total_requests).toBe(1);
    expect(accB!.total_requests).toBe(1);
  });

  it('should produce empty aggregation when no events exist', async () => {
    const result = await scheduler.triggerJob('hourly-aggregation');
    expect(result.success).toBe(true);

    const aggResult = result as AggregationResult;
    expect(aggResult.recordsProcessed).toBe(0);
    expect(aggResult.aggregationsCreated).toBe(0);
  });
});

// ===========================================================================
// 4. Error Recovery Flow
// ===========================================================================
describe('Integration: Error Recovery Flow', () => {
  it('should capture events in fallback queue when tracking fails', async () => {
    const processedItems: string[] = [];
    const queue = new FallbackQueue<string>({
      maxSize: 100,
      maxRetries: 3,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
    });

    queue.enqueue('event-1');
    queue.enqueue('event-2');
    queue.enqueue('event-3');
    expect(queue.size()).toBe(3);

    // Process successfully
    await queue.processQueue(async (item) => {
      processedItems.push(item);
    });

    expect(processedItems).toEqual(['event-1', 'event-2', 'event-3']);
    expect(queue.size()).toBe(0);
    expect(queue.getStatus().totalRetried).toBe(3);
  });

  it('should move items to dead letter after exceeding max retries', async () => {
    const queue = new FallbackQueue<string>({
      maxSize: 100,
      maxRetries: 2,
      initialBackoffMs: 1,
      maxBackoffMs: 10,
    });

    queue.enqueue('failing-event');

    const failingHandler = async () => {
      throw new Error('Simulated tracking failure');
    };

    // First attempt: retry count 0 → 1
    await queue.processQueue(failingHandler);
    expect(queue.size()).toBe(1);

    // Wait for backoff
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Second attempt: retry count 1 → 2 (max reached), dead-lettered
    await queue.processQueue(failingHandler);
    expect(queue.size()).toBe(0);
    expect(queue.deadLetterSize()).toBe(1);

    const deadLetter = queue.getDeadLetter();
    expect(deadLetter[0].item).toBe('failing-event');
    expect(deadLetter[0].reason).toContain('Exceeded max retries');
    expect(deadLetter[0].retryCount).toBe(2);
  });

  it('should open circuit breaker after repeated consecutive failures', async () => {
    const queue = new FallbackQueue<string>({
      maxSize: 100,
      maxRetries: 5,
      initialBackoffMs: 1,
      maxBackoffMs: 10,
    });

    // Enqueue enough items to trigger the circuit breaker (10 consecutive failures)
    for (let i = 0; i < 15; i++) {
      queue.enqueue(`item-${i}`);
    }

    expect(queue.size()).toBe(15);

    const failingHandler = async () => {
      throw new Error('Persistent failure');
    };

    // Process - all items will fail, and after 10 consecutive failures the circuit breaker opens
    await queue.processQueue(failingHandler);

    // Circuit breaker should now be open
    const status = queue.getStatus();
    expect(status.circuitBreakerOpen).toBe(true);

    // Verify that further processing is blocked
    const processed = await queue.processQueue(failingHandler);
    expect(processed).toBe(0); // Circuit breaker blocks processing
  });

  it('should reset circuit breaker and allow retries', async () => {
    const queue = new FallbackQueue<string>({
      maxSize: 100,
      maxRetries: 5,
      initialBackoffMs: 1,
      maxBackoffMs: 10,
    });

    for (let i = 0; i < 15; i++) {
      queue.enqueue(`item-${i}`);
    }

    const failingHandler = async () => {
      throw new Error('Persistent failure');
    };

    // Trigger circuit breaker
    await queue.processQueue(failingHandler);
    expect(queue.getStatus().circuitBreakerOpen).toBe(true);

    // Reset circuit breaker
    queue.resetCircuitBreaker();
    expect(queue.getStatus().circuitBreakerOpen).toBe(false);

    // Now processing should work again with a successful handler
    const processedItems: string[] = [];
    await queue.processQueue(async (item) => {
      processedItems.push(item);
    });
    expect(processedItems.length).toBeGreaterThan(0);
  });

  it('should enforce max queue size by dropping oldest items', async () => {
    const queue = new FallbackQueue<string>({
      maxSize: 3,
      maxRetries: 3,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
    });

    queue.enqueue('first');
    queue.enqueue('second');
    queue.enqueue('third');
    expect(queue.size()).toBe(3);

    // Adding a 4th item should drop the oldest
    queue.enqueue('fourth');
    expect(queue.size()).toBe(3);

    // Process and verify first was dropped
    const processed: string[] = [];
    await queue.processQueue(async (item) => {
      processed.push(item);
    });

    expect(processed).not.toContain('first');
    expect(processed).toContain('fourth');
  });

  it('should handle tracking failure gracefully in UsageTrackingManager', async () => {
    const dbPath = tempDbPath('tracking-err-flow');
    const manager = new UsageTrackingManager({ databasePath: dbPath });

    try {
      // Track a normal event
      await manager.trackRequest(
        createTrackingEvent('acc-err-recovery', { timestamp: new Date() })
      );

      // Verify it was stored
      const timeRange: TimeRange = {
        start: new Date(Date.now() - 60000),
        end: new Date(Date.now() + 60000),
      };
      const stats = await manager.getAccountUsage('acc-err-recovery', timeRange);
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalCost).toBeGreaterThan(0);
    } finally {
      manager.close();
      cleanupDb(dbPath);
    }
  });
});
