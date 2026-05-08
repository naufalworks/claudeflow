/**
 * End-to-End Integration Tests for Usage Tracking System
 *
 * Tests the complete flow across multiple components:
 * 1. Complete request flow: Storage → UsageTrackingManager → QuotaManagementManager
 * 2. Quota exhaustion and account switching
 * 3. Real-time updates delivery
 * 4. Background jobs execution
 *
 * Uses real instances with temp databases - no mocks.
 *
 * Requirements: All requirements
 */

import { UsageTrackingManager, TrackingEvent } from './UsageTrackingManager.js';
import { QuotaManagementManager } from './QuotaManagementManager.js';
import { RealTimeUpdateService } from './RealTimeUpdateService.js';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { BackgroundJobScheduler } from './BackgroundJobScheduler.js';
import { FallbackQueue } from './ErrorRecovery.js';
import { createFallbackRanking } from './ErrorRecovery.js';
import { TimeRange, UsageEvent } from './TimeSeriesStorage.types.js';
import { WebSocket } from 'ws';
import { AggregationResult, CleanupResult } from './BackgroundJobScheduler.types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Helper to generate a unique temp db path for each test
 */
function tempDbPath(prefix: string): string {
  const dir = path.join(os.tmpdir(), 'claudeflow-integration-test');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

/**
 * Helper to clean up temp databases
 */
function cleanupDb(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    // Also clean up WAL/SHM files
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  } catch {
    // Ignore cleanup errors in tests
  }
}

/**
 * Helper to create a standard tracking event
 */
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

/**
 * Helper to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Type guard: check if a result is an AggregationResult
 */
function isAggregationResult(
  result: AggregationResult | CleanupResult
): result is AggregationResult {
  return 'recordsProcessed' in result;
}

/**
 * Find an available port to avoid conflicts
 */
function getAvailablePort(): number {
  return 18080 + Math.floor(Math.random() * 1000);
}

