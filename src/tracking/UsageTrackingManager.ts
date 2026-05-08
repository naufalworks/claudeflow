/**
 * Usage Tracking Manager
 *
 * Professional usage tracking with accurate cost calculation, event emission,
 * and graceful error handling. Never fails API requests due to tracking errors.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { EventEmitter } from 'events';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { UsageEvent, TimeRange, UsageStats, StorageConfig } from './TimeSeriesStorage.types.js';

/**
 * Internal accumulator for breakdown stats
 */
interface BreakdownAccumulator {
  requests: number;
  tokens: number;
  cost: number;
  latency: number;
  successCount: number;
}

/**
 * Token usage breakdown for a request
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/**
 * Usage event to track
 */
export interface TrackingEvent {
  accountId: string;
  model: string;
  region: string;
  tokens: TokenUsage;
  latency: number;
  status: 'success' | 'error';
  errorCode?: string;
  timestamp?: Date;
}

/**
 * Pricing model for token costs (per 1M tokens)
 */
const TOKEN_PRICING = {
  INPUT: 15.0, // $15 per 1M tokens
  OUTPUT: 15.0, // $15 per 1M tokens
  CACHE_CREATION: 15.0, // $15 per 1M tokens
  CACHE_READ: 1.5, // $1.50 per 1M tokens (90% discount)
} as const;

/**
 * Usage Tracking Manager
 *
 * Tracks API usage with accurate cost calculation and real-time event emission.
 * Handles errors gracefully to ensure tracking failures never break API requests.
 */
export class UsageTrackingManager extends EventEmitter {
  private storage: TimeSeriesStorage;
  private fallbackQueue: TrackingEvent[] = [];

  constructor(config?: Partial<StorageConfig>) {
    super();
    this.storage = new TimeSeriesStorage(config);
  }

