/**
 * Error Recovery Service
 *
 * Provides centralized error recovery with exponential backoff,
 * bounded fallback queue, and graceful degradation patterns.
 *
 * Requirements: 17.1, 17.2, 17.5
 */

import {
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  FallbackQueueConfig,
  DEFAULT_FALLBACK_QUEUE_CONFIG,
  QueuedItem,
  DeadLetterEntry,
  ErrorRecoveryStatus,
} from './ErrorRecovery.types.js';
import { RankedAccount } from './QuotaManagementManager.types.js';

/**
 * Generic fallback queue with retry tracking and dead letter support.
 *
 * Bounded queue that stores items for retry with exponential backoff.
 * Items exceeding max retries are moved to a dead letter queue.
 *
 * Requirements: 17.1, 17.5
 */
export class FallbackQueue<T> {
  private queue: QueuedItem<T>[] = [];
  private deadLetter: DeadLetterEntry<T>[] = [];
  private config: FallbackQueueConfig;
  private totalRetried = 0;
  private totalDeadLettered = 0;
  private consecutiveFailures = 0;
  private circuitBreakerOpen = false;
  private circuitBreakerThreshold: number;

  constructor(config?: Partial<FallbackQueueConfig>) {
    this.config = { ...DEFAULT_FALLBACK_QUEUE_CONFIG, ...config };
    this.circuitBreakerThreshold = 10; // Open circuit after 10 consecutive failures
  }

  /**
   * Add an item to the fallback queue
   */
  enqueue(item: T): void {
    const now = Date.now();
    const queuedItem: QueuedItem<T> = {
      item,
      retryCount: 0,
      queuedAt: now,
      nextRetryAt: now, // Available immediately
    };

    // Enforce max size - drop oldest if at capacity
    if (this.queue.length >= this.config.maxSize) {
      const dropped = this.queue.shift();
      if (dropped) {
        console.warn(`Fallback queue at capacity (${this.config.maxSize}), dropping oldest item`);
      }
    }

    this.queue.push(queuedItem);
  }

  /**
   * Get items that are ready for retry (nextRetryAt <= now)
   */
  getReadyItems(): QueuedItem<T>[] {
    const now = Date.now();
    return this.queue.filter((entry) => entry.nextRetryAt <= now);
  }

  /**
   * Process ready items through the given handler
   *
   * @param handler - Async function to process each item
   * @returns Number of items successfully processed
   */
  async processQueue(handler: (item: T) => Promise<void>): Promise<number> {
    if (this.circuitBreakerOpen) {
      return 0;
    }

    const readyItems = this.getReadyItems();
    let successCount = 0;

    for (const entry of readyItems) {
      try {
        await handler(entry.item);

        // Success - remove from queue
        this.queue = this.queue.filter((q) => q !== entry);
        this.totalRetried++;
        this.consecutiveFailures = 0;
        successCount++;
      } catch (error) {
        // Failure - update retry metadata
        entry.retryCount++;

        if (entry.retryCount >= this.config.maxRetries) {
          // Move to dead letter queue
          this.queue = this.queue.filter((q) => q !== entry);
          this.deadLetter.push({
            item: entry.item,
            reason: 'Exceeded max retries',
            retryCount: entry.retryCount,
            deadLetteredAt: Date.now(),
          });
          this.totalDeadLettered++;
          console.error(`Item moved to dead letter queue after ${entry.retryCount} retries`);
        } else {
          // Calculate next retry time with exponential backoff
          const backoffMs = this.calculateBackoff(entry.retryCount);
          entry.nextRetryAt = Date.now() + backoffMs;
        }

        this.consecutiveFailures++;

        // Check circuit breaker
        if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
          this.circuitBreakerOpen = true;
          console.error(
            `Circuit breaker opened after ${this.consecutiveFailures} consecutive failures`
          );
          break;
        }
      }
    }

    return successCount;
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get dead letter queue size
   */
  deadLetterSize(): number {
    return this.deadLetter.length;
  }

  /**
   * Get dead letter entries
   */
  getDeadLetter(): DeadLetterEntry<T>[] {
    return [...this.deadLetter];
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetter(): void {
    this.deadLetter = [];
  }

  /**
   * Reset the circuit breaker (allow retries again)
   */
  resetCircuitBreaker(): void {
    this.circuitBreakerOpen = false;
    this.consecutiveFailures = 0;
  }

  /**
   * Get error recovery status
   */
  getStatus(): ErrorRecoveryStatus {
    return {
      queueSize: this.queue.length,
      deadLetterCount: this.deadLetter.length,
      totalRetried: this.totalRetried,
      totalDeadLettered: this.totalDeadLettered,
      circuitBreakerOpen: this.circuitBreakerOpen,
    };
  }

  /**
   * Clear all queues and reset counters
   */
  clear(): void {
    this.queue = [];
    this.deadLetter = [];
    this.totalRetried = 0;
    this.totalDeadLettered = 0;
    this.consecutiveFailures = 0;
    this.circuitBreakerOpen = false;
  }

  /**
   * Calculate exponential backoff delay
   * @private
   */
  private calculateBackoff(retryCount: number): number {
    const backoff = this.config.initialBackoffMs * Math.pow(2, retryCount - 1);
    return Math.min(backoff, this.config.maxBackoffMs);
  }
}

/**
 * Retry an async operation with exponential backoff
 *
 * Requirements: 17.1, 17.5
 *
 * @param fn - The async operation to retry
 * @param config - Retry configuration
 * @returns The result of the successful operation
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retryConfig.maxRetries) {
        const delay = Math.min(
          retryConfig.initialBackoffMs * Math.pow(retryConfig.backoffMultiplier, attempt),
          retryConfig.maxBackoffMs
        );

        console.warn(`Retry attempt ${attempt + 1}/${retryConfig.maxRetries} after ${delay}ms`);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

/**
 * Graceful degradation for account ranking
 *
 * When quota status query fails, return all accounts with equal ranking
 * so that the system continues to function with round-robin-like behavior.
 *
 * Requirements: 17.2
 *
 * @param accountIds - List of account IDs to rank equally
 * @param reason - Reason for degradation (for logging)
 * @returns Array of RankedAccount with equal scores
 */
export function createFallbackRanking(accountIds: string[], reason: string): RankedAccount[] {
  console.warn(
    `Graceful degradation: ${reason}. Using equal ranking for ${accountIds.length} accounts.`
  );

  const equalScore = 0.5;

  return accountIds.map((id) => ({
    accountId: id,
    score: equalScore,
    quotaRemaining: 0.5, // Assume 50% remaining
    quotaPercentage: 50, // 50% used
    resetTime: new Date(Date.now() + 3600000), // Assume 1 hour from now
    averageLatency: 0, // Unknown in degraded mode
    successRate: 0.5,
    reason: `Degraded mode: ${reason}`,
  }));
}