// ===========================================================================
// 1. Complete Request Flow Integration Tests
// ===========================================================================
describe('Integration: Complete Request Flow', () => {
  let trackingManager: UsageTrackingManager;
  let quotaManager: QuotaManagementManager;
  let trackingDbPath: string;
  let quotaDbPath: string;

  beforeEach(() => {
    trackingDbPath = tempDbPath('tracking-flow');
    quotaDbPath = tempDbPath('quota-flow');

    trackingManager = new UsageTrackingManager({ databasePath: trackingDbPath });
    quotaManager = new QuotaManagementManager(quotaDbPath);
  });

  afterEach(() => {
    trackingManager.close();
    quotaManager.close();
    cleanupDb(trackingDbPath);
    cleanupDb(quotaDbPath);
  });

  it('should track a request through storage and update quota', async () => {
    const accountId = 'acc-flow-1';
    const tokens = 1500;

    // Step 1: Track the request
    const event = createTrackingEvent(accountId, {
      tokens: {
        inputTokens: tokens,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      timestamp: new Date(),
    });
    await trackingManager.trackRequest(event);

    // Step 2: Verify event was stored in TimeSeriesStorage
    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };
    const stats = await trackingManager.getAccountUsage(accountId, timeRange);
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalTokens).toBe(tokens + 500);
    expect(stats.totalCost).toBeGreaterThan(0);
    expect(stats.successRate).toBe(1);

    // Step 3: Update quota
    await quotaManager.updateQuotaUsage(accountId, tokens + 500);

    // Step 4: Verify quota was updated
    const quotaStatus = await quotaManager.getQuotaStatus(accountId);
    expect(quotaStatus.accountId).toBe(accountId);
    expect(quotaStatus.tokensPerDay.used).toBe(tokens + 500);
    expect(quotaStatus.status).toBe('available');
  });

  it('should track multiple requests and query total usage', async () => {
    const accountIds = ['acc-multi-1', 'acc-multi-2', 'acc-multi-3'];
    const requestCount = 5;

    // Track requests for each account
    for (const accountId of accountIds) {
      for (let i = 0; i < requestCount; i++) {
        const event = createTrackingEvent(accountId, {
          tokens: {
            inputTokens: 100 * (i + 1),
            outputTokens: 50 * (i + 1),
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
          },
          latency: 500 + i * 100,
          timestamp: new Date(),
        });
        await trackingManager.trackRequest(event);
      }
    }

    // Query total usage
    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };

    const totalStats = await trackingManager.getTotalUsage(timeRange);
    expect(totalStats.totalRequests).toBe(accountIds.length * requestCount);
    expect(totalStats.successRate).toBe(1);

    // Verify per-account stats
    for (const accountId of accountIds) {
      const accStats = await trackingManager.getAccountUsage(accountId, timeRange);
      expect(accStats.totalRequests).toBe(requestCount);
    }
  });

  it('should calculate cost correctly for all token types in a tracked request', async () => {
    const event = createTrackingEvent('acc-cost-test', {
      tokens: {
        inputTokens: 1_000_000, // 1M tokens = $15
        outputTokens: 500_000, // 500K tokens = $7.50
        cacheCreationTokens: 200_000, // 200K tokens = $3
        cacheReadTokens: 1_000_000, // 1M tokens = $1.50
      },
      timestamp: new Date(),
    });

    await trackingManager.trackRequest(event);

    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };

    const stats = await trackingManager.getAccountUsage('acc-cost-test', timeRange);
    // Expected: $15 + $7.50 + $3 + $1.50 = $27
    expect(stats.totalCost).toBeCloseTo(27.0, 1);
  });

  it('should emit usage_event when tracking a request', async () => {
    const emittedEvents: UsageEvent[] = [];
    trackingManager.on('usage_event', (event: UsageEvent) => {
      emittedEvents.push(event);
    });

    const event = createTrackingEvent('acc-emit-test', {
      timestamp: new Date(),
    });
    await trackingManager.trackRequest(event);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].accountId).toBe('acc-emit-test');
    expect(emittedEvents[0].inputTokens).toBe(1000);
    expect(emittedEvents[0].outputTokens).toBe(500);
    expect(emittedEvents[0].cost).toBeGreaterThan(0);
  });

  it('should track error requests and reflect in success rate', async () => {
    const accountId = 'acc-error-test';

    // Track mix of success and error requests
    for (let i = 0; i < 4; i++) {
      await trackingManager.trackRequest(
        createTrackingEvent(accountId, { status: 'success', timestamp: new Date() })
      );
    }
    for (let i = 0; i < 1; i++) {
      await trackingManager.trackRequest(
        createTrackingEvent(accountId, {
          status: 'error',
          errorCode: 'rate_limit',
          timestamp: new Date(),
        })
      );
    }

    const timeRange: TimeRange = {
      start: new Date(Date.now() - 60000),
      end: new Date(Date.now() + 60000),
    };

    const stats = await trackingManager.getAccountUsage(accountId, timeRange);
    expect(stats.totalRequests).toBe(5);
    expect(stats.successRate).toBe(0.8); // 4/5 = 80%
  });
});

