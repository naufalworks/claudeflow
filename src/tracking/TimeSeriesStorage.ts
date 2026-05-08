/**
 * Time-Series Storage
 *
 * Efficient SQLite-based storage for usage tracking with time-series optimization.
 * Provides raw event storage, pre-computed aggregations, and efficient queries.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 19.1, 19.2, 19.3, 19.4, 19.5
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  UsageEvent,
  TimeRange,
  UsageStats,
  MigrationResult,
  StorageConfig,
  HourlyAggregation,
  DailyAggregation,
  ModelStats,
  RegionStats,
} from './TimeSeriesStorage.types.js';

const DEFAULT_CONFIG: StorageConfig = {
  databasePath: path.join(process.env.HOME || '', '.claudeflow', 'usage.db'),
  retentionDays: {
    rawEvents: 30,
    hourlyAggregations: 90,
    dailyAggregations: -1, // Indefinite
  },
};

/**
 * Type definitions for old JSON format migration
 */
interface LegacyUsageEntry {
  timestamp: string | number;
  accountId: string;
  model: string;
  region: string;
  tokens: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  cost: number;
  status: string;
}

interface LegacyUsageData {
  history?: LegacyUsageEntry[];
}

export class TimeSeriesStorage {
  private db: Database.Database;
  private config: StorageConfig;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure directory exists
    const dir = path.dirname(this.config.databasePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(this.config.databasePath);
    this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
    this.db.pragma('synchronous = NORMAL'); // Balance between safety and performance

    this.initializeSchema();
  }

