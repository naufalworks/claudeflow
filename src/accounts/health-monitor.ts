/**
 * Health Monitor Implementation
 * 
 * Periodic health checks for account availability monitoring.
 * Performs minimal API calls every 5 minutes, marks accounts unhealthy
 * after 3 consecutive failures, tracks response times and error types.
 * 
 * Requirements: 15.1-15.10
 */

import { ClaudeFlowError } from '../errors/kiro-errors.js';
import { KiroAPIClient } from '../clients/KiroAPIClient.js';
import { LogSanitizer } from '../utils/log-sanitizer.js';

/**
 * Token provider callback function
 * Returns access token for the specified account
 */
export type TokenProvider = (accountId: string) => Promise<string>;

/**
 * Health check error types for classification
 */
export enum HealthCheckErrorType {
  NETWORK = 'network',
  AUTH = 'auth',
  RATE_LIMIT = 'rate_limit',
  SERVER = 'server',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  accountId: string;
  healthy: boolean;
  lastCheck: Date;
  consecutiveFailures: number;
  lastError?: string;
  errorType?: HealthCheckErrorType;
  responseTime?: number;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /**
   * Interval between health checks in milliseconds
   * Must be between 60000ms (1 minute) and 3600000ms (1 hour)
   * @default 300000 (5 minutes)
   */
  checkInterval: number;

  /**
   * Number of consecutive failures before marking unhealthy
   * Must be between 1 and 10
   * @default 3
   */
  failureThreshold: number;

  /**
   * Health check timeout in milliseconds
   * Must be between 1000ms and 30000ms
   * @default 10000 (10 seconds)
   */
  timeout: number;
}

/**
 * Error thrown when health monitor configuration is invalid
 */
export class HealthMonitorConfigError extends ClaudeFlowError {
  constructor(message: string) {
    super(message, 'HEALTH_MONITOR_CONFIG_ERROR', undefined, false);
  }
}

/**
 * Health Monitor for periodic account health checks
 * 
 * Features:
 * - Periodic health checks (every 5 minutes by default)
 * - Minimal API call: max_tokens: 1, messages: [{role: "user", content: "test"}]
 * - Failure tracking: Mark unhealthy after 3 consecutive failures
 * - Error classification: network, auth, rate_limit, server, timeout, unknown
 * - Response time tracking
 * 
 * Security:
 * - TokenProvider callback for secure token retrieval (no hardcoded credentials)
 * - Proper type safety with KiroAPIClient
 * - Error message sanitization with LogSanitizer
 * - Input validation on all parameters
 * - Race condition prevention with isRunning flag
 */
export class HealthMonitor {
  private readonly accountId: string;
  private readonly apiClient: KiroAPIClient;
  private readonly tokenProvider: TokenProvider;
  private readonly config: HealthCheckConfig;
  private currentStatus: HealthCheckResult | null = null;
  private checkInterval?: NodeJS.Timeout;
  private isRunning: boolean = false;

  /**
   * Create a new health monitor
   * 
   * @param accountId - Account identifier (must match pattern: kiro-[a-f0-9]+)
   * @param apiClient - KiroAPIClient instance for making health check requests
   * @param tokenProvider - Callback function to retrieve access tokens
   * @param config - Health check configuration (optional)
   * @throws {HealthMonitorConfigError} If accountId or config is invalid
   */
  constructor(
    accountId: string,
    apiClient: KiroAPIClient,
    tokenProvider: TokenProvider,
    config?: Partial<HealthCheckConfig>
  ) {
    this.validateAccountId(accountId);
    this.validateApiClient(apiClient);
    this.validateTokenProvider(tokenProvider);

    this.accountId = accountId;
    this.apiClient = apiClient;
    this.tokenProvider = tokenProvider;

    // Set defaults and validate config
    const defaultConfig: HealthCheckConfig = {
      checkInterval: 300000, // 5 minutes
      failureThreshold: 3,
      timeout: 10000, // 10 seconds
    };

    this.config = {
      checkInterval: config?.checkInterval ?? defaultConfig.checkInterval,
      failureThreshold: config?.failureThreshold ?? defaultConfig.failureThreshold,
      timeout: config?.timeout ?? defaultConfig.timeout,
    };

    this.validateConfig(this.config);
  }

  /**
   * Validate account ID format
   * @throws {HealthMonitorConfigError} If accountId is invalid
   */
  private validateAccountId(accountId: string): void {
    if (!accountId || typeof accountId !== 'string') {
      throw new HealthMonitorConfigError('accountId must be a non-empty string');
    }

    if (accountId.length < 5 || accountId.length > 64) {
      throw new HealthMonitorConfigError(
        'accountId length must be between 5 and 64 characters'
      );
    }

    const accountIdPattern = /^kiro-[a-f0-9]+$/;
    if (!accountIdPattern.test(accountId)) {
      throw new HealthMonitorConfigError(
        'accountId must match pattern: kiro-[a-f0-9]+ (e.g., kiro-abc123)'
      );
    }
  }

  /**
   * Validate API client
   * @throws {HealthMonitorConfigError} If apiClient is invalid
   */
  private validateApiClient(apiClient: any): void {
    if (!apiClient || typeof apiClient !== 'object') {
      throw new HealthMonitorConfigError('apiClient must be a valid KiroAPIClient instance');
    }

    if (typeof apiClient.sendRequest !== 'function') {
      throw new HealthMonitorConfigError(
        'apiClient must have a sendRequest method'
      );
    }
  }