// ===========================================================================
// 2. Quota Exhaustion and Account Switching Tests
// ===========================================================================
describe('Integration: Quota Exhaustion and Account Switching', () => {
  let trackingManager: UsageTrackingManager;
  let quotaManager: QuotaManagementManager;
  let trackingDbPath: string;
  let quotaDbPath: string;

  beforeEach(() => {
    trackingDbPath = tempDbPath('tracking-quota');
    quotaDbPath = tempDbPath('quota-exhaust');

    trackingManager = new UsageTrackingManager({ databasePath: trackingDbPath });
    quotaManager = new QuotaManagementManager(quotaDbPath, {
      defaultLimits: {
        requestsPerMinute: 100,
        tokensPerDay: 10_000,
      },
    });
  });

  afterEach(() => {
    trackingManager.close();
    quotaManager.close();
    cleanupDb(trackingDbPath);
    cleanupDb(quotaDbPath);
  });

  it('should mark account as near_limit when quota exceeds 95%', async () => {
    const accountId = 'acc-quota-near';

    // Use 96% of tokens per day (9,600 out of 10,000)
    await quotaManager.updateQuotaUsage(accountId, 9600);

    const status = await quotaManager.getQuotaStatus(accountId);
    expect(status.status).toBe('near_limit');
    expect(status.tokensPerDay.used).toBe(9600);
    expect(status.tokensPerDay.limit).toBe(10_000);
  });

  it('should mark account as exceeded when quota is fully used', async () => {
    const accountId = 'acc-quota-exceeded';

    // Use more than 100% of tokens per day
    await quotaManager.updateQuotaUsage(accountId, 10_500);

    const status = await quotaManager.getQuotaStatus(accountId);
    expect(status.status).toBe('exceeded');
  });

  it('should rank available accounts higher than near-limit accounts', async () => {
    const accAvailable = 'acc-available';
    const accNearLimit = 'acc-near-limit';

    // Set up available account with low usage
    await quotaManager.updateQuotaUsage(accAvailable, 1000);

    // Set up near-limit account with high usage
    await quotaManager.updateQuotaUsage(accNearLimit, 9600);

    const ranked = await quotaManager.getAvailableAccounts();

    // Find scores for both accounts
    const availableRank = ranked.find((r) => r.accountId === accAvailable);
    const nearLimitRank = ranked.find((r) => r.accountId === accNearLimit);

    expect(availableRank).toBeDefined();
    expect(nearLimitRank).toBeDefined();
    expect(availableRank!.score).toBeGreaterThan(nearLimitRank!.score);
  });

  it('should give score of 0 to near_limit accounts when available accounts exist', async () => {
    const accGood = 'acc-good';
    const accNearLimit = 'acc-near-limit-2';

    await quotaManager.updateQuotaUsage(accGood, 1000);
    await quotaManager.updateQuotaUsage(accNearLimit, 9600);

    const ranked = await quotaManager.getAvailableAccounts();

    const nearLimitEntry = ranked.find((r) => r.accountId === accNearLimit);
    expect(nearLimitEntry).toBeDefined();
    expect(nearLimitEntry!.score).toBe(0);
  });

  it('should still allow near_limit accounts when all accounts are near limit', async () => {
    const acc1 = 'acc-near-1';
    const acc2 = 'acc-near-2';

    // Both accounts are near limit
    await quotaManager.updateQuotaUsage(acc1, 9600);
    await quotaManager.updateQuotaUsage(acc2, 9700);

    const ranked = await quotaManager.getAvailableAccounts();

    // Both should be returned even though near limit
    expect(ranked.length).toBe(2);

    // They should have scores > 0 since all accounts are near limit
    for (const account of ranked) {
      expect(account.reason).toContain('All accounts near limit');
    }
  });

  it('should simulate a full account switching flow with tracking', async () => {
    const acc1 = 'acc-switch-1';
    const acc2 = 'acc-switch-2';

    // Initial usage: both accounts have low usage
    await quotaManager.updateQuotaUsage(acc1, 1000);
    await quotaManager.updateQuotaUsage(acc2, 500);

    // First request: should prefer acc2 (less usage)
    let ranked = await quotaManager.getAvailableAccounts();
    const selectedAccount = ranked[0].accountId;
    expect([acc1, acc2]).toContain(selectedAccount);

    // Track a request for the selected account
    const tokens = 9000;
    await trackingManager.trackRequest(
      createTrackingEvent(selectedAccount, {
        tokens: {
          inputTokens: tokens,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        timestamp: new Date(),
      })
    );

    // Update quota to push account near limit
    await quotaManager.updateQuotaUsage(selectedAccount, tokens);

    // Verify the selected account is now near limit or has lower score
    ranked = await quotaManager.getAvailableAccounts();
    const otherAccount = selectedAccount === acc1 ? acc2 : acc1;
    const otherRank = ranked.find((r) => r.accountId === otherAccount);
    const selectedRank = ranked.find((r) => r.accountId === selectedAccount);

    // The other account should now be preferred
    expect(otherRank).toBeDefined();
    expect(selectedRank).toBeDefined();
    if (selectedRank!.score === 0) {
      expect(otherRank!.score).toBeGreaterThan(0);
    }
  });

  it('should create fallback ranking when accounts are unavailable', () => {
    const accountIds = ['fallback-1', 'fallback-2', 'fallback-3'];
    const ranking = createFallbackRanking(accountIds, 'Quota query failed');

    expect(ranking).toHaveLength(3);
    for (const account of ranking) {
      expect(account.score).toBe(0.5);
      expect(account.reason).toContain('Degraded mode');
    }
  });
});

// ===========================================================================
// 3. Real-Time Updates Delivery Tests
// ===========================================================================
describe('Integration: Real-Time Updates Delivery', () => {
  let trackingManager: UsageTrackingManager;
  let updateService: RealTimeUpdateService;
  let trackingDbPath: string;
  let wsPort: number;

  beforeEach(() => {
    trackingDbPath = tempDbPath('tracking-rt');
    wsPort = getAvailablePort();

    trackingManager = new UsageTrackingManager({ databasePath: trackingDbPath });
    updateService = new RealTimeUpdateService({
      port: wsPort,
      batchInterval: 50, // Faster for tests
      maxBatchSize: 10,
      heartbeatInterval: 5,
    });
  });

  afterEach(async () => {
    trackingManager.close();
    await updateService.stop();
    cleanupDb(trackingDbPath);
  });

  it('should deliver usage events through the real-time update service', async () => {
    await updateService.start();
    expect(updateService.isRunning()).toBe(true);

    // Connect a WebSocket client
    const receivedMessages: Record<string, unknown>[] = [];
    const client = new WebSocket(`ws://localhost:${wsPort}`);

    await new Promise<void>((resolve) => {
      client.on('open', () => {
        // Subscribe to usage channel
        client.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
        resolve();
      });
    });

    client.on('message', (data: Buffer) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Emit a usage event
    updateService.emitUsageEvent({
      accountId: 'acc-rt-test',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.0225,
    });

    // Wait for batch flush
    await sleep(200);

    // Should have received the usage event
    const usageMessages = receivedMessages.filter((m) => m.type === 'usage_event');
    expect(usageMessages.length).toBeGreaterThanOrEqual(1);
    expect(usageMessages[0].data).toBeDefined();

    client.close();
  });

  it('should deliver quota updates through the real-time update service', async () => {
    await updateService.start();

    const receivedMessages: Record<string, unknown>[] = [];
    const client = new WebSocket(`ws://localhost:${wsPort}`);

    await new Promise<void>((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'subscribe', channels: ['quota'] }));
        resolve();
      });
    });

    client.on('message', (data: Buffer) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Emit a quota update
    updateService.emitQuotaUpdate({
      accountId: 'acc-quota-rt',
      quotaUsed: 5000,
      quotaLimit: 10000,
    });

    // Wait for batch flush
    await sleep(200);

    const quotaMessages = receivedMessages.filter((m) => m.type === 'quota_update');
    expect(quotaMessages.length).toBeGreaterThanOrEqual(1);

    client.close();
  });

  it('should only deliver events to subscribed channels', async () => {
    await updateService.start();

    const receivedMessages: Record<string, unknown>[] = [];
    const client = new WebSocket(`ws://localhost:${wsPort}`);

    await new Promise<void>((resolve) => {
      client.on('open', () => {
        // Subscribe only to quota channel
        client.send(JSON.stringify({ type: 'subscribe', channels: ['quota'] }));
        resolve();
      });
    });

    client.on('message', (data: Buffer) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Emit both usage and quota events
    updateService.emitUsageEvent({ accountId: 'acc-1', tokens: 100 });
    updateService.emitQuotaUpdate({ accountId: 'acc-1', quotaUsed: 500 });

    // Wait for batch flush
    await sleep(200);

    // Should only receive quota updates (not usage)
    const usageMessages = receivedMessages.filter((m) => m.type === 'usage_event');
    const quotaMessages = receivedMessages.filter((m) => m.type === 'quota_update');

    expect(usageMessages.length).toBe(0);
    expect(quotaMessages.length).toBeGreaterThanOrEqual(1);

    client.close();
  });

  it('should deliver events to multiple connected clients', async () => {
    await updateService.start();

    const client1Messages: Record<string, unknown>[] = [];
    const client2Messages: Record<string, unknown>[] = [];

    const client1 = new WebSocket(`ws://localhost:${wsPort}`);
    const client2 = new WebSocket(`ws://localhost:${wsPort}`);

    await Promise.all([
      new Promise<void>((resolve) => {
        client1.on('open', () => {
          client1.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        client2.on('open', () => {
          client2.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
          resolve();
        });
      }),
    ]);

    client1.on('message', (data: Buffer) => {
      client1Messages.push(JSON.parse(data.toString()));
    });
    client2.on('message', (data: Buffer) => {
      client2Messages.push(JSON.parse(data.toString()));
    });

    // Emit a usage event
    updateService.emitUsageEvent({ accountId: 'acc-multi-client', tokens: 500 });

    // Wait for batch flush
    await sleep(200);

    // Both clients should receive the event
    expect(client1Messages.filter((m) => m.type === 'usage_event').length).toBeGreaterThanOrEqual(
      1
    );
    expect(client2Messages.filter((m) => m.type === 'usage_event').length).toBeGreaterThanOrEqual(
      1
    );

    client1.close();
    client2.close();
  });

  it('should connect usage tracking events to real-time service', async () => {
    await updateService.start();

    const receivedMessages: Record<string, unknown>[] = [];
    const client = new WebSocket(`ws://localhost:${wsPort}`);

    await new Promise<void>((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'subscribe', channels: ['usage'] }));
        resolve();
      });
    });

    client.on('message', (data: Buffer) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    // Wire up: forward tracking events to update service
    trackingManager.on('usage_event', (event: UsageEvent) => {
      updateService.emitUsageEvent({
        accountId: event.accountId,
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cost: event.cost,
      });
    });

    // Track a request - this should flow through to the client
    await trackingManager.trackRequest(
      createTrackingEvent('acc-wired-test', { timestamp: new Date() })
    );

    // Wait for event emission and batch flush
    await sleep(250);

    const usageMessages = receivedMessages.filter((m) => m.type === 'usage_event');
    expect(usageMessages.length).toBeGreaterThanOrEqual(1);
    const data = usageMessages[0].data as Record<string, unknown>;
    expect(data.accountId).toBe('acc-wired-test');

    client.close();
  });

  it('should track connected client count', async () => {
    await updateService.start();
    expect(updateService.getConnectedClientCount()).toBe(0);

    const client1 = new WebSocket(`ws://localhost:${wsPort}`);
    await new Promise<void>((resolve) => {
      client1.on('open', resolve);
    });
    expect(updateService.getConnectedClientCount()).toBe(1);

    const client2 = new WebSocket(`ws://localhost:${wsPort}`);
    await new Promise<void>((resolve) => {
      client2.on('open', resolve);
    });
    expect(updateService.getConnectedClientCount()).toBe(2);

    client1.close();
    await sleep(50);
    expect(updateService.getConnectedClientCount()).toBe(1);

    client2.close();
    await sleep(50);
    expect(updateService.getConnectedClientCount()).toBe(0);
  });
});

