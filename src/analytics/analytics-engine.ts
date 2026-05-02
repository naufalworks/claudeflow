/**
 * AnalyticsEngine
 * 
 * Tracks and aggregates metrics for ClaudeFlow requests.
 * Stores analytics data in Redis with 7-day TTL.
 */

import { Redis } from 'ioredis';

/**
 * Request metadata for analytics tracking
 */
export interface RequestMetadata {
  requestId: string;
  timestamp: Date;
  model: string;
  complexity: 'simple' | 'moderate' | 'complex';
  accountId: string;
  accountType: 'kiro' | 'anthropic';
  provider: 'kiro' | 'anthropic';
  
  // Token usage
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  thinkingTokens?: number;
  
  // Performance metrics
  responseTimeMs: number;
  cacheHit: boolean;
  deduplicated: boolean;
  
  // Optimization metrics
  cacheOptimized: boolean;
  thinkingOptimized: boolean;
  contextOptimized: boolean;
  compressionRatio?: number;
  
  // Error tracking
  error?: boolean;
  errorType?: string;
  retryCount?: number;
}

/**
 * Aggregated metrics
 */
export interface AggregatedMetrics {
  // Request counts
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  
  // Token usage
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalThinkingTokens: number;
  
  // Cost metrics (approximate)
  totalCost: number;
  costSavings: number;
  
  // Performance metrics
  averageResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  
  // Cache metrics
  cacheHitRate: number;
  deduplicationRate: number;
  
  // Account type breakdown
  kiroRequests: number;
  anthropicRequests: number;
  kiroPercentage: number;
  
  // Error metrics
  errorRate: number;
  errorsByType: Record<string, number>;
  
  // Time range
  startTime: Date;
  endTime: Date;
}

/**
 * Insight types
 */
export type InsightType = 'cost_optimization' | 'performance' | 'quality' | 'reliability';
export type InsightSeverity = 'info' | 'warning' | 'critical';

/**
 * Generated insight
 */
export interface Insight {
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  message: string;
  recommendation: string;
  impact?: string;
  metrics?: Record<string, number | Record<string, number>>;
}

/**
 * Metrics filter options
 */
export interface MetricsFilter {
  startTime?: Date;
  endTime?: Date;
  model?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  accountType?: 'kiro' | 'anthropic';
}

/**
 * AnalyticsEngine class
 */
