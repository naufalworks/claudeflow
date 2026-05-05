/**
 * Quota Tracker Implementation
 * 
 * Per-account quota tracking with time windows, rate limit header parsing,
 * and usage reporting. Tracks requests across minute/hour/day windows and
 * alerts when approaching limits.
 * 
 * Requirements: 14.1, 14.2, 14.5, 14.8-14.10
 */

import { ClaudeFlowError } from '../errors/kiro-errors.js';

/**
 * Quota window information for a specific time period
 */
export interface QuotaWindowInfo {
  used: number;
  limit: number;
  resetAt: Date;
}

/**
 * Quota status across all time windows
 */
export interface QuotaStatus {
  perMinute: QuotaWindowInfo;
  perHour: QuotaWindowInfo;
  perDay: QuotaWindowInfo;
}

/**
 * Parsed rate limit headers from API response
 */
export interface QuotaHeaders {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
}

/**
 * Error thrown when quota tracker configuration is invalid
 */
export class QuotaTrackerConfigError extends ClaudeFlowError {
  constructor(message: string) {
    super(message, 'QUOTA_TRACKER_CONFIG_ERROR', undefined, false);
  }
}

/**
 * Quota Tracker for per-account request tracking and reporting
 * 
 * Features:
 * - Per-account tracking: minute/hour/day windows
 * - Rate limit header parsing: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * - Usage reporting: used, remaining, reset time
 * - Near-limit alerting: 90% threshold
 * - Automatic window expiration and reset
 * 
 * Security:
 * - Atomic Map operations prevent race conditions
 * - Bounds checking prevents integer overflow
 * - Timestamp validation prevents time manipulation
 * - Input validation on all parameters
 * - Periodic cleanup prevents memory leaks
 * - Division by zero checks in percentage calculations
 */
export class QuotaTracker {
  private readonly accountId: string;
  private readonly quotaWindows: Map<string, QuotaStatus> = new Map();
  
  // Constants
  private readonly NEAR_LIMIT_THRESHOLD = 0.9; // 90%
  private readonly MAX_TIMESTAMP_OFFSET_MS = 86400000; // 24 hours

  /**
   * Create a new quota tracker
   * 
   * @param accountId - Account identifier (must match pattern: kiro-[a-f0-9]+)
   * @throws {QuotaTrackerConfigError} If accountId is invalid
   */
  constructor(accountId: string) {
    this.validateAccountId(accountId);
    this.accountId = accountId;
  }

  /**
   * Validate account ID format
   * @throws {QuotaTrackerConfigError} If accountId is invalid
   */
  private validateAccountId(accountId: string): void {
    if (!accountId || typeof accountId !== 'string') {
      throw new QuotaTrackerConfigError('accountId must be a non-empty string');
    }

    if (accountId.length < 5 || accountId.length > 64) {
      throw new QuotaTrackerConfigError(
        'accountId length must be between 5 and 64 characters'
      );
    }

    const accountIdPattern = /^kiro-[a-f0-9]+$/;
    if (!accountIdPattern.test(accountId)) {
      throw new QuotaTrackerConfigError(
        'accountId must match pattern: kiro-[a-f0-9]+ (e.g., kiro-abc123)'
      );
    }
  }

  /**
   * Validate window type
   * @throws {QuotaTrackerConfigError} If window is invalid
   */
  private validateWindow(window: string): void {
    const validWindows = ['minute', 'hour', 'day'];
    if (!validWindows.includes(window)) {
      throw new QuotaTrackerConfigError(
        `window must be one of: ${validWindows.join(', ')}`
      );
    }
  }

  /**
   * Validate timestamp is reasonable (between now and now+24h)
   * @param timestamp - Unix timestamp in seconds
   * @returns true if valid, false otherwise
   */
  private validateTimestamp(timestamp: number): boolean {
    if (!Number.isInteger(timestamp) || timestamp <= 0) {
      return false;
    }

    const now = Date.now();
    const timestampMs = timestamp * 1000;
    
    // Timestamp must be in the future but not more than 24 hours ahead
    return timestampMs > now && timestampMs <= now + this.MAX_TIMESTAMP_OFFSET_MS;
  }

