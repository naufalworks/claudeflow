/**
 * Health Monitor Service
 *
 * Provides HTTP health check endpoints using Fastify for monitoring
 * the status of system components (database, Redis, WebSocket).
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */

import Fastify, { FastifyInstance } from 'fastify';
import {
  HealthMonitorConfig,
  DEFAULT_HEALTH_CONFIG,
  SystemHealth,
  SystemStatus,
  DatabaseHealth,
  RedisHealth,
  WebSocketHealth,
} from './HealthMonitor.types.js';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { RedisCacheManager } from './RedisCacheManager.js';
import { RealTimeUpdateService } from './RealTimeUpdateService.js';

/**
 * Dependencies required by the health monitor
 */
export interface HealthMonitorDependencies {
  storage: TimeSeriesStorage;
  redis: RedisCacheManager;
  realtimeService: RealTimeUpdateService;
}

export class HealthMonitor {
  private server: FastifyInstance;
  private config: HealthMonitorConfig;
  private deps: HealthMonitorDependencies;
  private startTime: Date;

  constructor(deps: HealthMonitorDependencies, config?: Partial<HealthMonitorConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
    this.startTime = new Date();
    this.server = Fastify({
      logger: false,
      requestIdHeader: false,
    });

    this.registerRoutes();
  }

  /**
   * Start the health monitor HTTP server
   * Requirements: 21.1
   */
  async start(): Promise<void> {
    await this.server.listen({
      port: this.config.port,
      host: this.config.host,
    });
    console.log(`Health monitor listening on ${this.config.host}:${this.config.port}`);
  }

  /**
   * Stop the health monitor HTTP server
   */
  async stop(): Promise<void> {
    await this.server.close();
    console.log('Health monitor stopped');
  }

  /**
   * Get the Fastify server instance (useful for testing)
   */
  getServer(): FastifyInstance {
    return this.server;
  }

  /**
   * Register all health check routes
   * @private
   */
  private registerRoutes(): void {
    // Overall system health
    this.server.get('/health', async (_request, reply) => {
      const health = await this.checkSystemHealth();
      const statusCode = health.status === 'unhealthy' ? 503 : 200;
      return reply.code(statusCode).send(health);
    });

    // Database health
    this.server.get('/health/database', async (_request, reply) => {
      const health = this.checkDatabaseHealth();
      const statusCode = health.status === 'unhealthy' ? 503 : 200;
      return reply.code(statusCode).send(health);
    });

    // Redis health
    this.server.get('/health/redis', async (_request, reply) => {
      const health = await this.checkRedisHealth();
      const statusCode = health.status === 'unhealthy' ? 503 : 200;
      return reply.code(statusCode).send(health);
    });

    // WebSocket health
    this.server.get('/health/websocket', async (_request, reply) => {
      const health = this.checkWebSocketHealth();
      const statusCode = health.status === 'unhealthy' ? 503 : 200;
      return reply.code(statusCode).send(health);
    });
  }

  /**
   * Check overall system health by aggregating all component checks
   * Requirements: 21.1, 21.5
   */
  async checkSystemHealth(): Promise<SystemHealth> {
    const [database, redis, websocket] = await Promise.all([
      Promise.resolve(this.checkDatabaseHealth()),
      this.checkRedisHealth(),
      Promise.resolve(this.checkWebSocketHealth()),
    ]);

    const status = this.determineSystemStatus(database.status, redis.status, websocket.status);

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      components: { database, redis, websocket },
    };
  }

  /**
   * Check database (SQLite) connectivity
   * Requirements: 21.2
   */
  checkDatabaseHealth(): DatabaseHealth {
    const start = Date.now();
    try {
      // Simple query to verify database is responsive
      const storage = this.deps.storage as unknown as {
        db: { prepare: (sql: string) => { get: () => unknown } };
      };
      storage.db.prepare('SELECT 1').get();

      return {
        type: 'sqlite',
        status: 'healthy',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        type: 'sqlite',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: this.sanitizeError(error),
      };
    }
  }

  /**
   * Check Redis connectivity
   * Requirements: 21.3
   */
  async checkRedisHealth(): Promise<RedisHealth> {
    const start = Date.now();
    try {
      const isHealthy = await this.deps.redis.healthCheck();

      return {
        type: 'redis',
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        type: 'redis',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: this.sanitizeError(error),
      };
    }
  }

  /**
   * Check WebSocket server status
   * Requirements: 21.4
   */
  checkWebSocketHealth(): WebSocketHealth {
    const start = Date.now();
    try {
      const isRunning = this.deps.realtimeService.isRunning();
      const connectedClients = this.deps.realtimeService.getConnectedClientCount();

      return {
        type: 'websocket',
        status: isRunning ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - start,
        connectedClients,
      };
    } catch (error) {
      return {
        type: 'websocket',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        connectedClients: 0,
        error: this.sanitizeError(error),
      };
    }
  }

  /**
   * Determine overall system status based on component statuses
   * - Database is critical: unhealthy → system unhealthy
   * - Redis is non-critical: unhealthy → system degraded
   * - WebSocket is non-critical: unhealthy → system degraded
   *
   * Requirements: 21.5
   * @private
   */
  private determineSystemStatus(
    dbStatus: string,
    redisStatus: string,
    wsStatus: string
  ): SystemStatus {
    // Database is critical
    if (dbStatus === 'unhealthy') {
      return 'unhealthy';
    }

    // Redis or WebSocket degraded means system degraded
    if (redisStatus === 'unhealthy' || wsStatus === 'unhealthy') {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Sanitize error messages to prevent information leakage
   * Returns a generic message without stack traces or internal paths
   * @private
   */
  private sanitizeError(error: unknown): string {
    if (error instanceof Error) {
      // Return only the error name, not the message or stack
      // This prevents leaking file paths, connection strings, etc.
      const name = error.name || 'Error';
      // For known error types, return a safe description
      if (name === 'TypeError' || name === 'Error') {
        return 'Component health check failed';
      }
      return `${name}: check failed`;
    }
    return 'Unknown error during health check';
  }
}
