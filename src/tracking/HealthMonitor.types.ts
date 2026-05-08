/**
 * Type definitions for Health Monitor
 *
 * Defines types for health check responses and configuration.
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */

/**
 * Health status of an individual component
 */
export type ComponentStatus = 'healthy' | 'unhealthy';

/**
 * Overall system health status
 * - healthy: all components operational
 * - degraded: non-critical components failing
 * - unhealthy: critical components failing
 */
export type SystemStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health check response for a single component
 */
export interface ComponentHealth {
  status: ComponentStatus;
  responseTime: number;
  error?: string;
}

/**
 * Database (SQLite) health response
 */
export interface DatabaseHealth extends ComponentHealth {
  type: 'sqlite';
}

/**
 * Redis health response
 */
export interface RedisHealth extends ComponentHealth {
  type: 'redis';
}

/**
 * WebSocket server health response
 */
export interface WebSocketHealth extends ComponentHealth {
  type: 'websocket';
  connectedClients: number;
}

/**
 * Overall system health response
 * Requirements: 21.1, 21.5
 */
export interface SystemHealth {
  status: SystemStatus;
  timestamp: string;
  uptime: number;
  components: {
    database: DatabaseHealth;
    redis: RedisHealth;
    websocket: WebSocketHealth;
  };
}

/**
 * Health monitor configuration
 */
export interface HealthMonitorConfig {
  port: number;
  host: string;
}

/**
 * Default health monitor configuration
 */
export const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  port: 8081,
  host: 'localhost',
};
