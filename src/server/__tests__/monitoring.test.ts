/**
 * Integration tests for monitoring endpoints
 */

import { FastifyInstance } from 'fastify';
import { createServer } from '../index.js';
import { Config } from '../../config/index.js';
import { InfrastructureClients } from '../../infrastructure/index.js';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { AnalyticsEngine, RequestMetadata } from '../../analytics/analytics-engine.js';

describe('Monitoring Endpoints', () => {
  let server: FastifyInstance;
  let redis: Redis;
  let analyticsEngine: AnalyticsEngine;

  beforeAll(async () => {
    // Create mock Redis
    redis = new RedisMock() as Redis;
    
    // Create analytics engine
    analyticsEngine = new AnalyticsEngine(redis);
    
    // Create mock infrastructure with proper wrappers
    const infrastructure: InfrastructureClients = {
      redis: {
        connected: true,
        healthCheck: async () => true,
        getClient: () => redis,
        isConnected: () => true,
      } as any,
      qdrant: {
        connected: true,
        healthCheck: async () => true,
      } as any,
      voyage: {
        healthCheck: async () => true,
      } as any,
      anthropic: {
        healthCheck: async () => true,
        getClient: () => ({} as any),
      } as any,
    };
    
    // Create mock config
    const config: Config = {
      server: {
        port: 20129,
        host: '0.0.0.0',
        logLevel: 'error', // Reduce log noise in tests
      },
      infrastructure: {
        qdrant: { url: 'http://localhost:6333' },
        redis: { url: 'redis://localhost:6379' },
        voyage: { apiKey: 'test-key' },
      },
      accounts: [
        {
          id: 'test-account',
          apiKey: 'test-key',
          provider: 'anthropic',
        },
      ],
      optimization: {
        semanticDeduplication: {
          enabled: true,
          similarityThreshold: 0.95,
          cacheTTL: 86400,
        },
        promptCaching: {
          enabled: true,
          minTokens: 1024,
        },
        thinkingBudget: {
          enabled: true,
          simple: 0,
          moderate: 2000,
          complex: 10000,
        },
        contextCompression: {
          enabled: true,
          minTokens: 8000,
          recentMessagesToKeep: 3,
        },
      },
    };
    
    // Create server
    try {
      server = await createServer({ config, infrastructure });
      await server.ready();
    } catch (error) {
      console.error('Failed to create server:', error);
      throw error;
    }
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
    if (redis) {
      redis.disconnect();
    }
  });

  beforeEach(async () => {
    // Clear Redis before each test
    await redis.flushall();
  });

  describe('GET /admin/analytics', () => {
    it('should return analytics with no data', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/admin/analytics',
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('metrics');
      expect(body).toHaveProperty('insights');
      expect(body).toHaveProperty('filter');
      
      expect(body.metrics.totalRequests).toBe(0);
      expect(body.insights).toEqual([]);
    });

    it('should return analytics with sample data', async () => {
      // Add sample data
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'kiro_001',
          accountType: 'kiro',
          provider: 'kiro',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:30:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'moderate',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 200,
          cacheReadTokens: 800,
          thinkingTokens: 100,
          responseTimeMs: 2000,
          cacheHit: true,
          deduplicated: false,
          cacheOptimized: true,
          thinkingOptimized: true,
          contextOptimized: false,
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/admin/analytics',
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.metrics.totalRequests).toBe(2);
      expect(body.metrics.kiroRequests).toBe(1);
      expect(body.metrics.anthropicRequests).toBe(1);
      expect(body.metrics.cacheHitRate).toBe(0.5);
    });

    it('should filter by time range', async () => {
      // Add sample data with different timestamps
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-01T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/admin/analytics?startTime=2026-05-02T00:00:00Z&endTime=2026-05-02T23:59:59Z',
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.metrics.totalRequests).toBe(1); // Only req_002
    });

    it('should filter by model', async () => {
      // Add sample data with different models
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-haiku-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/admin/analytics?model=claude-sonnet-4-20250514',
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.metrics.totalRequests).toBe(1); // Only sonnet
    });

    it('should filter by complexity', async () => {
      // Add sample data with different complexities
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'complex',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 2000,
          outputTokens: 1000,
          responseTimeMs: 3000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/admin/analytics?complexity=simple',
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.metrics.totalRequests).toBe(1); // Only simple
    });

    it('should filter by account type', async () => {
      // Add sample data with different account types
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'kiro_001',
          accountType: 'kiro',
          provider: 'kiro',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/admin/analytics?accountType=kiro',
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.metrics.totalRequests).toBe(1); // Only Kiro
      expect(body.metrics.kiroRequests).toBe(1);
    });

    it('should generate insights', async () => {
      // Add sample data that triggers insights
      const requests: RequestMetadata[] = [];
      
      // Create 100 requests with patterns that trigger insights
      for (let i = 0; i < 100; i++) {
        requests.push({
          requestId: `req_${i}`,
          timestamp: new Date(`2026-05-02T${String(Math.floor(i / 10)).padStart(2, '0')}:${String((i % 10) * 6).padStart(2, '0')}:00Z`),
          model: 'claude-sonnet-4-20250514',
          complexity: i < 60 ? 'simple' : 'moderate',
          accountId: i < 20 ? 'kiro_001' : 'acc_001',
          accountType: i < 20 ? 'kiro' : 'anthropic',
          provider: i < 20 ? 'kiro' : 'anthropic',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: i < 40 ? 800 : 0,
          responseTimeMs: 2000,
          cacheHit: i < 40,
          deduplicated: false,
          cacheOptimized: true,
          thinkingOptimized: true,
          contextOptimized: false,
        });
      }

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/admin/analytics?startTime=2026-05-02T00:00:00Z&endTime=2026-05-02T23:59:59Z',
      });

      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.insights.length).toBeGreaterThan(0);
      
      // Should have low Kiro usage insight (20%)
      const kiroInsight = body.insights.find((i: any) => i.title === 'Low Kiro Account Usage');
      expect(kiroInsight).toBeDefined();
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus metrics with no data', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain; version=0.0.4');
      
      const body = response.body;
      expect(body).toContain('claudeflow_requests_total');
      expect(body).toContain('claudeflow_request_duration_seconds');
      expect(body).toContain('claudeflow_cache_hit_rate');
      expect(body).toContain('claudeflow_optimization_savings_dollars');
    });

    it('should return Prometheus metrics with sample data', async () => {
      // Add sample data
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'kiro_001',
          accountType: 'kiro',
          provider: 'kiro',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:30:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'moderate',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 200,
          cacheReadTokens: 800,
          thinkingTokens: 100,
          responseTimeMs: 2000,
          cacheHit: true,
          deduplicated: false,
          cacheOptimized: true,
          thinkingOptimized: true,
          contextOptimized: false,
          error: false,
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      
      const body = response.body;
      
      // Check for key metrics
      expect(body).toContain('claudeflow_requests_total{status="success"} 2');
      expect(body).toContain('claudeflow_requests_total{account_type="kiro"} 1');
      expect(body).toContain('claudeflow_requests_total{account_type="anthropic"} 1');
      expect(body).toContain('claudeflow_cache_hit_rate 0.5');
      expect(body).toContain('claudeflow_kiro_account_usage_percent 50');
      expect(body).toContain('claudeflow_tokens_total{type="input"} 1500');
      expect(body).toContain('claudeflow_tokens_total{type="output"} 700');
    });

    it('should include error metrics', async () => {
      // Add sample data with errors
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:30:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
          error: true,
          errorType: 'rate_limit',
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      
      const body = response.body;
      
      // Check for error metrics
      expect(body).toContain('claudeflow_requests_total{status="success"} 1');
      expect(body).toContain('claudeflow_requests_total{status="error"} 1');
      expect(body).toContain('claudeflow_error_rate 0.5');
      expect(body).toContain('claudeflow_errors_by_type_total{error_type="rate_limit"} 1');
    });

    it('should include response time percentiles', async () => {
      // Add sample data with various response times
      const requests: RequestMetadata[] = [
        {
          requestId: 'req_001',
          timestamp: new Date('2026-05-02T06:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 1000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_002',
          timestamp: new Date('2026-05-02T06:30:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 2000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
        {
          requestId: 'req_003',
          timestamp: new Date('2026-05-02T07:00:00Z'),
          model: 'claude-sonnet-4-20250514',
          complexity: 'simple',
          accountId: 'acc_001',
          accountType: 'anthropic',
          provider: 'anthropic',
          inputTokens: 500,
          outputTokens: 200,
          responseTimeMs: 3000,
          cacheHit: false,
          deduplicated: false,
          cacheOptimized: false,
          thinkingOptimized: false,
          contextOptimized: false,
        },
      ];

      for (const req of requests) {
        await analyticsEngine.trackRequest(req);
      }

      const response = await server.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      
      const body = response.body;
      
      // Check for percentile metrics
      expect(body).toContain('claudeflow_request_duration_seconds{quantile="0.5"}');
      expect(body).toContain('claudeflow_request_duration_seconds{quantile="0.95"}');
      expect(body).toContain('claudeflow_request_duration_seconds{quantile="0.99"}');
      expect(body).toContain('claudeflow_request_duration_seconds_count 3');
    });
  });
});
