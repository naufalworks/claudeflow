/**
 * AnalyticsService
 * 
 * Query and analyze ClaudeFlow metrics from SQLite database
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { writeFile } from 'fs/promises';
import { logger } from '../utils/logger.js';

/**
 * Time range for metrics
 */
export type TimeRange = '24h' | '7d' | '30d';

/**
 * Request record
 */
export interface RequestRecord {
  id: number;
  timestamp: string;
  accountId: string;
  accountType: 'kiro' | 'anthropic';
  model: string;
  complexity: string;
  tokens: number;
  cost: number;
  duration: number;
  cacheHit: boolean;
  error: boolean;
}

/**
 * Metrics summary
 */
export interface MetricsSummary {
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  avgResponseTime: number;
  cacheHitRate: number;
  errorRate: number;
  requestsByModel: Record<string, number>;
  requestsByComplexity: Record<string, number>;
  costByModel: Record<string, number>;
  timeRange: TimeRange;
}

/**
 * Detailed metrics
 */
export interface DetailedMetrics extends MetricsSummary {
  requestsByHour: Array<{ hour: string; count: number }>;
  requestsByAccount: Record<string, number>;
  topAccounts: Array<{ accountId: string; requests: number; cost: number }>;
  errorsByType: Record<string, number>;
}

/**
 * Insight
 */
export interface Insight {
  type: 'info' | 'warning' | 'recommendation';
  title: string;
  message: string;
}

/**
 * AnalyticsService
 * 
 * Manages analytics database and provides metrics queries
 */
