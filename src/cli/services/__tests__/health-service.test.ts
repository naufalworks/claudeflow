/**
 * HealthService Unit Tests
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { checkAll, checkQdrant, checkRedis, checkVoyage, checkAnthropic, checkMITMRouter, runE2ETest } from '../health-service.js';
import type { ComponentStatus } from '../../types/cli.types.js';

// Mock axios
jest.mock('axios');

describe('HealthService', () => {
  let mockAxios: any;

  beforeEach(async () => {
    // Get mocked axios
    const axiosModule = await import('axios');
    mockAxios = axiosModule.default;

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('checkQdrant', () => {
    it('should return healthy status for successful connection', async () => {
      mockAxios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { version: '1.0.0' },
      });

      const status = await checkQdrant('http://localhost:6333');

      expect(status.healthy).toBe(true);
      expect(status.message).toContain('Connected');
      expect(status.responseTime).toBeGreaterThan(0);
    });

    it('should return unhealthy status for connection failure', async () => {
      mockAxios.get = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const status = await checkQdrant('http://localhost:6333');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Connection refused');
    });

    it('should return unhealthy status for timeout', async () => {
      mockAxios.get = jest.fn().mockRejectedValue({ code: 'ECONNABORTED' });

      const status = await checkQdrant('http://localhost:6333');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('timeout');
    });
  });

  describe('checkRedis', () => {
    it('should return healthy status for successful connection', async () => {
      // Mock Redis client
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG'),
        disconnect: jest.fn().mockResolvedValue(undefined),
      };

      // Mock createClient
      const { createClient } = await import('redis');
      (createClient as jest.Mock) = jest.fn().mockReturnValue(mockRedisClient);

      const status = await checkRedis('redis://localhost:6379');

      expect(status.healthy).toBe(true);
      expect(status.message).toContain('Connected');
    });

    it('should return unhealthy status for connection failure', async () => {
      // Mock Redis client that fails
      const mockRedisClient = {
        ping: jest.fn().mockRejectedValue(new Error('Connection refused')),
        disconnect: jest.fn().mockResolvedValue(undefined),
      };

      const { createClient } = await import('redis');
      (createClient as jest.Mock) = jest.fn().mockReturnValue(mockRedisClient);

      const status = await checkRedis('redis://localhost:6379');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Connection refused');
    });
  });

  describe('checkVoyage', () => {
    it('should return healthy status for valid API key', async () => {
      mockAxios.post = jest.fn().mockResolvedValue({
        status: 200,
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const status = await checkVoyage('voyage-test-key');

      expect(status.healthy).toBe(true);
      expect(status.message).toContain('API key valid');
    });

    it('should return unhealthy status for invalid API key', async () => {
      mockAxios.post = jest.fn().mockRejectedValue({
        response: { status: 401 },
      });

      const status = await checkVoyage('invalid-key');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Invalid API key');
    });

    it('should return unhealthy status for connection failure', async () => {
      mockAxios.post = jest.fn().mockRejectedValue(new Error('Network error'));

      const status = await checkVoyage('voyage-test-key');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Network error');
    });
  });

  describe('checkAnthropic', () => {
    it('should return healthy status for valid API key', async () => {
      mockAxios.post = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          content: [{ text: 'Hello' }],
        },
      });

      const status = await checkAnthropic('sk-ant-test-key');

      expect(status.healthy).toBe(true);
      expect(status.message).toContain('API key valid');
    });

    it('should return unhealthy status for invalid API key', async () => {
      mockAxios.post = jest.fn().mockRejectedValue({
        response: { status: 401 },
      });

      const status = await checkAnthropic('invalid-key');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Invalid API key');
    });

    it('should return unhealthy status for connection failure', async () => {
      mockAxios.post = jest.fn().mockRejectedValue(new Error('Network error'));

      const status = await checkAnthropic('sk-ant-test-key');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Network error');
    });
  });

  describe('checkMITMRouter', () => {
    it('should return healthy status for successful connection', async () => {
      mockAxios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      const status = await checkMITMRouter('http://localhost:20128');

      expect(status.healthy).toBe(true);
      expect(status.message).toContain('Connected');
    });

    it('should return unhealthy status for connection failure', async () => {
      mockAxios.get = jest.fn().mockRejectedValue(new Error('Connection refused'));

      const status = await checkMITMRouter('http://localhost:20128');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Connection refused');
    });
  });

  describe('runE2ETest', () => {
    it('should return healthy status for successful E2E test', async () => {
      mockAxios.post = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          content: [{ text: 'Test response' }],
        },
      });

      const status = await runE2ETest('http://localhost:3000');

      expect(status.healthy).toBe(true);
      expect(status.message).toContain('E2E test passed');
      expect(status.responseTime).toBeGreaterThan(0);
    });

    it('should return unhealthy status for failed E2E test', async () => {
      mockAxios.post = jest.fn().mockRejectedValue(new Error('Request failed'));

      const status = await runE2ETest('http://localhost:3000');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Request failed');
    });

    it('should return unhealthy status for invalid response', async () => {
      mockAxios.post = jest.fn().mockResolvedValue({
        status: 200,
        data: { invalid: 'response' },
      });

      const status = await runE2ETest('http://localhost:3000');

      expect(status.healthy).toBe(false);
      expect(status.message).toContain('Invalid response');
    });
  });

  describe('checkAll', () => {
    beforeEach(() => {
      // Mock all check functions to return healthy
      mockAxios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { status: 'ok' },
      });

      mockAxios.post = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          content: [{ text: 'Test' }],
        },
      });
    });

    it('should check all components', async () => {
      const results = await checkAll({
        qdrantUrl: 'http://localhost:6333',
        redisUrl: 'redis://localhost:6379',
        voyageApiKey: 'voyage-key',
        anthropicApiKey: 'sk-ant-key',
        mitmRouterUrl: 'http://localhost:20128',
        daemonUrl: 'http://localhost:3000',
      });

      expect(results.qdrant).toBeDefined();
      expect(results.redis).toBeDefined();
      expect(results.voyage).toBeDefined();
      expect(results.anthropic).toBeDefined();
      expect(results.mitmRouter).toBeDefined();
      expect(results.e2e).toBeDefined();
    });

    it('should handle partial failures', async () => {
      // Mock Qdrant to fail
      mockAxios.get = jest.fn().mockImplementation((url: string) => {
        if (url.includes('6333')) {
          return Promise.reject(new Error('Qdrant connection failed'));
        }
        return Promise.resolve({ status: 200, data: { status: 'ok' } });
      });

      const results = await checkAll({
        qdrantUrl: 'http://localhost:6333',
        redisUrl: 'redis://localhost:6379',
        voyageApiKey: 'voyage-key',
        anthropicApiKey: 'sk-ant-key',
        mitmRouterUrl: 'http://localhost:20128',
        daemonUrl: 'http://localhost:3000',
      });

      expect(results.qdrant.healthy).toBe(false);
      expect(results.redis.healthy).toBe(true);
    });

    it('should include response times', async () => {
      const results = await checkAll({
        qdrantUrl: 'http://localhost:6333',
        redisUrl: 'redis://localhost:6379',
        voyageApiKey: 'voyage-key',
        anthropicApiKey: 'sk-ant-key',
        mitmRouterUrl: 'http://localhost:20128',
        daemonUrl: 'http://localhost:3000',
      });

      expect(results.qdrant.responseTime).toBeGreaterThanOrEqual(0);
      expect(results.redis.responseTime).toBeGreaterThanOrEqual(0);
    });
  });
});