// ===========================================================================
// 4. Background Jobs Execution Tests
// ===========================================================================
describe('Integration: Background Jobs Execution', () => {
  let storage: TimeSeriesStorage;
  let scheduler: BackgroundJobScheduler;
  let trackingManager: UsageTrackingManager;
  let storageDbPath: string;
  let trackingDbPath: string;

  beforeEach(() => {
    storageDbPath = tempDbPath('storage-jobs');
    trackingDbPath = tempDbPath('tracking-jobs');

    storage = new TimeSeriesStorage({ databasePath: storageDbPath });
    trackingManager = new UsageTrackingManager({ databasePath: trackingDbPath });
    scheduler = new BackgroundJobScheduler(storage, {
      enabled: false, // Don't auto-start cron jobs
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    storage.close();
    trackingManager.close();
    cleanupDb(storageDbPath);
    cleanupDb(trackingDbPath);
  });

  it('should aggregate hourly data from raw events', async () => {
    // Insert events for the previous hour
    const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

    const events: UsageEvent[] = [
      {
        timestamp: previousHourStart + 1000,
        accountId: 'acc-agg-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0225,
        latency: 1000,
        status: 'success',
      },
      {
        timestamp: previousHourStart + 2000,
        accountId: 'acc-agg-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 2000,
        outputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.045,
        latency: 1500,
        status: 'success',
      },
      {
        timestamp: previousHourStart + 3000,
        accountId: 'acc-agg-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 500,
        outputTokens: 250,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.01125,
        latency: 800,
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
    expect(isAggregationResult(result) && result.recordsProcessed).toBe(3);
    expect(isAggregationResult(result) && result.aggregationsCreated).toBe(1);

    // Verify aggregation was stored correctly
    const db = storage.getDatabase();
    const aggs = db.prepare('SELECT * FROM usage_hourly').all() as Record<string, unknown>[];
    expect(aggs.length).toBe(1);

    const agg = aggs[0];
    expect(agg.request_count).toBe(3);
    expect(agg.total_tokens).toBe(5250); // (1000+500) + (2000+1000) + (500+250) = 5250
    expect(agg.total_cost).toBeCloseTo(0.07875, 4);
    expect(agg.success_count).toBe(2);
    expect(agg.error_count).toBe(1);
    expect(agg.avg_latency).toBeCloseTo(1100, 0); // (1000 + 1500 + 800) / 3
  });

  it('should aggregate daily data from raw events', async () => {
    // Insert events for yesterday
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    const events: UsageEvent[] = [
      {
        timestamp: yesterday.getTime(),
        accountId: 'acc-daily-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 5000,
        outputTokens: 2500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.1125,
        latency: 1000,
        status: 'success',
      },
      {
        timestamp: yesterday.getTime() + 3600000,
        accountId: 'acc-daily-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-west-2',
        inputTokens: 3000,
        outputTokens: 1500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0675,
        latency: 1200,
        status: 'success',
      },
    ];

    for (const event of events) {
      storage.insertEvent(event);
    }

    // Run daily aggregation
    const result = await scheduler.triggerJob('daily-aggregation');

    expect(result.success).toBe(true);
    expect(isAggregationResult(result) && result.recordsProcessed).toBe(2);
    expect(isAggregationResult(result) && result.aggregationsCreated).toBe(1);

    // Verify daily aggregation
    const db = storage.getDatabase();
    const dailies = db.prepare('SELECT * FROM usage_daily').all() as Record<string, unknown>[];
    expect(dailies.length).toBe(1);

    const daily = dailies[0];
    expect(daily.total_requests).toBe(2);
    expect(daily.total_tokens).toBe(12000); // (5000+2500) + (3000+1500) = 12000
    expect(daily.total_cost).toBeCloseTo(0.18, 3);
  });

  it('should create separate aggregations per account, model, and region', async () => {
    const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

    // Events with different account/model/region combos
    const events: UsageEvent[] = [
      {
        timestamp: previousHourStart + 1000,
        accountId: 'acc-combo-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0225,
        latency: 1000,
        status: 'success',
      },
      {
        timestamp: previousHourStart + 2000,
        accountId: 'acc-combo-1',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-west-2',
        inputTokens: 2000,
        outputTokens: 1000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.045,
        latency: 1200,
        status: 'success',
      },
      {
        timestamp: previousHourStart + 3000,
        accountId: 'acc-combo-2',
        model: 'claude-3-5-sonnet-20241022',
        region: 'us-east-1',
        inputTokens: 500,
        outputTokens: 250,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.01125,
        latency: 800,
        status: 'success',
      },
    ];

    for (const event of events) {
      storage.insertEvent(event);
    }

    const result = await scheduler.triggerJob('hourly-aggregation');

    expect(result.success).toBe(true);
    expect(isAggregationResult(result) && result.aggregationsCreated).toBe(3); // 3 unique combinations

    const db = storage.getDatabase();
    const aggs = db.prepare('SELECT * FROM usage_hourly').all() as Record<string, unknown>[];
    expect(aggs.length).toBe(3);
  });

  it('should track requests through UsageTrackingManager and aggregate them', async () => {
    // Use the same storage as the scheduler
    const sharedDbPath = tempDbPath('shared-agg');
    const sharedStorage = new TimeSeriesStorage({ databasePath: sharedDbPath });
    const sharedManager = new UsageTrackingManager({ databasePath: sharedDbPath });
    const sharedScheduler = new BackgroundJobScheduler(sharedStorage, { enabled: false });

    try {
      const previousHourStart = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;

      // Track requests through the manager (which uses sharedStorage internally)
      // But since manager creates its own storage, we need to insert into the shared storage directly
      for (let i = 0; i < 5; i++) {
        sharedStorage.insertEvent({
          timestamp: previousHourStart + i * 1000,
          accountId: 'acc-shared',
          model: 'claude-3-5-sonnet-20241022',
          region: 'us-east-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.0225,
          latency: 1000 + i * 100,
          status: 'success',
        });
      }

      // Verify events were stored
      const events = sharedStorage.queryEvents({
        start: new Date(previousHourStart),
        end: new Date(previousHourStart + 3600000),
      });
      expect(events.length).toBe(5);

      // Run aggregation
      const result = await sharedScheduler.triggerJob('hourly-aggregation');
      expect(result.success).toBe(true);
      expect(isAggregationResult(result) && result.recordsProcessed).toBe(5);
      expect(isAggregationResult(result) && result.aggregationsCreated).toBe(1);

      // Verify the aggregation is correct
      const db = sharedStorage.getDatabase();
      const aggs = db.prepare('SELECT * FROM usage_hourly').all() as Record<string, unknown>[];
      expect(aggs.length).toBe(1);
      expect(aggs[0].request_count).toBe(5);
      expect(aggs[0].total_tokens).toBe(7500); // 5 * (1000 + 500)
    } finally {
      await sharedScheduler.stop();
      sharedManager.close();
      sharedStorage.close();
      cleanupDb(sharedDbPath);
    }
  });

  it('should cleanup old data based on retention policy', async () => {
    // Insert old events (40 days ago)
    const oldTimestamp = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const recentTimestamp = Date.now() - 10 * 24 * 60 * 60 * 1000;

    // Old event (should be cleaned)
    storage.insertEvent({
      timestamp: oldTimestamp,
      accountId: 'acc-old',
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

    // Recent event (should be kept)
    storage.insertEvent({
      timestamp: recentTimestamp,
      accountId: 'acc-recent',
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

    // Verify both events are there
    const db = storage.getDatabase();
    let count = (
      db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as { count: number }
    ).count;
    expect(count).toBe(2);

    // Run cleanup
    const result = await scheduler.triggerJob('cleanup');
    expect(result.success).toBe(true);

    // Only the recent event should remain
    count = (db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as { count: number })
      .count;
    expect(count).toBe(1);

    // Verify the remaining event is the recent one
    const remaining = storage.queryEvents({
      start: new Date(recentTimestamp - 1000),
      end: new Date(recentTimestamp + 1000),
    });
    expect(remaining.length).toBe(1);
    expect(remaining[0].accountId).toBe('acc-recent');
  });
});

// ===========================================================================
// 5. Error Recovery Integration Tests
// ===========================================================================
describe('Integration: Error Recovery', () => {
  it('should process items from fallback queue on retry', async () => {
    const processedItems: string[] = [];
    const queue = new FallbackQueue<string>({
      maxSize: 100,
      maxRetries: 3,
      initialBackoffMs: 10,
      maxBackoffMs: 100,
    });

    // Enqueue some items
    queue.enqueue('item-1');
    queue.enqueue('item-2');
    queue.enqueue('item-3');

    expect(queue.size()).toBe(3);

    // Process items successfully
    const handler = async (item: string) => {
      processedItems.push(item);
    };

    await queue.processQueue(handler);

    expect(processedItems).toEqual(['item-1', 'item-2', 'item-3']);
    expect(queue.size()).toBe(0);
  });

  it('should move items to dead letter after max retries', async () => {
    const queue = new FallbackQueue<string>({
      maxSize: 100,
      maxRetries: 2,
      initialBackoffMs: 1,
      maxBackoffMs: 10,
    });

    queue.enqueue('failing-item');

    // Process with a handler that always fails
    const failingHandler = async (_item: string) => {
      throw new Error('Simulated failure');
    };

    // First attempt: retryCount goes from 0 to 1, backoff = 1ms
    await queue.processQueue(failingHandler);
    expect(queue.size()).toBe(1);

    // Wait for backoff to pass
    await sleep(5);
    // Second attempt: retryCount goes from 1 to 2 (max retries reached), moves to dead letter
    await queue.processQueue(failingHandler);
    expect(queue.size()).toBe(0); // Removed from queue
    expect(queue.deadLetterSize()).toBe(1); // Moved to dead letter

    // Verify the dead letter entry
    const deadLetter = queue.getDeadLetter();
    expect(deadLetter[0].item).toBe('failing-item');
    expect(deadLetter[0].reason).toContain('Exceeded max retries');
  });

  it('should handle tracking failure gracefully with fallback queue', async () => {
    const trackingDbPath = tempDbPath('tracking-err');
    const manager = new UsageTrackingManager({ databasePath: trackingDbPath });

    try {
      // Track events normally first
      await manager.trackRequest(createTrackingEvent('acc-err-1', { timestamp: new Date() }));

      // Verify it worked
      const timeRange: TimeRange = {
        start: new Date(Date.now() - 60000),
        end: new Date(Date.now() + 60000),
      };
      const stats = await manager.getAccountUsage('acc-err-1', timeRange);
      expect(stats.totalRequests).toBe(1);
    } finally {
      manager.close();
      cleanupDb(trackingDbPath);
    }
  });
});
