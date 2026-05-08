/**
 * Tests for Health Monitor Service
 *
 * Tests health check endpoints, status determination, and error sanitization.
 * Uses Fastify inject() for testing without actual HTTP connections.
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */

import { HealthMonitor } from './HealthMonitor.js';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { RedisCacheManager } from './RedisCacheManager.js';
import { RealTimeUpdateService } from './RealTimeUpdateService.js';

// Mock dependencies
const createMockStorage = (healthy = true) => {
  const storage = {} as TimeSeriesStorage;
  if (healthy) {
    Object.defineProperty(storage, 'db', {
      get: () => ({
        prepare: jest.fn().mockReturnValue({
          get: jest.fn().mockReturnValue({ '1': 1 }),
        }),
      }),
      configurable: true,
    });
  } else {
    Object.defineProperty(storage, 'db', {
      get: () => ({
        prepare: jest.fn().mockImplementation(() => {
          throw new Error('The database connection is not open');
        }),
      }),
      configurable: true,
    });
  }
  return storage;
};

const createMockRedis = (healthy = true) => {
  return {
    healthCheck: jest.fn().mockResolvedValue(healthy),
  } as unknown as RedisCacheManager;
};

const createMockRealtimeService = (running = true, clientCount = 0) => {
  return {
    isRunning: jest.fn().mockReturnValue(running),
    getConnectedClientCount: jest.fn().mockReturnValue(clientCount),
  } as unknown as RealTimeUpdateService;
};

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;

  afterEach(async () => {
    if (monitor) {
      await monitor.stop().catch(() => {});
    }
  });

  describe('System Health (/health)', () => {
    it('should return healthy when all components are healthy', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 5),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
      expect(body.timestamp).toBeDefined();
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.components.database.status).toBe('healthy');
      expect(body.components.database.type).toBe('sqlite');
      expect(body.components.redis.status).toBe('healthy');
      expect(body.components.redis.type).toBe('redis');
      expect(body.components.websocket.status).toBe('healthy');
      expect(body.components.websocket.type).toBe('websocket');
      expect(body.components.websocket.connectedClients).toBe(5);
    });

    it('should return unhealthy (503) when database is unhealthy', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(false),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('unhealthy');
      expect(body.components.database.status).toBe('unhealthy');
      expect(body.components.database.error).toBeDefined();
      // Verify no stack traces in error
      expect(body.components.database.error).not.toContain('at ');
      expect(body.components.database.error).not.toContain('Error:');
    });

    it('should return degraded when Redis is unhealthy', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(false),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('degraded');
      expect(body.components.database.status).toBe('healthy');
      expect(body.components.redis.status).toBe('unhealthy');
    });

    it('should return degraded when WebSocket is not running', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(false, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('degraded');
      expect(body.components.websocket.status).toBe('unhealthy');
    });

    it('should return unhealthy when both database and Redis are down', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(false),
        redis: createMockRedis(false),
        realtimeService: createMockRealtimeService(false, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('unhealthy');
    });

    it('should include responseTime for each component', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });

      const body = JSON.parse(response.body);
      expect(body.components.database.responseTime).toBeGreaterThanOrEqual(0);
      expect(body.components.redis.responseTime).toBeGreaterThanOrEqual(0);
      expect(body.components.websocket.responseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Database Health (/health/database)', () => {
    it('should return healthy database status', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/database',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('sqlite');
      expect(body.status).toBe('healthy');
      expect(body.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy (503) when database fails', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(false),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/database',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('sqlite');
      expect(body.status).toBe('unhealthy');
      expect(body.error).toBeDefined();
    });
  });

  describe('Redis Health (/health/redis)', () => {
    it('should return healthy Redis status', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/redis',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('redis');
      expect(body.status).toBe('healthy');
    });

    it('should return unhealthy (503) when Redis fails', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(false),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/redis',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('redis');
      expect(body.status).toBe('unhealthy');
    });
  });

  describe('WebSocket Health (/health/websocket)', () => {
    it('should return healthy WebSocket status with client count', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 3),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/websocket',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('websocket');
      expect(body.status).toBe('healthy');
      expect(body.connectedClients).toBe(3);
    });

    it('should return unhealthy (503) when WebSocket is not running', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(false, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/websocket',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('websocket');
      expect(body.status).toBe('unhealthy');
      expect(body.connectedClients).toBe(0);
    });
  });

  describe('Error Sanitization', () => {
    it('should not expose stack traces in error messages', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(false),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/database',
      });

      const body = JSON.parse(response.body);
      expect(body.error).not.toContain('at ');
      expect(body.error).not.toContain('\n');
      expect(body.error).not.toContain('stack');
    });

    it('should not expose file paths in error messages', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(false),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health/database',
      });

      const body = JSON.parse(response.body);
      expect(body.error).not.toContain('/');
      expect(body.error).not.toContain('.ts');
      expect(body.error).not.toContain('.js');
    });
  });

  describe('Server Lifecycle', () => {
    it('should start and stop the health monitor server', async () => {
      monitor = new HealthMonitor(
        {
          storage: createMockStorage(true),
          redis: createMockRedis(true),
          realtimeService: createMockRealtimeService(true, 0),
        },
        { port: 0 } // Use port 0 for random available port
      );

      await monitor.start();

      // Verify server is listening by making a request
      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });
      expect(response.statusCode).toBe(200);

      await monitor.stop();
    });
  });

  describe('Uptime Tracking', () => {
    it('should track uptime in seconds', async () => {
      monitor = new HealthMonitor({
        storage: createMockStorage(true),
        redis: createMockRedis(true),
        realtimeService: createMockRealtimeService(true, 0),
      });

      // Wait a small amount to verify uptime increases
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await monitor.getServer().inject({
        method: 'GET',
        url: '/health',
      });

      const body = JSON.parse(response.body);
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof body.uptime).toBe('number');
    });
  });
});
