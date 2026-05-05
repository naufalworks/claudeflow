/**
 * Kiro OAuth Error Classes
 *
 * Custom error hierarchy for the Kiro OAuth authentication system.
 * Errors are classified into two categories:
 *
 * Transient (retryable):
 * - Network timeouts, 429 rate limits, 5xx server errors
 *
 * Permanent (user action required):
 * - 401 auth failures (after refresh), 402 quota exhausted, invalid config
 */

/**
 * Base error class for all ClaudeFlow errors.
 * Extends native Error with structured error information.
 */
export class ClaudeFlowError extends Error {
  /** Machine-readable error code */
  public readonly code: string;

  /** HTTP status code (if applicable) */
  public readonly statusCode?: number;

  /** Whether this error can be retried */
  public readonly retryable: boolean;

  constructor(message: string, code: string, statusCode?: number, retryable = false) {
    super(message);
    this.name = 'ClaudeFlowError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/**
 * Authentication error (401/403).
 * Triggers re-authentication flow.
 * NOT retryable — user must re-login.
 */
export class AuthenticationError extends ClaudeFlowError {
  /** Account ID that failed authentication */
  public readonly accountId: string;

  /** Specific reason for authentication failure */
  public readonly reason: string;

  constructor(accountId: string, reason: string) {
    super(
      `Authentication failed for ${accountId}: ${reason}`,
      'AUTH_FAILED',
      401,
      false
    );
    this.name = 'AuthenticationError';
    this.accountId = accountId;
    this.reason = reason;
  }
}

/**
 * Token refresh error.
 * Token refresh failed — may need re-login.
 * Retryable — other accounts may still work.
 */
export class TokenRefreshError extends ClaudeFlowError {
  /** Account ID that failed token refresh */
  public readonly accountId: string;

  /** Specific reason for refresh failure */
  public readonly reason: string;

  constructor(accountId: string, reason: string) {
    super(
      `Token refresh failed for ${accountId}: ${reason}`,
      'TOKEN_REFRESH_FAILED',
      undefined,
      true
    );
    this.name = 'TokenRefreshError';
    this.accountId = accountId;
    this.reason = reason;
  }
}

/**
 * Rate limit error (429).
 * Triggers exponential backoff and retry.
 * Retryable after cooldown period.
 */
export class RateLimitError extends ClaudeFlowError {
  /** Account ID that was rate limited */
  public readonly accountId: string;

  /** Seconds to wait before retrying */
  public readonly retryAfter: number;

  constructor(accountId: string, retryAfter: number) {
    super(
      `Rate limited on ${accountId}. Retry after ${retryAfter}s`,
      'RATE_LIMITED',
      429,
      true
    );
    this.name = 'RateLimitError';
    this.accountId = accountId;
    this.retryAfter = retryAfter;
  }
}

/**
 * Quota exhausted error (402).
 * Triggers failover to next available account.
 * NOT retryable — must switch accounts.
 */
export class QuotaExhaustedError extends ClaudeFlowError {
  /** Account ID with exhausted quota */
  public readonly accountId: string;

  constructor(accountId: string) {
    super(
      `Quota exhausted for ${accountId}`,
      'QUOTA_EXHAUSTED',
      402,
      false
    );
    this.name = 'QuotaExhaustedError';
    this.accountId = accountId;
  }
}

/**
 * Response format validation error.
 * Response was not in native Anthropic format.
 * NOT retryable — indicates incompatible account.
 */
export class ResponseFormatError extends ClaudeFlowError {
  /** Provider that returned invalid format */
  public readonly provider: string;

  /** Detailed description of format violation */
  public readonly details: string;

  constructor(provider: string, details: string) {
    super(
      `Invalid response format from ${provider}: ${details}`,
      'INVALID_FORMAT',
      undefined,
      false
    );
    this.name = 'ResponseFormatError';
    this.provider = provider;
    this.details = details;
  }
}

/**
 * Circuit breaker open error.
 * Account is in cooldown after consecutive failures.
 * Retryable — will be available after cooldown period.
 */
export class CircuitBreakerOpenError extends ClaudeFlowError {
  /** Account ID with open circuit breaker */
  public readonly accountId: string;

  /** Time when the circuit will transition to half-open */
  public readonly retryAt: Date;

  constructor(accountId: string, retryAt: Date) {
    const retrySeconds = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
    super(
      `Circuit breaker open for ${accountId}. Retry in ${Math.max(0, retrySeconds)}s`,
      'CIRCUIT_OPEN',
      undefined,
      true
    );
    this.name = 'CircuitBreakerOpenError';
    this.accountId = accountId;
    this.retryAt = retryAt;
  }
}

/**
 * No healthy accounts available error.
 * All accounts in the pool are unhealthy or exhausted.
 * NOT retryable — requires user intervention.
 */
export class NoHealthyAccountsError extends ClaudeFlowError {
  constructor() {
    super(
      'No healthy accounts available. Run: claudeflow health',
      'NO_HEALTHY_ACCOUNTS',
      undefined,
      false
    );
    this.name = 'NoHealthyAccountsError';
  }
}