export class AnalyticsService {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || join(homedir(), '.claudeflow', 'analytics.db');
  }

  /**
   * Initialize database
   */
  initialize(): void {
    logger.info('Initializing analytics database', { path: this.dbPath });

    // Open database
    this.db = new Database(this.dbPath);

    // Create tables if they don't exist
    this.createTables();

    logger.info('Analytics database initialized');
  }

  /**
   * Create database tables
   */
  private createTables(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create requests table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_type TEXT NOT NULL,
        model TEXT NOT NULL,
        complexity TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        cost REAL NOT NULL,
        duration INTEGER NOT NULL,
        cache_hit INTEGER NOT NULL,
        error INTEGER NOT NULL
      )
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_account_id ON requests(account_id);
      CREATE INDEX IF NOT EXISTS idx_model ON requests(model);
    `);

    logger.debug('Database tables created');
  }

  /**
   * Get metrics for time range
   */
  getMetrics(timeRange: TimeRange): MetricsSummary {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    logger.info('Getting metrics', { timeRange });

    const cutoffTime = this.getTimeRangeCutoff(timeRange);

    // Total requests
    const totalRequests = this.db
      .prepare('SELECT COUNT(*) as count FROM requests WHERE timestamp >= ?')
      .get(cutoffTime) as { count: number };

    // Total cost
    const totalCost = this.db
      .prepare('SELECT SUM(cost) as sum FROM requests WHERE timestamp >= ?')
      .get(cutoffTime) as { sum: number | null };

    // Total tokens
    const totalTokens = this.db
      .prepare('SELECT SUM(tokens) as sum FROM requests WHERE timestamp >= ?')
      .get(cutoffTime) as { sum: number | null };

    // Average response time
    const avgResponseTime = this.db
      .prepare('SELECT AVG(duration) as avg FROM requests WHERE timestamp >= ?')
      .get(cutoffTime) as { avg: number | null };

    // Cache hit rate
    const cacheHits = this.db
      .prepare('SELECT COUNT(*) as count FROM requests WHERE timestamp >= ? AND cache_hit = 1')
      .get(cutoffTime) as { count: number };

    // Error rate
    const errors = this.db
      .prepare('SELECT COUNT(*) as count FROM requests WHERE timestamp >= ? AND error = 1')
      .get(cutoffTime) as { count: number };

    // Requests by model
    const requestsByModel: Record<string, number> = {};
    const modelRows = this.db
      .prepare('SELECT model, COUNT(*) as count FROM requests WHERE timestamp >= ? GROUP BY model')
      .all(cutoffTime) as Array<{ model: string; count: number }>;

    for (const row of modelRows) {
      requestsByModel[row.model] = row.count;
    }

    // Requests by complexity
    const requestsByComplexity: Record<string, number> = {};
    const complexityRows = this.db
      .prepare('SELECT complexity, COUNT(*) as count FROM requests WHERE timestamp >= ? GROUP BY complexity')
      .all(cutoffTime) as Array<{ complexity: string; count: number }>;

    for (const row of complexityRows) {
      requestsByComplexity[row.complexity] = row.count;
    }

    // Cost by model
    const costByModel: Record<string, number> = {};
    const costRows = this.db
      .prepare('SELECT model, SUM(cost) as sum FROM requests WHERE timestamp >= ? GROUP BY model')
      .all(cutoffTime) as Array<{ model: string; sum: number }>;

    for (const row of costRows) {
      costByModel[row.model] = row.sum;
    }

    const summary: MetricsSummary = {
      totalRequests: totalRequests.count,
      totalCost: totalCost.sum || 0,
      totalTokens: totalTokens.sum || 0,
      avgResponseTime: avgResponseTime.avg || 0,
      cacheHitRate: totalRequests.count > 0 ? (cacheHits.count / totalRequests.count) * 100 : 0,
      errorRate: totalRequests.count > 0 ? (errors.count / totalRequests.count) * 100 : 0,
      requestsByModel,
      requestsByComplexity,
      costByModel,
      timeRange,
    };

    logger.info('Metrics retrieved', { totalRequests: summary.totalRequests });

    return summary;
  }

  /**
   * Get detailed metrics
   */
  getDetailedMetrics(timeRange: TimeRange): DetailedMetrics {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    logger.info('Getting detailed metrics', { timeRange });

    // Get base metrics
    const summary = this.getMetrics(timeRange);

    const cutoffTime = this.getTimeRangeCutoff(timeRange);

    // Requests by hour
    const requestsByHour: Array<{ hour: string; count: number }> = [];
    const hourRows = this.db
      .prepare(`
        SELECT strftime('%Y-%m-%d %H:00', timestamp) as hour, COUNT(*) as count
        FROM requests
        WHERE timestamp >= ?
        GROUP BY hour
        ORDER BY hour
      `)
      .all(cutoffTime) as Array<{ hour: string; count: number }>;

    requestsByHour.push(...hourRows);

    // Requests by account
    const requestsByAccount: Record<string, number> = {};
    const accountRows = this.db
      .prepare('SELECT account_id, COUNT(*) as count FROM requests WHERE timestamp >= ? GROUP BY account_id')
      .all(cutoffTime) as Array<{ account_id: string; count: number }>;

    for (const row of accountRows) {
      requestsByAccount[row.account_id] = row.count;
    }

    // Top accounts
    const topAccounts = this.db
      .prepare(`
        SELECT account_id as accountId, COUNT(*) as requests, SUM(cost) as cost
        FROM requests
        WHERE timestamp >= ?
        GROUP BY account_id
        ORDER BY requests DESC
        LIMIT 10
      `)
      .all(cutoffTime) as Array<{ accountId: string; requests: number; cost: number }>;

    // Errors by type (placeholder - would need error type column)
    const errorsByType: Record<string, number> = {};

    const detailed: DetailedMetrics = {
      ...summary,
      requestsByHour,
      requestsByAccount,
      topAccounts,
      errorsByType,
    };

    logger.info('Detailed metrics retrieved');

    return detailed;
  }

  /**
   * Generate insights from metrics
   */
  generateInsights(metrics: MetricsSummary): Insight[] {
    const insights: Insight[] = [];

    // High error rate
    if (metrics.errorRate > 5) {
      insights.push({
        type: 'warning',
        title: 'High Error Rate',
        message: `Error rate is ${metrics.errorRate.toFixed(1)}%. Consider investigating failed requests.`,
      });
    }

    // Low cache hit rate
    if (metrics.cacheHitRate < 20 && metrics.totalRequests > 100) {
      insights.push({
        type: 'recommendation',
        title: 'Low Cache Hit Rate',
        message: `Cache hit rate is ${metrics.cacheHitRate.toFixed(1)}%. Consider enabling more aggressive caching.`,
      });
    }

    // High cache hit rate
    if (metrics.cacheHitRate > 80 && metrics.totalRequests > 100) {
      insights.push({
        type: 'info',
        title: 'Excellent Cache Performance',
        message: `Cache hit rate is ${metrics.cacheHitRate.toFixed(1)}%. Your caching strategy is working well!`,
      });
    }

    // High cost
    if (metrics.totalCost > 100) {
      insights.push({
        type: 'info',
        title: 'High API Costs',
        message: `Total cost is $${metrics.totalCost.toFixed(2)}. Consider using cheaper models for simple tasks.`,
      });
    }

    // Slow response time
    if (metrics.avgResponseTime > 5000) {
      insights.push({
        type: 'warning',
        title: 'Slow Response Times',
        message: `Average response time is ${(metrics.avgResponseTime / 1000).toFixed(1)}s. Consider optimizing requests.`,
      });
    }

    // Good response time
    if (metrics.avgResponseTime < 1000 && metrics.totalRequests > 10) {
      insights.push({
        type: 'info',
        title: 'Fast Response Times',
        message: `Average response time is ${metrics.avgResponseTime.toFixed(0)}ms. Great performance!`,
      });
    }

    return insights;
  }

  /**
   * Export data to JSON
   */
  async exportToJSON(outputPath: string, timeRange: TimeRange): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    logger.info('Exporting data to JSON', { outputPath, timeRange });

    const cutoffTime = this.getTimeRangeCutoff(timeRange);

    // Get all requests
    const requests = this.db
      .prepare('SELECT * FROM requests WHERE timestamp >= ? ORDER BY timestamp DESC')
      .all(cutoffTime);

    // Get metrics
    const metrics = this.getDetailedMetrics(timeRange);

    const data = {
      exportedAt: new Date().toISOString(),
      timeRange,
      metrics,
      requests,
    };

    await writeFile(outputPath, JSON.stringify(data, null, 2));

    logger.info('Data exported to JSON', { path: outputPath });
  }

  /**
   * Export data to CSV
   */
  async exportToCSV(outputPath: string, timeRange: TimeRange): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    logger.info('Exporting data to CSV', { outputPath, timeRange });

    const cutoffTime = this.getTimeRangeCutoff(timeRange);

    // Get all requests
    const requests = this.db
      .prepare('SELECT * FROM requests WHERE timestamp >= ? ORDER BY timestamp DESC')
      .all(cutoffTime) as RequestRecord[];

    // Create CSV header
    const header = 'id,timestamp,account_id,account_type,model,complexity,tokens,cost,duration,cache_hit,error\n';

    // Create CSV rows
    const rows = requests.map((r) =>
      `${r.id},${r.timestamp},${r.accountId},${r.accountType},${r.model},${r.complexity},${r.tokens},${r.cost},${r.duration},${r.cacheHit ? 1 : 0},${r.error ? 1 : 0}`
    ).join('\n');

    const csv = header + rows;

    await writeFile(outputPath, csv);

    logger.info('Data exported to CSV', { path: outputPath });
  }

  /**
   * Get time range cutoff
   */
  private getTimeRangeCutoff(timeRange: TimeRange): string {
    const now = new Date();

    switch (timeRange) {
      case '24h':
        now.setHours(now.getHours() - 24);
        break;
      case '7d':
        now.setDate(now.getDate() - 7);
        break;
      case '30d':
        now.setDate(now.getDate() - 30);
        break;
    }

    return now.toISOString();
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Analytics database closed');
    }
  }
}
