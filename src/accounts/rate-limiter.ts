/**
 * Rate Limiter Implementation
 *
 * Per-account AND per-model request tracking and throttling with rate limit header parsing,
 * preemptive switching at 90% usage, exponential backoff on 429 errors,
 * and request queue management with max 5 concurrent requests.
 *
 * Per-model tracking allows better account utilization - an account rate-limited
 * for one model can still serve requests for other models.
 *
 * Requirements: 14.1-14.10
 */

import { randomUUID } from 'crypto';
import { ClaudeFlowError, RateLimitError } from '../errors/kiro-errors.js';

/**
 * Rate limit window for a specific time period
 */
export interface RateLimitWindowInfo {
  used: number;
  limit: number;
  resetAt: Date;
}

/**
 * Rate limit tracking across multiple time windows
 */
export interface RateLimitWindow {
  perMinute: RateLimitWindowInfo;
  perHour: RateLimitWindowInfo;
  perDay: RateLimitWindowInfo;
}

/**
 * Parsed rate limit headers from API response
 */
export interface RateLimitHeaders {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
}

/**
 * Request queue item
 */
interface RequestQueueItem {
  id: string;
  timestamp: Date;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Backoff attempt tracking
 */
interface BackoffEntry {
  count: number;
  timestamp: Date;
}

/**
 * Error thrown when rate limiter configuration is invalid
 */
export class RateLimiterConfigError extends ClaudeFlowError {
  constructor(message: string) {
    super(message, 'RATE_LIMITER_CONFIG_ERROR', undefined, false);
  }
}

/**
 * Rate Limiter for per-account AND per-model request tracking and throttling
 *
 * Features:
 * - Per-model tracking: minute/hour/day windows for each model
 * - Rate limit header parsing: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * - Preemptive switching: Alert at 90% usage threshold
 * - Exponential backoff: 1s, 2s, 4s, 8s on 429 errors
 * - Request queue: Max 5 concurrent, max 1000 queued, 30s timeout
 *
 * Security:
 * - Bounded queue size prevents memory exhaustion
 * - Cryptographically secure request IDs
 * - Queue timeout prevents indefinite waiting
 * - Input validation on all parameters
 * - Automatic cleanup of stale data
 */
export class RateLimiter {
  private readonly accountId: string;
  private readonly windows: Map<string, RateLimitWindow> = new Map(); // key: model name
  private readonly requestQueue: RequestQueueItem[] = [];
  private activeRequests: number = 0;
  private readonly maxConcurrent: number;
  private readonly backoffAttempts: Map<string, BackoffEntry> = new Map(); // key: model name
  
  // Constants
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly QUEUE_TIMEOUT_MS = 30000; // 30 seconds
  private readonly BACKOFF_CLEANUP_AGE_MS = 3600000; // 1 hour
  private readonly PREEMPTIVE_THRESHOLD = 0.9; // 90%

  /**
   * Create a new rate limiter
   * 
   * @param accountId - Account identifier (must match pattern: kiro-[a-f0-9]+)
   * @param maxConcurrent - Maximum concurrent requests (default: 5, range: 1-100)
   * @throws {RateLimiterConfigError} If accountId or maxConcurrent is invalid
   */
  constructor(accountId: string, maxConcurrent: number = 5) {
    this.validateAccountId(accountId);
    this.validateMaxConcurrent(maxConcurrent);
    
    this.accountId = accountId;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Validate account ID format
   * @throws {RateLimiterConfigError} If accountId is invalid
   */
  private validateAccountId(accountId: string): void {
    if (!accountId || typeof accountId !== 'string') {
      throw new RateLimiterConfigError('accountId must be a non-empty string');
    }

    if (accountId.length < 5 || accountId.length > 64) {
      throw new RateLimiterConfigError(
        'accountId length must be between 5 and 64 characters'
      );
    }

    const accountIdPattern = /^kiro-[a-f0-9]+$/;
    if (!accountIdPattern.test(accountId)) {
      throw new RateLimiterConfigError(
        'accountId must match pattern: kiro-[a-f0-9]+ (e.g., kiro-abc123)'
      );
    }
  }

  /**
   * Validate maxConcurrent parameter
   * @throws {RateLimiterConfigError} If maxConcurrent is invalid
   */
  private validateMaxConcurrent(maxConcurrent: number): void {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 100) {
      throw new RateLimiterConfigError(
        'maxConcurrent must be an integer between 1 and 100'
      );
    }
  }