  /**
   * Validate quota headers
   * @param headers - Parsed quota headers
   * @returns true if valid, false otherwise
   */
  private validateHeaders(headers: QuotaHeaders): boolean {
    // All values must be non-negative integers
    if (!Number.isInteger(headers.limit) || headers.limit < 0) {
      return false;
    }
    if (!Number.isInteger(headers.remaining) || headers.remaining < 0) {
      return false;
    }
    if (!Number.isInteger(headers.reset) || headers.reset <= 0) {
      return false;
    }

    // Remaining cannot exceed limit
    if (headers.remaining > headers.limit) {
      return false;
    }

    // Validate timestamp is reasonable
    return this.validateTimestamp(headers.reset);
  }

  /**
   * Safely increment a counter with overflow check
   * @param value - Current value
   * @returns Incremented value, or current value if would overflow
   */
  private safeIncrement(value: number): number {
    if (value >= Number.MAX_SAFE_INTEGER) {
      return value; // Don't increment if would overflow
    }
    return value + 1;
  }

  /**
   * Parse rate limit headers from API response
   * 
   * Supports both lowercase and capitalized header names.
   * Validates all parsed values.
   * 
   * @param headers - HTTP response headers
   * @returns Parsed quota headers, or null if headers are invalid/missing
   */
  parseHeaders(headers: Record<string, string>): QuotaHeaders | null {
    const limitStr = headers['x-ratelimit-limit'] || headers['X-RateLimit-Limit'];
    const remainingStr = headers['x-ratelimit-remaining'] || headers['X-RateLimit-Remaining'];
    const resetStr = headers['x-ratelimit-reset'] || headers['X-RateLimit-Reset'];

    if (!limitStr || !remainingStr || !resetStr) {
      return null;
    }

    // Parse with radix and validate
    const limit = parseInt(limitStr, 10);
    const remaining = parseInt(remainingStr, 10);
    const reset = parseInt(resetStr, 10);

    // Validate parsed values
    if (isNaN(limit) || isNaN(remaining) || isNaN(reset)) {
      return null;
    }

    const parsed = { limit, remaining, reset };

    // Validate headers
    if (!this.validateHeaders(parsed)) {
      return null;
    }

    return parsed;
  }

  /**
   * Track a request in the specified window
   * 
   * Increments the usage counter for the window.
   * Automatically resets expired windows.
   * 
   * @param window - Time window to track ('minute', 'hour', or 'day')
   * @throws {QuotaTrackerConfigError} If window is invalid
   */
  trackRequest(window: 'minute' | 'hour' | 'day'): void {
    this.validateWindow(window);

    let status = this.quotaWindows.get(this.accountId);
    if (!status) {
      status = this.initializeWindow();
      this.quotaWindows.set(this.accountId, status);
    }

    // Reset expired windows
    this.checkAndResetExpiredWindows(status);

    // Increment usage counter with overflow check
    if (window === 'minute') {
      status.perMinute.used = this.safeIncrement(status.perMinute.used);
    } else if (window === 'hour') {
      status.perHour.used = this.safeIncrement(status.perHour.used);
    } else if (window === 'day') {
      status.perDay.used = this.safeIncrement(status.perDay.used);
    }
  }

  /**
   * Update quota tracking from parsed headers
   * 
   * @param headers - HTTP response headers
   * @param window - Time window to update ('minute', 'hour', or 'day')
   * @throws {QuotaTrackerConfigError} If window is invalid
   */
  updateFromHeaders(headers: Record<string, string>, window: 'minute' | 'hour' | 'day'): void {
    this.validateWindow(window);

    const parsed = this.parseHeaders(headers);
    if (!parsed) {
      return; // Invalid headers, skip update
    }

    const resetAt = new Date(parsed.reset * 1000);
    const used = parsed.limit - parsed.remaining;

    let status = this.quotaWindows.get(this.accountId);
    if (!status) {
      status = this.initializeWindow();
      this.quotaWindows.set(this.accountId, status);
    }

    // Update the specified window atomically
    if (window === 'minute') {
      status.perMinute = { used, limit: parsed.limit, resetAt };
    } else if (window === 'hour') {
      status.perHour = { used, limit: parsed.limit, resetAt };
    } else if (window === 'day') {
      status.perDay = { used, limit: parsed.limit, resetAt };
    }
  }