export class AnalyticsEngine {
  private redis: Redis;
  private readonly ANALYTICS_KEY_PREFIX = 'analytics:request:';
  private readonly ANALYTICS_INDEX_KEY = 'analytics:index';
  private readonly TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Track a request with metadata
   */
  async trackRequest(metadata: RequestMetadata): Promise<void> {
    try {
      const key = `${this.ANALYTICS_KEY_PREFIX}${metadata.requestId}`;
      
      // Store request metadata
      await this.redis.setex(
        key,
        this.TTL_SECONDS,
        JSON.stringify({
          ...metadata,
          timestamp: metadata.timestamp.toISOString(),
        })
      );
      
      // Add to index (sorted set by timestamp)
      await this.redis.zadd(
        this.ANALYTICS_INDEX_KEY,
        metadata.timestamp.getTime(),
        metadata.requestId
      );
      
      // Remove old entries from index (older than 7 days)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      await this.redis.zremrangebyscore(
        this.ANALYTICS_INDEX_KEY,
        '-inf',
        sevenDaysAgo
      );
    } catch (error) {
      console.error('Error tracking request:', error);
      // Don't throw - analytics failures shouldn't break requests
    }
  }

  /**
   * Get aggregated metrics for a time range
   */
  async getMetrics(filter: MetricsFilter = {}): Promise<AggregatedMetrics> {
    try {
      // Default to last 24 hours if no time range specified
      const endTime = filter.endTime || new Date();
      const startTime = filter.startTime || new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
      
      // Get request IDs in time range
      const requestIds = await this.redis.zrangebyscore(
        this.ANALYTICS_INDEX_KEY,
        startTime.getTime(),
        endTime.getTime()
      );
      
      if (requestIds.length === 0) {
        return this.getEmptyMetrics(startTime, endTime);
      }
      
      // Fetch all request metadata
      const pipeline = this.redis.pipeline();
      for (const requestId of requestIds) {
        pipeline.get(`${this.ANALYTICS_KEY_PREFIX}${requestId}`);
      }
      const results = await pipeline.exec();
      
      // Parse metadata and apply filters
      const requests: RequestMetadata[] = [];
      for (const result of results || []) {
        if (result && result[1]) {
          const metadata = JSON.parse(result[1] as string);
          metadata.timestamp = new Date(metadata.timestamp);
          
          // Apply filters
          if (filter.model && metadata.model !== filter.model) continue;
          if (filter.complexity && metadata.complexity !== filter.complexity) continue;
          if (filter.accountType && metadata.accountType !== filter.accountType) continue;
          
          requests.push(metadata);
        }
      }
      
      // Aggregate metrics
      return this.aggregateMetrics(requests, startTime, endTime);
    } catch (error) {
      console.error('Error getting metrics:', error);
      throw error;
    }
  }

  /**
   * Aggregate metrics from request metadata
   */
  private aggregateMetrics(
    requests: RequestMetadata[],
    startTime: Date,
    endTime: Date
  ): AggregatedMetrics {
    if (requests.length === 0) {
      return this.getEmptyMetrics(startTime, endTime);
    }
    
    // Initialize counters
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let totalThinkingTokens = 0;
    let cacheHits = 0;
    let deduplicated = 0;
    let kiroRequests = 0;
    let anthropicRequests = 0;
    const responseTimes: number[] = [];
    const errorsByType: Record<string, number> = {};
    
    // Process each request
    for (const req of requests) {
      totalRequests++;
      
      if (req.error) {
        failedRequests++;
        const errorType = req.errorType || 'unknown';
        errorsByType[errorType] = (errorsByType[errorType] || 0) + 1;
      } else {
        successfulRequests++;
      }
      
      totalInputTokens += req.inputTokens;
      totalOutputTokens += req.outputTokens;
      totalCacheCreationTokens += req.cacheCreationTokens || 0;
      totalCacheReadTokens += req.cacheReadTokens || 0;
      totalThinkingTokens += req.thinkingTokens || 0;
      
      if (req.cacheHit) cacheHits++;
      if (req.deduplicated) deduplicated++;
      
      if (req.accountType === 'kiro') {
        kiroRequests++;
      } else {
        anthropicRequests++;
      }
      
      responseTimes.push(req.responseTimeMs);
    }
    
    // Calculate cost (approximate Anthropic pricing)
    // Input: $3 per million tokens, Output: $15 per million tokens
    // Cache creation: $3.75 per million tokens, Cache read: $0.30 per million tokens
    const inputCost = (totalInputTokens / 1_000_000) * 3;
    const outputCost = (totalOutputTokens / 1_000_000) * 15;
    const cacheCreationCost = (totalCacheCreationTokens / 1_000_000) * 3.75;
    const cacheReadCost = (totalCacheReadTokens / 1_000_000) * 0.30;
    const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
    
    // Calculate cost savings from Kiro accounts (assume 100% savings)
    const kiroSavings = kiroRequests > 0 ? (kiroRequests / totalRequests) * totalCost : 0;
    
    // Calculate cache savings (cache reads are 90% cheaper than regular input)
    const cacheSavings = (totalCacheReadTokens / 1_000_000) * (3 - 0.30);
    
    const costSavings = kiroSavings + cacheSavings;
    
    // Calculate percentiles
    responseTimes.sort((a, b) => a - b);
    const p50 = this.percentile(responseTimes, 0.50);
    const p95 = this.percentile(responseTimes, 0.95);
    const p99 = this.percentile(responseTimes, 0.99);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    
    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreationTokens,
      totalCacheReadTokens,
      totalThinkingTokens,
      totalCost,
      costSavings,
      averageResponseTime: avgResponseTime,
      p50ResponseTime: p50,
      p95ResponseTime: p95,
      p99ResponseTime: p99,
      cacheHitRate: cacheHits / totalRequests,
      deduplicationRate: deduplicated / totalRequests,
      kiroRequests,
      anthropicRequests,
      kiroPercentage: (kiroRequests / totalRequests) * 100,
      errorRate: failedRequests / totalRequests,
      errorsByType,
      startTime,
      endTime,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Get empty metrics structure
   */
  private getEmptyMetrics(startTime: Date, endTime: Date): AggregatedMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalThinkingTokens: 0,
      totalCost: 0,
      costSavings: 0,
      averageResponseTime: 0,
      p50ResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      cacheHitRate: 0,
      deduplicationRate: 0,
      kiroRequests: 0,
      anthropicRequests: 0,
      kiroPercentage: 0,
      errorRate: 0,
      errorsByType: {},
      startTime,
      endTime,
    };
  }

  /**
   * Generate actionable insights from metrics
   */
  async generateInsights(filter: MetricsFilter = {}): Promise<Insight[]> {
    try {
      const metrics = await this.getMetrics(filter);
      const insights: Insight[] = [];

      // Insight 1: Low Kiro account usage
      if (metrics.totalRequests >= 100 && metrics.kiroPercentage < 50) {
        insights.push({
          type: 'cost_optimization',
          severity: 'warning',
          title: 'Low Kiro Account Usage',
          message: `Only ${metrics.kiroPercentage.toFixed(1)}% of requests are using free Kiro accounts`,
          recommendation: 'Increase Kiro account usage to reduce costs. Configure more Kiro accounts or adjust account selection strategy.',
          impact: `Potential savings: $${((1 - metrics.kiroPercentage / 100) * metrics.totalCost).toFixed(2)}`,
          metrics: {
            kiroPercentage: metrics.kiroPercentage,
            potentialSavings: (1 - metrics.kiroPercentage / 100) * metrics.totalCost,
          },
        });
      }

      // Insight 2: Low cache hit rate
      if (metrics.totalRequests > 50 && metrics.cacheHitRate < 0.7) {
        insights.push({
          type: 'cost_optimization',
          severity: 'warning',
          title: 'Low Cache Hit Rate',
          message: `Cache hit rate is ${(metrics.cacheHitRate * 100).toFixed(1)}%, below target of 90%`,
          recommendation: 'Review cache marker placement strategy. Consider adjusting cache optimization thresholds or increasing cache TTL.',
          impact: `Potential savings: $${((0.9 - metrics.cacheHitRate) * metrics.totalCost * 0.3).toFixed(2)}`,
          metrics: {
            currentCacheHitRate: metrics.cacheHitRate,
            targetCacheHitRate: 0.9,
          },
        });
      }

      // Insight 3: High error rate
      if (metrics.totalRequests >= 20 && metrics.errorRate > 0.05) {
        insights.push({
          type: 'reliability',
          severity: metrics.errorRate > 0.1 ? 'critical' : 'warning',
          title: 'High Error Rate',
          message: `Error rate is ${(metrics.errorRate * 100).toFixed(1)}%, above acceptable threshold of 5%`,
          recommendation: 'Investigate error causes and implement fixes. Check account quotas, API connectivity, and request validation.',
          impact: `${metrics.failedRequests} failed requests out of ${metrics.totalRequests}`,
          metrics: {
            errorRate: metrics.errorRate,
            failedRequests: metrics.failedRequests,
            errorsByType: metrics.errorsByType,
          },
        });
      }

      // Insight 4: Slow response times
      if (metrics.totalRequests > 20 && metrics.p95ResponseTime > 5000) {
        insights.push({
          type: 'performance',
          severity: metrics.p95ResponseTime > 10000 ? 'critical' : 'warning',
          title: 'Slow Response Times',
          message: `P95 response time is ${metrics.p95ResponseTime}ms, above target of 5000ms`,
          recommendation: 'Optimize request processing pipeline. Consider enabling parallel streaming or reducing context optimization overhead.',
          impact: 'User experience degradation',
          metrics: {
            p50ResponseTime: metrics.p50ResponseTime,
            p95ResponseTime: metrics.p95ResponseTime,
            p99ResponseTime: metrics.p99ResponseTime,
          },
        });
      }

      // Insight 5: High deduplication rate (positive insight)
      if (metrics.totalRequests > 50 && metrics.deduplicationRate > 0.3) {
        insights.push({
          type: 'cost_optimization',
          severity: 'info',
          title: 'Excellent Deduplication Rate',
          message: `Semantic deduplication is working well with ${(metrics.deduplicationRate * 100).toFixed(1)}% hit rate`,
          recommendation: 'Continue current deduplication strategy. Monitor for any changes in usage patterns.',
          impact: `Estimated savings: $${(metrics.deduplicationRate * metrics.totalCost * 0.4).toFixed(2)}`,
          metrics: {
            deduplicationRate: metrics.deduplicationRate,
            estimatedSavings: metrics.deduplicationRate * metrics.totalCost * 0.4,
          },
        });
      }

      // Insight 6: Cost analysis by complexity
      const requestsByComplexity = await this.getRequestsByComplexity(filter);
      if (requestsByComplexity.simple > 0 && requestsByComplexity.simpleCostPercentage > 40) {
        insights.push({
          type: 'cost_optimization',
          severity: 'warning',
          title: 'High Cost on Simple Requests',
          message: `${requestsByComplexity.simpleCostPercentage.toFixed(1)}% of costs are on simple requests`,
          recommendation: 'Consider using Claude Haiku for simple requests to reduce costs by 80%. Review request classification thresholds.',
          impact: `Potential savings: $${(requestsByComplexity.simpleCostPercentage / 100 * metrics.totalCost * 0.8).toFixed(2)}`,
          metrics: {
            simpleRequests: requestsByComplexity.simple,
            simpleCostPercentage: requestsByComplexity.simpleCostPercentage,
          },
        });
      }

      // Insight 7: Excellent cache hit rate (positive insight)
      if (metrics.totalRequests > 50 && metrics.cacheHitRate > 0.9) {
        insights.push({
          type: 'cost_optimization',
          severity: 'info',
          title: 'Excellent Cache Performance',
          message: `Cache hit rate is ${(metrics.cacheHitRate * 100).toFixed(1)}%, exceeding target of 90%`,
          recommendation: 'Cache optimization is working excellently. Continue current strategy.',
          impact: `Estimated savings: $${metrics.costSavings.toFixed(2)}`,
          metrics: {
            cacheHitRate: metrics.cacheHitRate,
            costSavings: metrics.costSavings,
          },
        });
      }

      // Insight 8: Low deduplication rate
      if (metrics.totalRequests > 50 && metrics.deduplicationRate <= 0.1) {
        insights.push({
          type: 'cost_optimization',
          severity: 'info',
          title: 'Low Semantic Deduplication',
          message: `Deduplication rate is ${(metrics.deduplicationRate * 100).toFixed(1)}%, indicating unique requests`,
          recommendation: 'This is normal for diverse workloads. If requests are repetitive, consider adjusting similarity threshold.',
          impact: 'No action needed unless requests are expected to be similar',
          metrics: {
            deduplicationRate: metrics.deduplicationRate,
          },
        });
      }

      // Sort insights by severity (critical > warning > info)
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      return insights;
    } catch (error) {
      console.error('Error generating insights:', error);
      throw error;
    }
  }

  /**
   * Get request breakdown by complexity
   */
  private async getRequestsByComplexity(filter: MetricsFilter): Promise<{
    simple: number;
    moderate: number;
    complex: number;
    simpleCostPercentage: number;
  }> {
    try {
      // Get requests for each complexity level
      const simpleMetrics = await this.getMetrics({ ...filter, complexity: 'simple' });
      const moderateMetrics = await this.getMetrics({ ...filter, complexity: 'moderate' });
      const complexMetrics = await this.getMetrics({ ...filter, complexity: 'complex' });
      
      const totalCost = simpleMetrics.totalCost + moderateMetrics.totalCost + complexMetrics.totalCost;
      const simpleCostPercentage = totalCost > 0 ? (simpleMetrics.totalCost / totalCost) * 100 : 0;
      
      return {
        simple: simpleMetrics.totalRequests,
        moderate: moderateMetrics.totalRequests,
        complex: complexMetrics.totalRequests,
        simpleCostPercentage,
      };
    } catch (error) {
      console.error('Error getting requests by complexity:', error);
      return {
        simple: 0,
        moderate: 0,
        complex: 0,
        simpleCostPercentage: 0,
      };
    }
  }
}
