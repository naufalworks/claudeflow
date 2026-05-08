/**
 * Type definitions for Metrics Collector
 *
 * Defines types for runtime metrics collection and reporting.
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5
 */

/**
 * Per-second bucket for the sliding time window
 */
export interface TimeBucket {
  timestamp: number;
  requestCount: number;
  totalLatency: number;
  errorCount: number;
}

/**
 * Request-related metrics
 * Requirements: 22.1, 22.2
 */
export interface RequestMetrics {
  /** Requests per second (averaged over the last 60 seconds) */
  requestsPerSecond: number;
  /** Average request latency in milliseconds */
  averageLatency: number;
  /** Error rate as a fraction (0.0 to 1.0) */
  errorRate: number;
  /** Total requests tracked since last reset */
  totalRequests: number;
  /** Total errors tracked since last reset */
  totalErrors: number;
}

/**
 * Per-account quota usage metrics
 * Requirements: 22.3
 */
export interface QuotaUsageEntry {
  accountId: string;
  /** Quota usage as a percentage (0 to 100) */
  usagePercentage: number;
  /** Whether the account is near its limit (>= 95%) */
  nearLimit: boolean;
}

/**
 * Cache metrics
 * Requirements: 22.4
 */
export interface CacheMetrics {
  /** Cache hit rate as a fraction (0.0 to 1.0) */
  hitRate: number;
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
}

/**
 * Connection metrics
 * Requirements: 22.5
 */
export interface ConnectionMetrics {
  /** Number of active WebSocket connections */
  activeConnections: number;
}

/**
 * Complete metrics snapshot
 */
export interface MetricsSnapshot {
  timestamp: string;
  requests: RequestMetrics;
  quota: QuotaUsageEntry[];
  cache: CacheMetrics;
  connections: ConnectionMetrics;
}

/**
 * Metrics collector configuration
 */
export interface MetricsCollectorConfig {
  /** Number of seconds in the sliding window for requests/sec calculation */
  windowSizeSeconds: number;
}

/**
 * Default configuration
 */
export const DEFAULT_METRICS_CONFIG: MetricsCollectorConfig = {
  windowSizeSeconds: 60,
};