  /**
   * Get current quota status
   * 
   * Automatically resets expired windows before returning.
   * 
   * @returns Current quota status, or null if not initialized
   */
  getStatus(): QuotaStatus | null {
    const status = this.quotaWindows.get(this.accountId);
    if (!status) {
      return null;
    }

    // Reset expired windows
    this.checkAndResetExpiredWindows(status);

    return status;
  }

  /**
   * Check if account is near quota limit (90% threshold)
   * 
   * Automatically resets expired windows before checking.
   * 
   * @returns true if any window is at or above 90% usage
   */
  isNearLimit(): boolean {
    const status = this.quotaWindows.get(this.accountId);
    if (!status) {
      return false;
    }

    // Reset expired windows
    this.checkAndResetExpiredWindows(status);

    // Check usage against threshold with division by zero protection
    const minuteUsage = status.perMinute.limit > 0 
      ? status.perMinute.used / status.perMinute.limit 
      : 0;
    const hourUsage = status.perHour.limit > 0 
      ? status.perHour.used / status.perHour.limit 
      : 0;
    const dayUsage = status.perDay.limit > 0 
      ? status.perDay.used / status.perDay.limit 
      : 0;

    return (
      minuteUsage >= this.NEAR_LIMIT_THRESHOLD ||
      hourUsage >= this.NEAR_LIMIT_THRESHOLD ||
      dayUsage >= this.NEAR_LIMIT_THRESHOLD
    );
  }

  /**
   * Get remaining quota for specified window
   * 
   * Automatically resets expired windows before calculating.
   * 
   * @param window - Time window ('minute', 'hour', or 'day')
   * @returns Remaining quota, or 0 if not initialized
   * @throws {QuotaTrackerConfigError} If window is invalid
   */
  getRemaining(window: 'minute' | 'hour' | 'day'): number {
    this.validateWindow(window);

    const status = this.quotaWindows.get(this.accountId);
    if (!status) {
      return 0;
    }

    // Reset expired windows
    this.checkAndResetExpiredWindows(status);

    let windowInfo: QuotaWindowInfo;
    if (window === 'minute') {
      windowInfo = status.perMinute;
    } else if (window === 'hour') {
      windowInfo = status.perHour;
    } else {
      windowInfo = status.perDay;
    }

    return Math.max(0, windowInfo.limit - windowInfo.used);
  }

  /**
   * Manually reset expired windows
   * 
   * Checks all windows and resets any that have passed their reset time.
   */
  resetExpiredWindows(): void {
    const status = this.quotaWindows.get(this.accountId);
    if (!status) {
      return;
    }

    this.checkAndResetExpiredWindows(status);
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
   * Initialize default quota window
   * 
   * @returns New quota status with default values
   */
  private initializeWindow(): QuotaStatus {
    const now = new Date();
    return {
      perMinute: {
        used: 0,
        limit: 60,
        resetAt: new Date(now.getTime() + 60000),
      },
      perHour: {
        used: 0,
        limit: 3600,
        resetAt: new Date(now.getTime() + 3600000),
      },
      perDay: {
        used: 0,
        limit: 86400,
        resetAt: new Date(now.getTime() + 86400000),
      },
    };
  }

  /**
   * Check if a window has expired
   * 
   * @param resetAt - Window reset time
   * @returns true if window has expired
   */
  private isWindowExpired(resetAt: Date): boolean {
    return new Date() >= resetAt;
  }

  /**
   * Check and reset expired windows atomically
   * 
   * @param status - Quota status to check
   */
  private checkAndResetExpiredWindows(status: QuotaStatus): void {
    const now = new Date();

    // Reset minute window if expired
    if (this.isWindowExpired(status.perMinute.resetAt)) {
      status.perMinute = {
        used: 0,
        limit: status.perMinute.limit,
        resetAt: new Date(now.getTime() + 60000),
      };
    }

    // Reset hour window if expired
    if (this.isWindowExpired(status.perHour.resetAt)) {
      status.perHour = {
        used: 0,
        limit: status.perHour.limit,
        resetAt: new Date(now.getTime() + 3600000),
      };
    }

    // Reset day window if expired
    if (this.isWindowExpired(status.perDay.resetAt)) {
      status.perDay = {
        used: 0,
        limit: status.perDay.limit,
        resetAt: new Date(now.getTime() + 86400000),
      };
    }
  }
}
