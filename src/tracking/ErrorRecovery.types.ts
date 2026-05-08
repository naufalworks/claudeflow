/**
 * Type definitions for Error Recovery Service
 *
 * Defines types for retry logic, fallback queue, and graceful degradation.
 * Requirements: 17.1, 17.2, 17.5
 */

/**
 * Configuration for retry with exponential backoff
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial backoff delay in milliseconds */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 4000,
  backoffMultiplier: 2,
};

/**
 * Entry in the fallback queue
 */
export interface QueuedItem<T> {
  /** The item to retry */
  item: T;
  /** Number of retry attempts so far */
  retryCount: number;
  /** Timestamp when the item was first queued */
  queuedAt: number;
  /** Timestamp when the next retry should occur */
  nextRetryAt: number;
}

/**
 * Configuration for the fallback queue
 */
export interface FallbackQueueConfig {
  /** Maximum queue size (oldest items dropped when exceeded) */
  maxSize: number;
  /** Maximum number of retries per item */
  maxRetries: number;
  /** Initial backoff in milliseconds */
  initialBackoffMs: number;
  /** Maximum backoff in milliseconds */
  maxBackoffMs: number;
}

/**
 * Default fallback queue configuration
 */
export const DEFAULT_FALLBACK_QUEUE_CONFIG: FallbackQueueConfig = {
  maxSize: 10000,
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 4000,
};

/**
 * Entry in the dead letter queue (items that exceeded max retries)
 */
export interface DeadLetterEntry<T> {
  /** The original item */
  item: T;
  /** Reason it was moved to dead letter */
  reason: string;
  /** Number of retries attempted */
  retryCount: number;
  /** Timestamp when it was moved to dead letter */
  deadLetteredAt: number;
}

/**
 * Status of the error recovery system
 */
export interface ErrorRecoveryStatus {
  /** Current fallback queue size */
  queueSize: number;
  /** Number of items in the dead letter queue */
  deadLetterCount: number;
  /** Total items successfully retried */
  totalRetried: number;
  /** Total items that exceeded max retries */
  totalDeadLettered: number;
  /** Whether the circuit breaker is open */
  circuitBreakerOpen: boolean;
}
