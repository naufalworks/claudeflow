/**
 * Type definitions for Time-Series Storage
 *
 * Defines types for usage events, aggregations, and storage operations.
 */

export interface UsageEvent {
  id?: number;
  timestamp: number; // Unix timestamp in milliseconds
  accountId: string;
  model: string;
  region: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  latency: number; // in milliseconds
  status: 'success' | 'error';
  errorCode?: string;
}

export interface HourlyAggregation {
  id?: number;
  hourTimestamp: number; // Unix timestamp rounded to hour
  accountId: string;
  model: string;
  region: string;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  avgLatency: number;
  successCount: number;
  errorCount: number;
}

export interface DailyAggregation {
  id?: number;
  date: string; // YYYY-MM-DD format
  accountId: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  averageLatency: number;
  successRate: number;
  breakdown: {
    byModel: Record<string, ModelStats>;
    byRegion: Record<string, RegionStats>;
    byHour?: HourlyStats[];
  };
}

export interface ModelStats {
  requests: number;
  tokens: number;
  cost: number;
  avgLatency: number;
  successRate: number;
}

export interface RegionStats {
  requests: number;
  tokens: number;
  cost: number;
  avgLatency: number;
  successRate: number;
}

export interface HourlyStats {
  hour: string; // ISO 8601 timestamp
  requests: number;
  tokens: number;
  cost: number;
  avgLatency: number;
  successRate: number;
}

export interface MigrationResult {
  success: boolean;
  migratedEvents: number;
  errors: string[];
  backupPath?: string;
}

export interface StorageConfig {
  databasePath: string;
  retentionDays: {
    rawEvents: number;
    hourlyAggregations: number;
    dailyAggregations: number; // -1 means indefinite
  };
}
