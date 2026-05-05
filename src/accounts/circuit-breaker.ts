/**
 * Circuit Breaker Implementation
 * 
 * Prevents cascading failures by temporarily blocking requests to unhealthy accounts.
 * Implements a state machine: closed → open (after failures) → half-open (after cooldown) → closed (on success)
 * 
 * Requirements: 17.6, 17.7
 */

import { ClaudeFlowError } from '../errors/kiro-errors.js';

/**
 * Circuit breaker states
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures before opening the circuit
   * Must be between 1 and 100
   * @default 5
   */
  failureThreshold: number;

  /**
   * Cooldown period in milliseconds before transitioning from open to half-open
   * Must be between 1000ms (1 second) and 300000ms (5 minutes)
   * @default 60000 (60 seconds)
   */
  cooldownPeriod: number;
}

/**
 * Error thrown when circuit breaker configuration is invalid
 */
export class CircuitBreakerConfigError extends ClaudeFlowError {
  constructor(message: string) {
    super(message, 'CIRCUIT_BREAKER_CONFIG_ERROR', undefined, false);
  }
}

/**
 * Circuit Breaker for account health management
 * 
 * State Machine:
 * - closed: Normal operation, tracks failures
 * - open: Rejects all requests, waits for cooldown period
 * - half-open: Allows one test request to check if service recovered
 * 
 * Transitions:
 * - closed → open: After failureThreshold consecutive failures
 * - open → half-open: After cooldownPeriod elapsed
 * - half-open → closed: On successful request
 * - half-open → open: On failed request
 * 
 * Thread Safety:
 * Safe for Node.js single-threaded event loop. The halfOpenRequestInFlight flag
 * prevents TOCTOU issues where multiple async requests could all pass through
 * in half-open state.
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount: number = 0;
  private lastFailureTime?: Date;
  private openUntil?: Date;
  private halfOpenRequestInFlight: boolean = false;
  private readonly accountId: string;
  private readonly config: CircuitBreakerConfig;

  /**
   * Create a new circuit breaker
   * 
   * @param accountId - Account identifier (must match pattern: kiro-[a-f0-9]+)
   * @param config - Circuit breaker configuration
   * @throws {CircuitBreakerConfigError} If accountId or config is invalid
   */
  constructor(
    accountId: string,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    // Validate accountId
    this.validateAccountId(accountId);
    this.accountId = accountId;

    // Set defaults and validate config
    const defaultConfig: CircuitBreakerConfig = {
      failureThreshold: 5,
      cooldownPeriod: 60000, // 60 seconds
    };

    this.config = {
      failureThreshold: config.failureThreshold ?? defaultConfig.failureThreshold,
      cooldownPeriod: config.cooldownPeriod ?? defaultConfig.cooldownPeriod,
    };

    this.validateConfig(this.config);
  }

  /**
   * Validate account ID format
   * @throws {CircuitBreakerConfigError} If accountId is invalid
   */
  private validateAccountId(accountId: string): void {
    if (!accountId || typeof accountId !== 'string') {
      throw new CircuitBreakerConfigError('accountId must be a non-empty string');
    }

    if (accountId.length < 5 || accountId.length > 64) {
      throw new CircuitBreakerConfigError(
        'accountId length must be between 5 and 64 characters'
      );
    }

    const accountIdPattern = /^kiro-[a-f0-9]+$/;
    if (!accountIdPattern.test(accountId)) {
      throw new CircuitBreakerConfigError(
        'accountId must match pattern: kiro-[a-f0-9]+ (e.g., kiro-abc123)'
      );
    }
  }

  /**
   * Validate circuit breaker configuration
   * @throws {CircuitBreakerConfigError} If config is invalid
   */
  private validateConfig(config: CircuitBreakerConfig): void {
    // Validate failureThreshold
    if (
      !Number.isInteger(config.failureThreshold) ||
      config.failureThreshold < 1 ||
      config.failureThreshold > 100
    ) {
      throw new CircuitBreakerConfigError(
        'failureThreshold must be an integer between 1 and 100'
      );
    }

    // Validate cooldownPeriod
    if (
      !Number.isInteger(config.cooldownPeriod) ||
      config.cooldownPeriod < 1000 ||
      config.cooldownPeriod > 300000
    ) {
      throw new CircuitBreakerConfigError(
        'cooldownPeriod must be an integer between 1000ms (1 second) and 300000ms (5 minutes)'
      );
    }
  }

  /**
   * Record a successful operation
   * 
   * Behavior by state:
   * - closed: Resets failure count
   * - half-open: Transitions to closed, resets failure count and in-flight flag
   * - open: No-op (shouldn't happen as requests are blocked)
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      // Success in half-open state → transition to closed
      this.state = 'closed';
      this.failureCount = 0;
      this.lastFailureTime = undefined;
      this.openUntil = undefined;
      this.halfOpenRequestInFlight = false;
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failureCount = 0;
      this.lastFailureTime = undefined;
    }
    // In open state: no-op (requests shouldn't reach here)
  }

  /**
   * Record a failed operation
   * 
   * Behavior by state:
   * - closed: Increments failure count, transitions to open if threshold reached
   * - half-open: Transitions back to open with new cooldown, resets in-flight flag
   * - open: No-op (already open)
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === 'closed' && this.failureCount >= this.config.failureThreshold) {
      // Transition to open state after threshold failures
      this.state = 'open';
      this.openUntil = new Date(Date.now() + this.config.cooldownPeriod);
    } else if (this.state === 'half-open') {
      // Failure in half-open state → back to open with new cooldown
      this.state = 'open';
      this.openUntil = new Date(Date.now() + this.config.cooldownPeriod);
      this.halfOpenRequestInFlight = false;
    }
    // In open state: no-op (already open)
  }

  /**
   * Check if requests can be executed
   * 
   * Returns true if:
   * - State is closed
   * - State is open but cooldown elapsed (transitions to half-open)
   * - State is half-open and no request is in-flight
   * 
   * Returns false if:
   * - State is open and cooldown not elapsed
   * - State is half-open and a request is already in-flight
   * 
   * @returns true if requests can proceed, false otherwise
   */
  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if cooldown period has elapsed
      if (this.openUntil && new Date() >= this.openUntil) {
        // Transition to half-open state
        this.state = 'half-open';
        this.failureCount = 0;
        this.halfOpenRequestInFlight = true; // Mark request in-flight
        return true;
      }
      // Still in cooldown
      return false;
    }

    if (this.state === 'half-open') {
      // Allow only one request in half-open state (TOCTOU fix)
      if (!this.halfOpenRequestInFlight) {
        this.halfOpenRequestInFlight = true;
        return true;
      }
      // Another request is already in-flight
      return false;
    }

    return false;
  }

  /**
   * Get current circuit breaker state
   * 
   * Auto-transitions from open to half-open if cooldown has elapsed
   * 
   * @returns Current state
   */
  getState(): CircuitBreakerState {
    // Auto-transition from open to half-open if cooldown elapsed
    if (this.state === 'open' && this.openUntil && new Date() >= this.openUntil) {
      this.state = 'half-open';
      this.failureCount = 0;
    }
    return this.state;
  }

  /**
   * Get time in seconds until circuit can be retried
   * 
   * Only applicable in open state. Returns 0 for other states.
   * 
   * @returns Seconds until retry (0 if not in open state)
   */
  getRetryAfter(): number {
    if (this.state === 'open' && this.openUntil) {
      const now = Date.now();
      const retryTime = this.openUntil.getTime();
      return Math.max(0, Math.ceil((retryTime - now) / 1000));
    }
    return 0;
  }

  /**
   * Get current failure count
   * 
   * @returns Number of consecutive failures
   */
  getFailureCount(): number {
    return this.failureCount;
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
   * Get last failure time
   * 
   * @returns Date of last failure, or undefined if no failures
   */
  getLastFailureTime(): Date | undefined {
    return this.lastFailureTime;
  }

  /**
   * Reset circuit breaker to initial state
   * 
   * WARNING: This should only be used for testing or administrative purposes.
   * Resetting a circuit breaker can allow requests to a failing service,
   * potentially causing cascading failures.
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = undefined;
    this.openUntil = undefined;
    this.halfOpenRequestInFlight = false;
  }
}
