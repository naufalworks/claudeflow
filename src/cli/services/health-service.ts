/**
 * HealthService
 * 
 * System health checks for ClaudeFlow infrastructure
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';
import type { Account, AnthropicAccount, ProxyAccount, OAuthAccount } from '../../config/schema.js';
import { AuthManager } from '../../auth/AuthManager.js';
import { AnthropicClient } from '../../clients/AnthropicClient.js';
import { ProxyClient } from '../../clients/ProxyClient.js';
import { OAuthClient } from '../../clients/OAuthClient.js';

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
 * Timeout for individual account health checks (5 seconds)
 */
const ACCOUNT_CHECK_TIMEOUT_MS = 5000;

/**
 * HealthService
 * 
 * Performs health checks on ClaudeFlow infrastructure components and accounts
 */
export class HealthService {
  private authManager: AuthManager;
  private anthropicClient: AnthropicClient;
  private proxyClient: ProxyClient;
  private oauthClient: OAuthClient;

  constructor() {
    this.authManager = new AuthManager();
    this.anthropicClient = new AnthropicClient();
    this.proxyClient = new ProxyClient();
    this.oauthClient = new OAuthClient();
  }

  /**
   * Check all components and accounts
   */
  async checkAll(
    accounts: Account[],
    qdrantUrl: string,
    redisUrl: string,
    voyageApiKey: string
  ): Promise<HealthCheckResult> {
    logger.info('Starting health check for all components');

    const components: ComponentStatus[] = [];

    // Check infrastructure components
    components.push(await this.checkQdrant(qdrantUrl));
    components.push(await this.checkRedis(redisUrl));
    components.push(await this.checkVoyageAI(voyageApiKey));
    components.push(await this.checkAnthropicAPI());

    // Check all configured accounts
    const accountChecks = await this.checkAccounts(accounts);
    components.push(...accountChecks);

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
   * Check all configured accounts
   * 
   * Runs health checks in parallel for all accounts.
   * Each check is independent and won't block others.
   */
  private async checkAccounts(accounts: Account[]): Promise<ComponentStatus[]> {
    if (accounts.length === 0) {
      return [];
    }

    logger.info('Checking account health', { accountCount: accounts.length });

    // Check all accounts in parallel with timeout protection
    const checks = accounts.map((account) => 
      this.withTimeout(
        this.checkAccount(account),
        ACCOUNT_CHECK_TIMEOUT_MS,
        {
          name: `Account: ${account.id}`,
          healthy: false,
          message: 'Health check timed out',
          responseTime: ACCOUNT_CHECK_TIMEOUT_MS,
        }
      )
    );

    const results = await Promise.allSettled(checks);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Log error internally but return sanitized message
        logger.error('Account health check failed', {
          accountId: accounts[index].id,
          error: result.reason,
        });

        return {
          name: `Account: ${accounts[index].id}`,
          healthy: false,
          message: 'Health check failed',
          responseTime: 0,
        };
      }
    });
  }

  /**
   * Check a single account based on its provider type
   */
  private async checkAccount(account: Account): Promise<ComponentStatus> {
    const startTime = Date.now();

    try {
      switch (account.provider) {
        case 'anthropic':
          return await this.checkAnthropicAccount(account, startTime);
        case 'proxy':
          return await this.checkProxyAccount(account, startTime);
        case 'kiro':
          return await this.checkOAuthAccount(account, startTime);
        default:
          // TypeScript exhaustiveness check - this should never happen
          return {
            name: `Account: ${(account as Account).id}`,
            healthy: false,
            message: 'Unknown account type',
            responseTime: Date.now() - startTime,
          };
      }
    } catch (error) {
      // Log error internally
      logger.error('Account health check error', {
        accountId: account.id,
        provider: account.provider,
        error,
      });

      return {
        name: `Account: ${account.id}`,
        healthy: false,
        message: 'Health check failed',
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check Direct Anthropic account
   */
  private async checkAnthropicAccount(
    account: AnthropicAccount,
    startTime: number
  ): Promise<ComponentStatus> {
    try {
      const success = await this.anthropicClient.testConnection(account.apiKey);
      const responseTime = Date.now() - startTime;

      if (success) {
        return {
          name: `Account: ${account.id} (Direct Anthropic)`,
          healthy: true,
          message: 'Connected',
          responseTime,
          details: { provider: 'anthropic' },
        };
      } else {
        return {
          name: `Account: ${account.id} (Direct Anthropic)`,
          healthy: false,
          message: 'Connection test failed',
          responseTime,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // Sanitize error message
      const message = error instanceof Error && error.message.includes('authentication')
        ? 'Authentication failed'
        : 'Connection failed';

      logger.error('Anthropic account health check failed', {
        accountId: account.id,
        error,
      });

      return {
        name: `Account: ${account.id} (Direct Anthropic)`,
        healthy: false,
        message,
        responseTime,
      };
    }
  }

  /**
   * Check Proxy account
   * 
   * Tests connectivity and validates response format.
   * Reports if proxy returns non-Anthropic format.
   */
  private async checkProxyAccount(
    account: ProxyAccount,
    startTime: number
  ): Promise<ComponentStatus> {
    try {
      const success = await this.proxyClient.testConnection(
        account.apiKey,
        account.baseURL
      );
      const responseTime = Date.now() - startTime;

      if (success) {
        return {
          name: `Account: ${account.id} (Proxy)`,
          healthy: true,
          message: 'Connected - Raw Anthropic format verified',
          responseTime,
          details: { provider: 'proxy' },
        };
      } else {
        return {
          name: `Account: ${account.id} (Proxy)`,
          healthy: false,
          message: 'Connection test failed',
          responseTime,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : '';

      // Check if error is due to format validation
      const isFormatError = errorMessage.includes('non-Anthropic format');
      const isAuthError = errorMessage.includes('authentication');

      let message: string;
      if (isFormatError) {
        message = 'Proxy returns non-Anthropic format - Use direct Anthropic account';
      } else if (isAuthError) {
        message = 'Authentication failed';
      } else {
        message = 'Connection failed';
      }

      logger.error('Proxy account health check failed', {
        accountId: account.id,
        isFormatError,
        error,
      });

      return {
        name: `Account: ${account.id} (Proxy)`,
        healthy: false,
        message,
        responseTime,
      };
    }
  }

  /**
   * Check OAuth account
   * 
   * Authenticates first to get session token, then tests connection.
   */
  private async checkOAuthAccount(
    account: OAuthAccount,
    startTime: number
  ): Promise<ComponentStatus> {
    try {
      // Authenticate to get session token
      const authResult = await this.authManager.authenticate(account);

      if (!authResult.success) {
        return {
          name: `Account: ${account.id} (OAuth)`,
          healthy: false,
          message: 'Authentication failed',
          responseTime: Date.now() - startTime,
        };
      }

      // Test connection with session token
      const success = await this.oauthClient.testConnection(
        authResult.sessionToken!,
        account.kiroConfig.mitmRouterUrl
      );
      const responseTime = Date.now() - startTime;

      if (success) {
        return {
          name: `Account: ${account.id} (OAuth)`,
          healthy: true,
          message: 'Connected - OAuth authenticated',
          responseTime,
          details: { provider: 'kiro' },
        };
      } else {
        return {
          name: `Account: ${account.id} (OAuth)`,
          healthy: false,
          message: 'Connection test failed',
          responseTime,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : '';

      // Sanitize error message
      const isAuthError = errorMessage.includes('authentication') || errorMessage.includes('session');
      const message = isAuthError ? 'Authentication failed' : 'Connection failed';

      logger.error('OAuth account health check failed', {
        accountId: account.id,
        error,
      });

      return {
        name: `Account: ${account.id} (OAuth)`,
        healthy: false,
        message,
        responseTime,
      };
    }
  }

  /**
   * Wrap a promise with a timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutValue: T
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs)),
    ]);
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