  /**
   * Initialize database schema with tables and indexes
   * Requirements: 3.1, 3.2
   */
  private initializeSchema(): void {
    // Raw usage events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        model TEXT NOT NULL,
        region TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_creation_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cost REAL NOT NULL,
        latency INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT
      );
    `);

    // Indexes for efficient queries (Requirement 3.2)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_account_timestamp ON usage_events(account_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_model_timestamp ON usage_events(model, timestamp);
    `);

    // Hourly aggregations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_hourly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hour_timestamp INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        model TEXT NOT NULL,
        region TEXT NOT NULL,
        request_count INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        total_cost REAL NOT NULL,
        avg_latency REAL NOT NULL,
        success_count INTEGER NOT NULL,
        error_count INTEGER NOT NULL,
        UNIQUE(hour_timestamp, account_id, model, region)
      );
    `);

    // Daily aggregations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        account_id TEXT NOT NULL,
        total_requests INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        total_cost REAL NOT NULL,
        UNIQUE(date, account_id)
      );
    `);
  }

  /**
   * Insert a usage event
   * Requirements: 1.5, 3.1
   */
  insertEvent(event: UsageEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO usage_events (
        timestamp, account_id, model, region,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost, latency, status, error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.timestamp,
      event.accountId,
      event.model,
      event.region,
      event.inputTokens,
      event.outputTokens,
      event.cacheCreationTokens,
      event.cacheReadTokens,
      event.cost,
      event.latency,
      event.status,
      event.errorCode || null
    );
  }

  /**
   * Query usage events within a time range
   * Requirements: 3.4, 3.5
   */
  queryEvents(timeRange: TimeRange, accountId?: string): UsageEvent[] {
    let query = `
      SELECT 
        id, timestamp, account_id as accountId, model, region,
        input_tokens as inputTokens, output_tokens as outputTokens,
        cache_creation_tokens as cacheCreationTokens, cache_read_tokens as cacheReadTokens,
        cost, latency, status, error_code as errorCode
      FROM usage_events
      WHERE timestamp >= ? AND timestamp <= ?
    `;

    const params: (number | string)[] = [timeRange.start.getTime(), timeRange.end.getTime()];

    if (accountId) {
      query += ' AND account_id = ?';
      params.push(accountId);
    }

    query += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as UsageEvent[];
  }

  /**
   * Get usage statistics for a time range
   * Requirements: 3.4, 24.1, 24.2, 24.3, 24.4, 24.5
   */
  getUsageStats(timeRange: TimeRange, accountId?: string): UsageStats {
    const events = this.queryEvents(timeRange, accountId);

    if (events.length === 0) {
      return {
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0,
        averageLatency: 0,
        successRate: 0,
        breakdown: {
          byModel: {},
          byRegion: {},
          byHour: [],
        },
      };
    }

    // Calculate totals
    let totalTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let successCount = 0;

    const byModel: Record<
      string,
      { requests: number; tokens: number; cost: number; latency: number; successCount: number }
    > = {};
    const byRegion: Record<
      string,
      { requests: number; tokens: number; cost: number; latency: number; successCount: number }
    > = {};

    for (const event of events) {
      const tokens =
        event.inputTokens + event.outputTokens + event.cacheCreationTokens + event.cacheReadTokens;
      totalTokens += tokens;
      totalCost += event.cost;
      totalLatency += event.latency;

      if (event.status === 'success') {
        successCount++;
      }

      // By model
      if (!byModel[event.model]) {
        byModel[event.model] = {
          requests: 0,
          tokens: 0,
          cost: 0,
          latency: 0,
          successCount: 0,
        };
      }
      byModel[event.model].requests++;
      byModel[event.model].tokens += tokens;
      byModel[event.model].cost += event.cost;
      byModel[event.model].latency += event.latency;
      if (event.status === 'success') {
        byModel[event.model].successCount++;
      }

      // By region
      if (!byRegion[event.region]) {
        byRegion[event.region] = {
          requests: 0,
          tokens: 0,
          cost: 0,
          latency: 0,
          successCount: 0,
        };
      }
      byRegion[event.region].requests++;
      byRegion[event.region].tokens += tokens;
      byRegion[event.region].cost += event.cost;
      byRegion[event.region].latency += event.latency;
      if (event.status === 'success') {
        byRegion[event.region].successCount++;
      }
    }

    // Calculate averages and rates
    const modelStats: Record<string, ModelStats> = {};
    for (const [model, stats] of Object.entries(byModel)) {
      modelStats[model] = {
        requests: stats.requests,
        tokens: stats.tokens,
        cost: stats.cost,
        avgLatency: stats.requests > 0 ? stats.latency / stats.requests : 0,
        successRate: stats.requests > 0 ? stats.successCount / stats.requests : 0,
      };
    }

    const regionStats: Record<string, RegionStats> = {};
    for (const [region, stats] of Object.entries(byRegion)) {
      regionStats[region] = {
        requests: stats.requests,
        tokens: stats.tokens,
        cost: stats.cost,
        avgLatency: stats.requests > 0 ? stats.latency / stats.requests : 0,
        successRate: stats.requests > 0 ? stats.successCount / stats.requests : 0,
      };
    }

    return {
      totalRequests: events.length,
      totalTokens,
      totalCost,
      averageLatency: totalLatency / events.length,
      successRate: successCount / events.length,
      breakdown: {
        byModel: modelStats,
        byRegion: regionStats,
      },
    };
  }

  /**
   * Migrate data from old JSON format to SQLite
   * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5
   */
  migrateFromJSON(jsonPath: string): MigrationResult {
    const result: MigrationResult = {
      success: false,
      migratedEvents: 0,
      errors: [],
    };

    try {
      // Check if JSON file exists
      if (!fs.existsSync(jsonPath)) {
        result.errors.push(`JSON file not found: ${jsonPath}`);
        return result;
      }

      // Read old JSON data
      const rawData: unknown = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const jsonData = rawData as LegacyUsageData;

      if (!jsonData.history || !Array.isArray(jsonData.history)) {
        result.errors.push('Invalid JSON format: missing history array');
        return result;
      }

      // Backup old file (Requirement 19.4)
      const backupPath = `${jsonPath}.backup`;
      fs.copyFileSync(jsonPath, backupPath);
      result.backupPath = backupPath;

      // Migrate events in a transaction
      const insertStmt = this.db.prepare(`
        INSERT INTO usage_events (
          timestamp, account_id, model, region,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
          cost, latency, status, error_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const migrate = this.db.transaction((events: LegacyUsageEntry[]) => {
        for (const event of events) {
          try {
            const timestamp = new Date(event.timestamp).getTime();
            insertStmt.run(
              timestamp,
              String(event.accountId),
              String(event.model),
              String(event.region),
              event.tokens.input_tokens || 0,
              event.tokens.output_tokens || 0,
              event.tokens.cache_creation_input_tokens || 0,
              event.tokens.cache_read_input_tokens || 0,
              Number(event.cost),
              0, // latency not tracked in old system
              String(event.status),
              null
            );
            result.migratedEvents++;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.errors.push(`Failed to migrate event: ${errorMsg}`);
          }
        }
      });

      migrate(jsonData.history);
      result.success = result.errors.length === 0;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Migration failed: ${errorMsg}`);
      result.success = false;
    }

    return result;
  }

  /**
   * Insert or update hourly aggregation
   * Requirements: 4.4, 4.5, 23.4, 23.5
   */
  insertHourlyAggregation(agg: HourlyAggregation): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO usage_hourly (
        hour_timestamp, account_id, model, region,
        request_count, total_tokens, total_cost,
        avg_latency, success_count, error_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      agg.hourTimestamp,
      agg.accountId,
      agg.model,
      agg.region,
      agg.requestCount,
      agg.totalTokens,
      agg.totalCost,
      agg.avgLatency,
      agg.successCount,
      agg.errorCount
    );
  }

  /**
   * Insert or update daily aggregation
   * Requirements: 4.4, 4.5, 23.4, 23.5
   */
  insertDailyAggregation(agg: DailyAggregation): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO usage_daily (
        date, account_id, total_requests, total_tokens, total_cost
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(agg.date, agg.accountId, agg.totalRequests, agg.totalTokens, agg.totalCost);
  }

  /**
   * Delete old events based on retention policy
   * Requirements: 4.1, 4.2, 4.3
   */
  cleanupOldData(): void {
    const now = Date.now();

    // Delete raw events older than retention period
    if (this.config.retentionDays.rawEvents > 0) {
      const cutoff = now - this.config.retentionDays.rawEvents * 24 * 60 * 60 * 1000;
      this.db.prepare('DELETE FROM usage_events WHERE timestamp < ?').run(cutoff);
    }

    // Delete hourly aggregations older than retention period
    if (this.config.retentionDays.hourlyAggregations > 0) {
      const cutoff = now - this.config.retentionDays.hourlyAggregations * 24 * 60 * 60 * 1000;
      this.db.prepare('DELETE FROM usage_hourly WHERE hour_timestamp < ?').run(cutoff);
    }

    // Daily aggregations are kept indefinitely (retentionDays = -1)
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get database instance (for testing)
   */
  getDatabase(): Database.Database {
    return this.db;
  }
}