  /**
   * Parse rate limit headers from API response
   * 
   * Supports both lowercase and capitalized header names.
   * Validates all parsed values are positive integers.
   * 
   * @param headers - HTTP response headers
   * @returns Parsed rate limit info, or null if headers are invalid/missing
   */
  parseHeaders(headers: Record<string, string>): RateLimitHeaders | null {
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

    if (limit <= 0 || remaining < 0 || reset <= 0) {
      return null;
    }

    return { limit, remaining, reset };
  }

  /**
   * Update rate limit tracking from parsed headers
   *
   * @param headers - Parsed rate limit headers
   * @param window - Time window to update ('minute', 'hour', or 'day')
   * @param model - Model name for per-model tracking (default: 'default')
   */
  updateFromHeaders(headers: RateLimitHeaders, window: 'minute' | 'hour' | 'day', model: string = 'default'): void {
    const resetAt = new Date(headers.reset * 1000);

    let currentWindow = this.windows.get(model);
    if (!currentWindow) {
      currentWindow = this.initializeWindow();
      this.windows.set(model, currentWindow);
    }

    const used = headers.limit - headers.remaining;

    if (window === 'minute') {
      currentWindow.perMinute = { used, limit: headers.limit, resetAt };
    } else if (window === 'hour') {
      currentWindow.perHour = { used, limit: headers.limit, resetAt };
    } else if (window === 'day') {
      currentWindow.perDay = { used, limit: headers.limit, resetAt };
    }
  }

  /**
   * Check if account is near rate limit for a specific model (90% threshold)
   *
   * Automatically resets expired windows before checking.
   *
   * @param model - Model name to check (default: 'default')
   * @returns true if any window is at or above 90% usage for this model
   */
  isNearLimit(model: string = 'default'): boolean {
    const window = this.windows.get(model);
    if (!window) {
      return false;
    }

    // Reset expired windows
    this.checkAndResetExpiredWindows(window);

    // Check usage against threshold
    const minuteUsage = window.perMinute.limit > 0
      ? window.perMinute.used / window.perMinute.limit
      : 0;
    const hourUsage = window.perHour.limit > 0
      ? window.perHour.used / window.perHour.limit
      : 0;
    const dayUsage = window.perDay.limit > 0
      ? window.perDay.used / window.perDay.limit
      : 0;

    return (
      minuteUsage >= this.PREEMPTIVE_THRESHOLD ||
      hourUsage >= this.PREEMPTIVE_THRESHOLD ||
      dayUsage >= this.PREEMPTIVE_THRESHOLD
    );
  }

  /**
   * Calculate exponential backoff delay
   * 
   * Delays: 1s, 2s, 4s, 8s (capped at 8s)
   * 
   * @param attempt - Attempt number (0-indexed)
   * @returns Delay in milliseconds
   */
  getBackoffDelay(attempt: number): number {
    const delays = [1000, 2000, 4000, 8000];
    const index = Math.min(Math.max(0, attempt), delays.length - 1);
    return delays[index];
  }

