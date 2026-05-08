/**
 * Metrics Collector
 *
 * Centralized runtime metrics collection for the usage tracking system.
 * Uses a sliding time window for accurate requests/sec calculation.
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5
 */

import {
  MetricsSnapshot,
  RequestMetrics,
  QuotaUsageEntry,
  CacheMetrics,
  ConnectionMetrics,
  TimeBucket,
  MetricsCollectorConfig,
  DEFAULT_METRICS_CONFIG,
} from './MetricsCollector.types.js';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { RedisCacheManager } from './RedisCacheManager.js';
import { RealTimeUpdateService } from './RealTimeUpdateService.js';
import { QuotaManagementManager } from './QuotaManagementManager.js';

/**
 * Optional dependencies for enriched metrics
 */
export interface MetricsCollectorDependencies {
  storage?: TimeSeriesStorage;
  redis?: RedisCacheManager;
  realtimeService?: RealTimeUpdateService;
  quotaManager?: QuotaManagementManager;
}

export class MetricsCollector {
  private config: MetricsCollectorConfig;
  private deps: MetricsCollectorDependencies;

  // Sliding window buckets (one per second)
  private buckets: TimeBucket[];

  // Lifetime counters (since last reset)
  private totalRequests: number;
  private totalErrors: number;
  private totalLatency: number;

  // Cache hit/miss tracking
  private cacheHits: number;
  private cacheMisses: number;

  // Known account IDs for quota tracking
  private accountIds: Set<string>;

  constructor(deps: MetricsCollectorDependencies = {}, config?: Partial<MetricsCollectorConfig>) {
    this.config = { ...DEFAULT_METRICS_CONFIG, ...config };
    this.deps = deps;

    // Initialize sliding window with empty buckets
    this.buckets = Array.from({ length: this.config.windowSizeSeconds }, () => ({
      timestamp: 0,
      requestCount: 0,
      totalLatency: 0,
      errorCount: 0,
    }));

    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalLatency = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.accountIds = new Set<string>();
  }

  /**
   * Record a request for metrics tracking
   * Requirements: 22.1, 22.2
   *
   * @param latency - Request latency in milliseconds
   * @param success - Whether the request was successful
   * @param accountId - Optional account ID for quota tracking
   */
  recordRequest(latency: number, success: boolean, accountId?: string): void {
    const now = Math.floor(Date.now() / 1000);
    const bucketIndex = now % this.config.windowSizeSeconds;

    // Reset bucket if it's from a previous cycle
    if (this.buckets[bucketIndex].timestamp !== now) {
      this.buckets[bucketIndex] = {
        timestamp: now,
        requestCount: 0,
        totalLatency: 0,
        errorCount: 0,
      };
    }

    // Update bucket
    this.buckets[bucketIndex].requestCount++;
    this.buckets[bucketIndex].totalLatency += latency;
    if (!success) {
      this.buckets[bucketIndex].errorCount++;
    }

    // Update lifetime counters
    this.totalRequests++;
    this.totalLatency += latency;
    if (!success) {
      this.totalErrors++;
    }

    // Track account
    if (accountId) {
      this.accountIds.add(accountId);
    }
  }

  /**
   * Record a cache hit
   * Requirements: 22.4
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record a cache miss
   * Requirements: 22.4
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Get complete metrics snapshot
   * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5
   */
  async getMetrics(): Promise<MetricsSnapshot> {
    const [quotaMetrics, cacheMetrics, connectionMetrics] = await Promise.all([
      this.getQuotaUsage(),
      Promise.resolve(this.getCacheMetrics()),
      Promise.resolve(this.getConnectionMetrics()),
    ]);

    return {
      timestamp: new Date().toISOString(),
      requests: this.getRequestMetrics(),
      quota: quotaMetrics,
      cache: cacheMetrics,
      connections: connectionMetrics,
    };
  }

  /**
   * Calculate request metrics from the sliding window and lifetime counters
   * Requirements: 22.1, 22.2
   * @private
   */
  getRequestMetrics(): RequestMetrics {
    const now = Math.floor(Date.now() / 1000);

    // Sum all buckets within the time window (exclude current second for stability)
    let windowRequests = 0;
    let activeBuckets = 0;

    for (const bucket of this.buckets) {
      const age = now - bucket.timestamp;
      // Only count buckets that are within the window and not the current second
      if (bucket.timestamp > 0 && age > 0 && age <= this.config.windowSizeSeconds) {
        windowRequests += bucket.requestCount;
        activeBuckets++;
      }
    }

    const requestsPerSecond = activeBuckets > 0 ? windowRequests / activeBuckets : 0;

    // Use lifetime totals for average latency and error rate (more accurate)
    const averageLatency = this.totalRequests > 0 ? this.totalLatency / this.totalRequests : 0;
    const errorRate = this.totalRequests > 0 ? this.totalErrors / this.totalRequests : 0;

    return {
      requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
      averageLatency: Math.round(averageLatency * 100) / 100,
      errorRate: Math.round(errorRate * 10000) / 10000,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
    };
  }

  /**
   * Get quota usage for all tracked accounts
   * Requirements: 22.3
   * @private
   */
  private async getQuotaUsage(): Promise<QuotaUsageEntry[]> {
    if (!this.deps.quotaManager || this.accountIds.size === 0) {
      return [];
    }

    const entries: QuotaUsageEntry[] = [];
    for (const accountId of this.accountIds) {
      try {
        const status = await this.deps.quotaManager.getQuotaStatus(accountId);
        const rpmUsage = status.requestsPerMinute;
        const usagePercentage = rpmUsage.limit > 0 ? (rpmUsage.used / rpmUsage.limit) * 100 : 0;

        entries.push({
          accountId,
          usagePercentage: Math.round(usagePercentage * 100) / 100,
          nearLimit: usagePercentage >= 95,
        });
      } catch {
        // Skip accounts with errors - graceful degradation
        entries.push({
          accountId,
          usagePercentage: 0,
          nearLimit: false,
        });
      }
    }

    return entries;
  }

  /**
   * Get cache metrics
   * Requirements: 22.4
   * @private
   */
  private getCacheMetrics(): CacheMetrics {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? this.cacheHits / total : 0;

    return {
      hitRate: Math.round(hitRate * 10000) / 10000,
      hits: this.cacheHits,
      misses: this.cacheMisses,
    };
  }

  /**
   * Get connection metrics from RealTimeUpdateService
   * Requirements: 22.5
   * @private
   */
  private getConnectionMetrics(): ConnectionMetrics {
    if (!this.deps.realtimeService) {
      return { activeConnections: 0 };
    }

    try {
      return {
        activeConnections: this.deps.realtimeService.getConnectedClientCount(),
      };
    } catch {
      return { activeConnections: 0 };
    }
  }

  /**
   * Reset all metrics counters
   */
  reset(): void {
    // Reset all buckets
    for (let i = 0; i < this.buckets.length; i++) {
      this.buckets[i] = {
        timestamp: 0,
        requestCount: 0,
        totalLatency: 0,
        errorCount: 0,
      };
    }

    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalLatency = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.accountIds.clear();
  }

  /**
   * Get total requests since last reset
   */
  getTotalRequests(): number {
    return this.totalRequests;
  }

  /**
   * Get total errors since last reset
   */
  getTotalErrors(): number {
    return this.totalErrors;
  }

  /**
   * Get the number of tracked accounts
   */
  getTrackedAccountCount(): number {
    return this.accountIds.size;
  }
}
