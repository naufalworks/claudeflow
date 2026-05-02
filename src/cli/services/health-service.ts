/**
 * HealthService
 * 
 * System health checks for ClaudeFlow infrastructure
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * Component Status
 */
export interface ComponentStatus {
  name: string;
  healthy: boolean;
  message: string;
  responseTime?: number;
  details?: any;
}

/**
 * Health Check Result
 */
export interface HealthCheckResult {
  overall: boolean;
  components: ComponentStatus[];
  timestamp: string;
}

/**
 * E2E Test Result
 */
export interface E2ETestResult {
  success: boolean;
  message: string;
  responseTime: number;
  details?: any;
}

/**
 * HealthService
 * 
 * Performs health checks on ClaudeFlow infrastructure components
 */
export class HealthService {
  /**
   * Check all components
   */
  async checkAll(
    qdrantUrl: string,
    redisUrl: string,
    voyageApiKey: string,
    mitmRouterUrl: string
  ): Promise<HealthCheckResult> {
    logger.info('Starting health check for all components');

    const components: ComponentStatus[] = [];

    // Check Qdrant
    components.push(await this.checkQdrant(qdrantUrl));

    // Check Redis
    components.push(await this.checkRedis(redisUrl));

    // Check Voyage AI
    components.push(await this.checkVoyageAI(voyageApiKey));

    // Check MITM Router
    components.push(await this.checkMITMRouter(mitmRouterUrl));

    // Check Anthropic API (basic connectivity)
    components.push(await this.checkAnthropicAPI());

    const overall = components.every((c) => c.healthy);

    const result: HealthCheckResult = {
      overall,
      components,
      timestamp: new Date().toISOString(),
    };

    logger.info('Health check completed', { overall, componentCount: components.length });

    return result;
  }

  /**
   * Check Qdrant connectivity
   */
  async checkQdrant(url: string): Promise<ComponentStatus> {
    const startTime = Date.now();

    try {
      logger.debug('Checking Qdrant connectivity', { url });

      const response = await axios.get(`${url}/collections`, {
        timeout: 5000,
      });

      const responseTime = Date.now() - startTime;

      if (response.status === 200) {
        return {
          name: 'Qdrant',
          healthy: true,
          message: 'Connected',
          responseTime,
          details: {
            collections: response.data?.result?.collections?.length || 0,
          },
        };
      } else {
        return {
          name: 'Qdrant',
          healthy: false,
          message: `Unexpected status: ${response.status}`,
          responseTime,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Qdrant health check failed', error);

      return {
        name: 'Qdrant',
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        responseTime,
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  async checkRedis(url: string): Promise<ComponentStatus> {
    const startTime = Date.now();

    try {
      logger.debug('Checking Redis connectivity', { url });

      // Import Redis dynamically
      const { default: Redis } = await import('ioredis');

      const redis = new Redis(url, {
        connectTimeout: 5000,
        maxRetriesPerRequest: 1,
      });

      // Try to ping
      await redis.ping();

      const responseTime = Date.now() - startTime;

      // Get info
      const info = await redis.info('server');
      const version = info.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown';

      await redis.quit();

      return {
        name: 'Redis',
        healthy: true,
        message: 'Connected',
        responseTime,
        details: {
          version,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Redis health check failed', error);

      return {
        name: 'Redis',
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        responseTime,
      };
    }
  }

  /**
   * Check Voyage AI connectivity
   */
  async checkVoyageAI(apiKey: string): Promise<ComponentStatus> {
    const startTime = Date.now();

    try {
      logger.debug('Checking Voyage AI connectivity');

      if (!apiKey || apiKey.trim() === '') {
        return {
          name: 'Voyage AI',
          healthy: false,
          message: 'API key not configured',
          responseTime: 0,
        };
      }

      // Try to get available models
      const response = await axios.get('https://api.voyageai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 5000,
      });

      const responseTime = Date.now() - startTime;

      if (response.status === 200) {
        return {
          name: 'Voyage AI',
          healthy: true,
          message: 'Connected',
          responseTime,
          details: {
            models: response.data?.data?.length || 0,
          },
        };
      } else {
        return {
          name: 'Voyage AI',
          healthy: false,
          message: `Unexpected status: ${response.status}`,
          responseTime,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Voyage AI health check failed', error);

      return {
        name: 'Voyage AI',
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        responseTime,
      };
    }
  }

  /**
   * Check MITM Router connectivity
   */
  async checkMITMRouter(url: string): Promise<ComponentStatus> {
    const startTime = Date.now();

    try {
      logger.debug('Checking MITM Router connectivity', { url });

      // Try to connect to the router
      const response = await axios.get(`${url}/health`, {
        timeout: 5000,
        validateStatus: () => true, // Accept any status
      });

      const responseTime = Date.now() - startTime;

      // MITM router might not have a health endpoint, so any response is good
      if (response.status < 500) {
        return {
          name: 'MITM Router',
          healthy: true,
          message: 'Connected',
          responseTime,
        };
      } else {
        return {
          name: 'MITM Router',
          healthy: false,
          message: `Server error: ${response.status}`,
          responseTime,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('MITM Router health check failed', error);

      return {
        name: 'MITM Router',
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        responseTime,
      };
    }
  }

  /**
   * Check Anthropic API connectivity
   */
  async checkAnthropicAPI(): Promise<ComponentStatus> {
    const startTime = Date.now();

    try {
      logger.debug('Checking Anthropic API connectivity');

      // Just check if the API endpoint is reachable
      await axios.get('https://api.anthropic.com', {
        timeout: 5000,
        validateStatus: () => true,
      });

      const responseTime = Date.now() - startTime;

      // Any response means the API is reachable
      return {
        name: 'Anthropic API',
        healthy: true,
        message: 'Reachable',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Anthropic API health check failed', error);

      return {
        name: 'Anthropic API',
        healthy: false,
        message: error instanceof Error ? error.message : 'Connection failed',
        responseTime,
      };
    }
  }

  /**
   * Run end-to-end test
   * 
   * Sends a test request through ClaudeFlow to verify the entire pipeline
   */
  async runE2ETest(daemonUrl: string): Promise<E2ETestResult> {
    const startTime = Date.now();

    try {
      logger.info('Starting E2E test', { daemonUrl });

      // Send a simple test request
      const response = await axios.post(
        `${daemonUrl}/v1/messages`,
        {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 10,
          messages: [
            {
              role: 'user',
              content: 'Say "test"',
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          timeout: 30000,
        }
      );

      const responseTime = Date.now() - startTime;

      if (response.status === 200 && response.data?.content) {
        return {
          success: true,
          message: 'E2E test passed',
          responseTime,
          details: {
            model: response.data.model,
            usage: response.data.usage,
          },
        };
      } else {
        return {
          success: false,
          message: 'Unexpected response format',
          responseTime,
          details: response.data,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('E2E test failed', error);

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Test failed',
        responseTime,
      };
    }
  }
}