  /**
   * Acquire a slot in the request queue
   * 
   * If under maxConcurrent, grants slot immediately.
   * Otherwise, queues the request with timeout.
   * 
   * @param timeoutMs - Queue timeout in milliseconds (default: 30000)
   * @throws {RateLimitError} If queue is full
   * @throws {Error} If queue timeout is reached
   */
  async acquireSlot(timeoutMs: number = this.QUEUE_TIMEOUT_MS): Promise<void> {
    // Grant slot immediately if under limit
    if (this.activeRequests < this.maxConcurrent) {
      this.activeRequests++;
      return;
    }

    // Check queue size limit
    if (this.requestQueue.length >= this.MAX_QUEUE_SIZE) {
      throw new RateLimitError(
        this.accountId,
        0 // No retry after - queue is full
      );
    }

    // Queue the request with timeout
    return Promise.race([
      new Promise<void>((resolve, reject) => {
        this.requestQueue.push({
          id: randomUUID(),
          timestamp: new Date(),
          resolve: () => {
            this.activeRequests++;
            resolve();
          },
          reject,
        });
      }),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Queue timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  /**
   * Release a slot and process next queued request
   * 
   * Decrements active request count and grants slot to next queued request.
   */
  releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    
    if (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift();
      if (next) {
        next.resolve();
      }
    }
  }

  /**
   * Handle 429 rate limit error with exponential backoff
   *
   * Uses retryAfter from response if provided, otherwise uses exponential backoff.
   * Cleans up old backoff entries periodically.
   *
   * @param retryAfter - Retry-After header value in seconds (optional)
   * @param model - Model name for per-model backoff tracking (default: 'default')
   */
  async handleRateLimitError(retryAfter?: number, model: string = 'default'): Promise<void> {
    const entry = this.backoffAttempts.get(model);
    const attempt = entry ? entry.count : 0;

    this.backoffAttempts.set(model, {
      count: attempt + 1,
      timestamp: new Date(),
    });

    // Use retryAfter if provided, otherwise exponential backoff
    const delay = retryAfter ? retryAfter * 1000 : this.getBackoffDelay(attempt);

    // Cleanup old entries periodically (every 10 attempts)
    if (attempt % 10 === 0) {
      this.cleanupOldBackoffEntries();
    }

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Reset backoff counter for a specific model
   *
   * Called after successful request to reset exponential backoff.
   *
   * @param model - Model name to reset (default: 'default')
   */
  resetBackoff(model: string = 'default'): void {
    this.backoffAttempts.delete(model);
  }

  /**
   * Get current rate limit status for a specific model
   *
   * Resets expired windows before returning status.
   *
   * @param model - Model name to query (default: 'default')
   * @returns Current rate limit window, or null if not initialized
   */
  getStatus(model: string = 'default'): RateLimitWindow | null {
    const window = this.windows.get(model);
    if (!window) {
      return null;
    }

    // Reset expired windows
    this.checkAndResetExpiredWindows(window);

    return window;
  }

  /**
   * Get all models being tracked
   *
   * @returns Array of model names
   */
  getTrackedModels(): string[] {
    return Array.from(this.windows.keys());
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
   * Get current queue length
   * 
   * @returns Number of requests waiting in queue
   */
  getQueueLength(): number {
    return this.requestQueue.length;
  }

  /**
   * Get current active request count
   * 
   * @returns Number of active requests
   */
  getActiveRequestCount(): number {
    return this.activeRequests;
  }

  /**
   * Initialize default rate limit window
   * 
   * @returns New rate limit window with default values
   */
  private initializeWindow(): RateLimitWindow {
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
   * Check if a window has expired and reset if needed
   * 
   * @param resetAt - Window reset time
   * @returns true if window has expired
   */
  private isWindowExpired(resetAt: Date): boolean {
    return new Date() >= resetAt;
  }

  /**
   * Check and reset expired windows
   * 
   * @param window - Rate limit window to check
   */
  private checkAndResetExpiredWindows(window: RateLimitWindow): void {
    const now = new Date();

    if (this.isWindowExpired(window.perMinute.resetAt)) {
      window.perMinute = {
        used: 0,
        limit: window.perMinute.limit,
        resetAt: new Date(now.getTime() + 60000),
      };
    }

    if (this.isWindowExpired(window.perHour.resetAt)) {
      window.perHour = {
        used: 0,
        limit: window.perHour.limit,
        resetAt: new Date(now.getTime() + 3600000),
      };
    }

    if (this.isWindowExpired(window.perDay.resetAt)) {
      window.perDay = {
        used: 0,
        limit: window.perDay.limit,
        resetAt: new Date(now.getTime() + 86400000),
      };
    }
  }

  /**
   * Cleanup old backoff entries (older than 1 hour)
   */
  private cleanupOldBackoffEntries(): void {
    const now = Date.now();
    const cutoff = now - this.BACKOFF_CLEANUP_AGE_MS;

    for (const [model, entry] of this.backoffAttempts.entries()) {
      if (entry.timestamp.getTime() < cutoff) {
        this.backoffAttempts.delete(model);
      }
    }
  }
}