  /**
   * Track a usage event
   *
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
   *
   * @param event - Usage event to track
   */
  async trackRequest(event: TrackingEvent): Promise<void> {
    try {
      // Calculate cost (Requirement 1.2, 2.1-2.5)
      const cost = this.calculateCost(event.tokens);

      // Create usage event
      const usageEvent: UsageEvent = {
        timestamp: event.timestamp?.getTime() || Date.now(),
        accountId: event.accountId,
        model: event.model,
        region: event.region,
        inputTokens: event.tokens.inputTokens,
        outputTokens: event.tokens.outputTokens,
        cacheCreationTokens: event.tokens.cacheCreationTokens || 0,
        cacheReadTokens: event.tokens.cacheReadTokens || 0,
        cost,
        latency: event.latency,
        status: event.status,
        errorCode: event.errorCode,
      };

      // Store event (Requirement 1.5)
      this.storage.insertEvent(usageEvent);

      // Emit real-time event (Requirement 1.4)
      this.emit('usage_event', usageEvent);

      // Process fallback queue if not empty
      if (this.fallbackQueue.length > 0) {
        await this.processFallbackQueue();
      }
    } catch (error) {
      // Requirement 1.3: Log error and continue without failing
      console.error('Failed to track usage event:', error);

      // Add to fallback queue for retry
      this.fallbackQueue.push(event);

      // Emit error event for monitoring
      this.emit('tracking_error', {
        error,
        event,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Calculate cost based on token usage
   *
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
   *
   * Pricing:
   * - Input tokens: $15 per 1M tokens
   * - Output tokens: $15 per 1M tokens
   * - Cache creation tokens: $15 per 1M tokens
   * - Cache read tokens: $1.50 per 1M tokens (90% discount)
   *
   * @param tokens - Token usage breakdown
   * @returns Total cost in dollars
   */
  calculateCost(tokens: TokenUsage): number {
    const inputCost = (tokens.inputTokens / 1_000_000) * TOKEN_PRICING.INPUT;
    const outputCost = (tokens.outputTokens / 1_000_000) * TOKEN_PRICING.OUTPUT;
    const cacheCreationCost =
      ((tokens.cacheCreationTokens || 0) / 1_000_000) * TOKEN_PRICING.CACHE_CREATION;
    const cacheReadCost = ((tokens.cacheReadTokens || 0) / 1_000_000) * TOKEN_PRICING.CACHE_READ;

    return inputCost + outputCost + cacheCreationCost + cacheReadCost;
  }

  /**
   * Get usage statistics for an account
   *
   * Requirement: 24.1
   *
   * @param accountId - Account ID
   * @param timeRange - Time range to query
   * @returns Usage statistics
   */
  async getAccountUsage(accountId: string, timeRange: TimeRange): Promise<UsageStats> {
    try {
      await Promise.resolve();
      return this.storage.getUsageStats(timeRange, accountId);
    } catch (error) {
      console.error('Failed to get account usage:', error);
      throw error;
    }
  }

  /**
   * Get total usage across all accounts
   *
   * Requirement: 24.2
   *
   * @param timeRange - Time range to query
   * @returns Usage statistics
   */
  async getTotalUsage(timeRange: TimeRange): Promise<UsageStats> {
    try {
      await Promise.resolve();
      return this.storage.getUsageStats(timeRange);
    } catch (error) {
      console.error('Failed to get total usage:', error);
      throw error;
    }
  }

  /**
   * Get usage statistics by model
   *
   * Requirement: 24.3
   *
   * @param model - Model name
   * @param timeRange - Time range to query
   * @returns Usage statistics
   */
  async getUsageByModel(model: string, timeRange: TimeRange): Promise<UsageStats> {
    try {
      const events = this.storage.queryEvents(timeRange);
      const filteredEvents = events.filter((e) => e.model === model);

      // Calculate stats from filtered events
      await Promise.resolve();
      return this.calculateStatsFromEvents(filteredEvents);
    } catch (error) {
      console.error('Failed to get usage by model:', error);
      throw error;
    }
  }

  /**
   * Get usage statistics by region
   *
   * Requirement: 24.4
   *
   * @param region - Region name
   * @param timeRange - Time range to query
   * @returns Usage statistics
   */
  async getUsageByRegion(region: string, timeRange: TimeRange): Promise<UsageStats> {
    try {
      const events = this.storage.queryEvents(timeRange);
      const filteredEvents = events.filter((e) => e.region === region);

      // Calculate stats from filtered events
      await Promise.resolve();
      return this.calculateStatsFromEvents(filteredEvents);
    } catch (error) {
      console.error('Failed to get usage by region:', error);
      throw error;
    }
  }

  /**
   * Process fallback queue
   *
   * Attempts to track events that failed previously
   */
  private async processFallbackQueue(): Promise<void> {
    const queue = [...this.fallbackQueue];
    this.fallbackQueue = [];

    for (const event of queue) {
      try {
        await this.trackRequest(event);
      } catch (error) {
        // If still failing, keep in queue
        this.fallbackQueue.push(event);
      }
    }
  }

  /**
   * Calculate statistics from events
   *
   * Helper method for filtered queries
   */
  private calculateStatsFromEvents(events: UsageEvent[]): UsageStats {
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
        },
      };
    }

    let totalTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let successCount = 0;

    const byModel: Record<string, BreakdownAccumulator> = {};
    const byRegion: Record<string, BreakdownAccumulator> = {};

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
    const modelStats: Record<string, import('./TimeSeriesStorage.types.js').ModelStats> = {};
    for (const [model, stats] of Object.entries(byModel)) {
      modelStats[model] = {
        requests: stats.requests,
        tokens: stats.tokens,
        cost: stats.cost,
        avgLatency: stats.latency / stats.requests,
        successRate: stats.successCount / stats.requests,
      };
    }

    const regionStats: Record<string, import('./TimeSeriesStorage.types.js').RegionStats> = {};
    for (const [region, stats] of Object.entries(byRegion)) {
      regionStats[region] = {
        requests: stats.requests,
        tokens: stats.tokens,
        cost: stats.cost,
        avgLatency: stats.latency / stats.requests,
        successRate: stats.successCount / stats.requests,
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
   * Close storage connection
   */
  close(): void {
    this.storage.close();
  }

  /**
   * Get storage instance (for testing)
   */
  getStorage(): TimeSeriesStorage {
    return this.storage;
  }

  /**
   * Get fallback queue size (for monitoring)
   */
  getFallbackQueueSize(): number {
    return this.fallbackQueue.length;
  }
}
