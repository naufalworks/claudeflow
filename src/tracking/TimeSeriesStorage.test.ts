/**
 * Unit tests for TimeSeriesStorage
 * 
 * Tests database schema, event storage, queries, migration, and cleanup.
 */

import fs from 'fs';
import path from 'path';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { UsageEvent, TimeRange } from './TimeSeriesStorage.types.js';

describe('TimeSeriesStorage', () => {
  let storage: TimeSeriesStorage;
  const testDbPath = path.join(__dirname, '../../test-data/test-usage.db');

  beforeEach(() => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Ensure test directory exists
    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    storage = new TimeSeriesStorage({ databasePath: testDbPath });
  });

  afterEach(() => {
    storage.close();
    
    // Clean up test files
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Schema Initialization', () => {
    it('should create usage_events table with correct schema', () => {
      const db = storage.getDatabase();
      const tableInfo = db.prepare("PRAGMA table_info(usage_events)").all();
      
      const columnNames = tableInfo.map((col: any) => col.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('timestamp');
      expect(columnNames).toContain('account_id');
      expect(columnNames).toContain('model');
      expect(columnNames).toContain('region');
      expect(columnNames).toContain('input_tokens');
      expect(columnNames).toContain('output_tokens');
      expect(columnNames).toContain('cache_creation_tokens');
      expect(columnNames).toContain('cache_read_tokens');
      expect(columnNames).toContain('cost');
      expect(columnNames).toContain('latency');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('error_code');
    });

    it('should create required indexes', () => {
      const db = storage.getDatabase();
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='usage_events'").all();
      
      const indexNames = indexes.map((idx: any) => idx.name);
      expect(indexNames).toContain('idx_timestamp');
      expect(indexNames).toContain('idx_account_timestamp');
      expect(indexNames).toContain('idx_model_timestamp');
    });

    it('should create usage_hourly table', () => {
      const db = storage.getDatabase();
      const tableInfo = db.prepare("PRAGMA table_info(usage_hourly)").all();
      
      const columnNames = tableInfo.map((col: any) => col.name);
      expect(columnNames).toContain('hour_timestamp');
      expect(columnNames).toContain('request_count');
      expect(columnNames).toContain('total_tokens');
      expect(columnNames).toContain('total_cost');
      expect(columnNames).toContain('avg_latency');
      expect(columnNames).toContain('success_count');
      expect(columnNames).toContain('error_count');
    });

    it('should create usage_daily table', () => {
      const db = storage.getDatabase();
      const tableInfo = db.prepare("PRAGMA table_info(usage_daily)").all();
      
      const columnNames = tableInfo.map((col: any) => col.name);
      expect(columnNames).toContain('date');
      expect(columnNames).toContain('account_id');
      expect(columnNames).toContain('total_requests');
      expect(columnNames).toContain('total_tokens');
      expect(columnNames).toContain('total_cost');
    });
  });

  describe('Event Insertion', () => {
    it('should insert a usage event successfully', () => {
      const event: UsageEvent = {
        timestamp: Date.now(),
        accountId: 'account-1',
        model: 'claude-sonnet-4-20250514',
        region: 'us-east-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 100,
        cost: 0.025,
        latency: 1500,
        status: 'success',
      };

      storage.insertEvent(event);

      const db = storage.getDatabase();
      const result = db.prepare('SELECT * FROM usage_events WHERE account_id = ?').get('account-1') as any;
      
      expect(result).toBeDefined();
      expect(result.account_id).toBe('account-1');
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.input_tokens).toBe(1000);
      expect(result.output_tokens).toBe(500);
      expect(result.cost).toBe(0.025);
    });

    it('should insert event with error status', () => {
      const event: UsageEvent = {
        timestamp: Date.now(),
        accountId: 'account-2',
        model: 'claude-sonnet-4-20250514',
        region: 'us-west-2',
        inputTokens: 500,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0075,
        latency: 2000,
        status: 'error',
        errorCode: 'rate_limit_exceeded',
      };

      storage.insertEvent(event);

      const db = storage.getDatabase();
      const result = db.prepare('SELECT * FROM usage_events WHERE account_id = ?').get('account-2') as any;
      
      expect(result).toBeDefined();
      expect(result.status).toBe('error');
      expect(result.error_code).toBe('rate_limit_exceeded');
    });

    it('should handle multiple event insertions', () => {
      const events: UsageEvent[] = [
        {
          timestamp: Date.now(),
          accountId: 'account-1',
          model: 'claude-sonnet-4-20250514',
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
          timestamp: Date.now() + 1000,
          accountId: 'account-1',
          model: 'claude-sonnet-4-20250514',
          region: 'us-east-1',
          inputTokens: 2000,
          outputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.045,
          latency: 1500,
          status: 'success',
        },
      ];

      events.forEach(event => storage.insertEvent(event));

      const db = storage.getDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM usage_events WHERE account_id = ?').get('account-1') as any;
      
      expect(count.count).toBe(2);
    });
  });

  describe('Event Querying', () => {
    beforeEach(() => {
      // Insert test data
      const now = Date.now();
      const events: UsageEvent[] = [
        {
          timestamp: now - 3600000, // 1 hour ago
          accountId: 'account-1',
          model: 'claude-sonnet-4-20250514',
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
          timestamp: now - 1800000, // 30 minutes ago
          accountId: 'account-1',
          model: 'claude-sonnet-4-20250514',
          region: 'us-west-2',
          inputTokens: 2000,
          outputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.045,
          latency: 1500,
          status: 'success',
        },
        {
          timestamp: now - 900000, // 15 minutes ago
          accountId: 'account-2',
          model: 'claude-sonnet-4-20250514',
          region: 'us-east-1',
          inputTokens: 1500,
          outputTokens: 750,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.03375,
          latency: 1200,
          status: 'success',
        },
      ];

      events.forEach(event => storage.insertEvent(event));
    });

    it('should query events within time range', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000), // 2 hours ago
        end: new Date(now),
      };

      const events = storage.queryEvents(timeRange);
      expect(events.length).toBe(3);
    });

    it('should query events for specific account', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000),
        end: new Date(now),
      };

      const events = storage.queryEvents(timeRange, 'account-1');
      expect(events.length).toBe(2);
      expect(events.every(e => e.accountId === 'account-1')).toBe(true);
    });

    it('should return events in descending order by timestamp', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000),
        end: new Date(now),
      };

      const events = storage.queryEvents(timeRange);
      
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i + 1].timestamp);
      }
    });

    it('should return empty array for time range with no events', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 86400000), // 24 hours ago
        end: new Date(now - 7200000), // 2 hours ago
      };

      const events = storage.queryEvents(timeRange);
      expect(events.length).toBe(0);
    });
  });

  describe('Usage Statistics', () => {
    beforeEach(() => {
      // Insert test data with known values
      const now = Date.now();
      const events: UsageEvent[] = [
        {
          timestamp: now - 3600000,
          accountId: 'account-1',
          model: 'claude-sonnet-4-20250514',
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
          timestamp: now - 1800000,
          accountId: 'account-1',
          model: 'claude-sonnet-4-20250514',
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
          timestamp: now - 900000,
          accountId: 'account-1',
          model: 'claude-opus-4-20250514',
          region: 'us-west-2',
          inputTokens: 1500,
          outputTokens: 750,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cost: 0.03375,
          latency: 1200,
          status: 'error',
        },
      ];

      events.forEach(event => storage.insertEvent(event));
    });

    it('should calculate total statistics correctly', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000),
        end: new Date(now),
      };

      const stats = storage.getUsageStats(timeRange);
      
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalTokens).toBe(6750); // Sum of all tokens
      expect(stats.totalCost).toBeCloseTo(0.10125, 5);
      expect(stats.averageLatency).toBeCloseTo(1233.33, 2);
      expect(stats.successRate).toBeCloseTo(0.6667, 4);
    });

    it('should break down statistics by model', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000),
        end: new Date(now),
      };

      const stats = storage.getUsageStats(timeRange);
      
      expect(stats.breakdown.byModel['claude-sonnet-4-20250514']).toBeDefined();
      expect(stats.breakdown.byModel['claude-sonnet-4-20250514'].requests).toBe(2);
      expect(stats.breakdown.byModel['claude-opus-4-20250514']).toBeDefined();
      expect(stats.breakdown.byModel['claude-opus-4-20250514'].requests).toBe(1);
    });

    it('should break down statistics by region', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000),
        end: new Date(now),
      };

      const stats = storage.getUsageStats(timeRange);
      
      expect(stats.breakdown.byRegion['us-east-1']).toBeDefined();
      expect(stats.breakdown.byRegion['us-east-1'].requests).toBe(2);
      expect(stats.breakdown.byRegion['us-west-2']).toBeDefined();
      expect(stats.breakdown.byRegion['us-west-2'].requests).toBe(1);
    });

    it('should calculate success rate per model', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000),
        end: new Date(now),
      };

      const stats = storage.getUsageStats(timeRange);
      
      expect(stats.breakdown.byModel['claude-sonnet-4-20250514'].successRate).toBe(1.0);
      expect(stats.breakdown.byModel['claude-opus-4-20250514'].successRate).toBe(0.0);
    });

    it('should return zero stats for empty time range', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 86400000),
        end: new Date(now - 7200000),
      };

      const stats = storage.getUsageStats(timeRange);
      
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.averageLatency).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should filter statistics by account', () => {
      const now = Date.now();
      const timeRange: TimeRange = {
        start: new Date(now - 7200000),
        end: new Date(now),
      };

      const stats = storage.getUsageStats(timeRange, 'account-1');
      
      expect(stats.totalRequests).toBe(3);
    });
  });

  describe('JSON Migration', () => {
    const testJsonPath = path.join(__dirname, '../../test-data/test-usage.json');

    beforeEach(() => {
      // Create test JSON file
      const testData = {
        history: [
          {
            timestamp: '2024-01-15T10:00:00.000Z',
            accountId: 'account-1',
            model: 'claude-sonnet-4-20250514',
            region: 'us-east-1',
            tokens: {
              input_tokens: 1000,
              output_tokens: 500,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            cost: 0.0225,
            status: 'success',
          },
          {
            timestamp: '2024-01-15T11:00:00.000Z',
            accountId: 'account-2',
            model: 'claude-sonnet-4-20250514',
            region: 'us-west-2',
            tokens: {
              input_tokens: 2000,
              output_tokens: 1000,
            },
            cost: 0.045,
            status: 'success',
          },
        ],
        totalRequestsLifetime: 2,
      };

      const dir = path.dirname(testJsonPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(testJsonPath, JSON.stringify(testData, null, 2));
    });

    afterEach(() => {
      // Clean up test files
      if (fs.existsSync(testJsonPath)) {
        fs.unlinkSync(testJsonPath);
      }
      const backupPath = `${testJsonPath}.backup`;
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    });

    it('should migrate events from JSON successfully', async () => {
      const result = await storage.migrateFromJSON(testJsonPath);
      
      expect(result.success).toBe(true);
      expect(result.migratedEvents).toBe(2);
      expect(result.errors.length).toBe(0);
    });

    it('should create backup of original JSON file', async () => {
      const result = await storage.migrateFromJSON(testJsonPath);
      
      expect(result.backupPath).toBeDefined();
      expect(fs.existsSync(result.backupPath!)).toBe(true);
    });

    it('should insert migrated events into database', async () => {
      await storage.migrateFromJSON(testJsonPath);
      
      const db = storage.getDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as any;
      
      expect(count.count).toBe(2);
    });

    it('should handle missing JSON file', async () => {
      const result = await storage.migrateFromJSON('/nonexistent/path.json');
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('not found');
    });

    it('should handle invalid JSON format', async () => {
      fs.writeFileSync(testJsonPath, '{ "invalid": "format" }');
      
      const result = await storage.migrateFromJSON(testJsonPath);
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Data Cleanup', () => {
    it('should delete events older than retention period', () => {
      const now = Date.now();
      const oldEvent: UsageEvent = {
        timestamp: now - (35 * 24 * 60 * 60 * 1000), // 35 days ago
        accountId: 'account-1',
        model: 'claude-sonnet-4-20250514',
        region: 'us-east-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0225,
        latency: 1000,
        status: 'success',
      };

      const recentEvent: UsageEvent = {
        timestamp: now - (10 * 24 * 60 * 60 * 1000), // 10 days ago
        accountId: 'account-2',
        model: 'claude-sonnet-4-20250514',
        region: 'us-east-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0225,
        latency: 1000,
        status: 'success',
      };

      storage.insertEvent(oldEvent);
      storage.insertEvent(recentEvent);

      storage.cleanupOldData();

      const db = storage.getDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as any;
      
      expect(count.count).toBe(1); // Only recent event should remain
    });

    it('should not delete events within retention period', () => {
      const now = Date.now();
      const recentEvent: UsageEvent = {
        timestamp: now - (10 * 24 * 60 * 60 * 1000), // 10 days ago
        accountId: 'account-1',
        model: 'claude-sonnet-4-20250514',
        region: 'us-east-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0.0225,
        latency: 1000,
        status: 'success',
      };

      storage.insertEvent(recentEvent);
      storage.cleanupOldData();

      const db = storage.getDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as any;
      
      expect(count.count).toBe(1);
    });
  });

  describe('Database Connection', () => {
    it('should close database connection', () => {
      expect(() => storage.close()).not.toThrow();
    });

    it('should create database directory if it does not exist', () => {
      const newDbPath = path.join(__dirname, '../../test-data/new-dir/test.db');
      const dir = path.dirname(newDbPath);
      
      // Ensure directory doesn't exist
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }

      const newStorage = new TimeSeriesStorage({ databasePath: newDbPath });
      
      expect(fs.existsSync(dir)).toBe(true);
      
      newStorage.close();
      fs.rmSync(dir, { recursive: true });
    });
  });
});