  /**
   * Validate token provider
   * @throws {HealthMonitorConfigError} If tokenProvider is invalid
   */
  private validateTokenProvider(tokenProvider: any): void {
    if (typeof tokenProvider !== 'function') {
      throw new HealthMonitorConfigError('tokenProvider must be a function');
    }
  }

  /**
   * Validate health check configuration
   * @throws {HealthMonitorConfigError} If config is invalid
   */
  private validateConfig(config: HealthCheckConfig): void {
    // Validate checkInterval
    if (
      !Number.isInteger(config.checkInterval) ||
      config.checkInterval < 60000 ||
      config.checkInterval > 3600000
    ) {
      throw new HealthMonitorConfigError(
        'checkInterval must be an integer between 60000ms (1 minute) and 3600000ms (1 hour)'
      );
    }

    // Validate failureThreshold
    if (
      !Number.isInteger(config.failureThreshold) ||
      config.failureThreshold < 1 ||
      config.failureThreshold > 10
    ) {
      throw new HealthMonitorConfigError(
        'failureThreshold must be an integer between 1 and 10'
      );
    }

    // Validate timeout
    if (
      !Number.isInteger(config.timeout) ||
      config.timeout < 1000 ||
      config.timeout > 30000
    ) {
      throw new HealthMonitorConfigError(
        'timeout must be an integer between 1000ms (1 second) and 30000ms (30 seconds)'
      );
    }
  }

  /**
   * Start periodic health checks
   * 
   * Runs an initial check immediately, then schedules periodic checks
   * at the configured interval.
   */
  startHealthChecks(): void {
    if (this.isRunning) {
      return; // Already running
    }

    this.isRunning = true;

    // Run initial check immediately
    this.performHealthCheck().catch((error) => {
      // Log error but don't throw - health checks should be resilient
      console.error(`Initial health check failed for ${this.accountId}:`, error);
    });

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.performHealthCheck().catch((error) => {
        console.error(`Health check failed for ${this.accountId}:`, error);
      });
    }, this.config.checkInterval);
    this.checkInterval.unref?.();
  }

  /**
   * Stop periodic health checks
   * 
   * Clears the check interval and resets running state.
   */
  stopHealthChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    this.isRunning = false;
  }

  /**
   * Perform a single health check
   * 
   * Makes a minimal API call to test account connectivity and availability.
   * Updates health status based on success or failure.
   * 
   * @returns Health check result
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    let result: HealthCheckResult;

    try {
      // Get access token
      const accessToken = await this.tokenProvider(this.accountId);

      // Minimal API call to test connectivity
      const request = {
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      await this.apiClient.sendRequest(request, accessToken, {
        region: 'us-east-1',
        timeout: {
          connect: this.config.timeout / 1000,
          read: this.config.timeout / 1000,
        },
        retries: 0, // No retries for health checks
      });

      const responseTime = Date.now() - startTime;

      // Success - mark healthy and reset failure count
      result = {
        accountId: this.accountId,
        healthy: true,
        lastCheck: new Date(),
        consecutiveFailures: 0,
        responseTime,
      };
    } catch (error) {
      const currentStatus = this.currentStatus;
      const consecutiveFailures = (currentStatus?.consecutiveFailures || 0) + 1;

      // Classify error type
      const errorType = this.classifyError(error);

      // Sanitize error message
      const errorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedError = LogSanitizer.sanitize(errorMessage);

      // Mark unhealthy if threshold reached
      result = {
        accountId: this.accountId,
        healthy: consecutiveFailures < this.config.failureThreshold,
        lastCheck: new Date(),
        consecutiveFailures,
        lastError: sanitizedError,
        errorType,
      };
    }

    this.currentStatus = result;
    return result;
  }

  /**
   * Classify error by type for better diagnostics
   * 
   * @param error - Error object from health check
   * @returns Error type classification
   */
  private classifyError(error: any): HealthCheckErrorType {
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return HealthCheckErrorType.NETWORK;
    }

    // Auth errors
    if (error.statusCode === 401 || error.statusCode === 403) {
      return HealthCheckErrorType.AUTH;
    }

    // Rate limit errors
    if (error.statusCode === 429) {
      return HealthCheckErrorType.RATE_LIMIT;
    }

    // Server errors
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return HealthCheckErrorType.SERVER;
    }

    // Timeout errors
    if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') {
      return HealthCheckErrorType.TIMEOUT;
    }

    // Unknown errors
    return HealthCheckErrorType.UNKNOWN;
  }

  /**
   * Get current health status
   * 
   * @returns Current health check result, or null if no checks performed yet
   */
  getHealthStatus(): HealthCheckResult | null {
    return this.currentStatus;
  }

  /**
   * Check if account is currently healthy
   * 
   * @returns true if healthy or no checks performed yet, false if unhealthy
   */
  isHealthy(): boolean {
    return this.currentStatus?.healthy ?? true; // Default to healthy if no checks yet
  }

  /**
   * Manually trigger a health check
   * 
   * Performs an immediate health check outside the regular schedule.
   * 
   * @returns Health check result
   */
  async checkNow(): Promise<HealthCheckResult> {
    return this.performHealthCheck();
  }

  /**
   * Get account ID
   * 
   * @returns Account identifier
   */
  getAccountId(): string {
    return this.accountId;
  }

  /**
   * Check if health checks are currently running
   * 
   * @returns true if periodic checks are active
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Get consecutive failure count
   * 
   * @returns Number of consecutive failures, or 0 if no checks performed
   */
  getConsecutiveFailures(): number {
    return this.currentStatus?.consecutiveFailures || 0;
  }
}
