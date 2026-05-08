/**
 * Type definitions for Redis Cache Manager
 *
 * Defines configuration and key constants for caching usage stats,
 * quota status, and ranked accounts in Redis.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5
 */

/**
 * Configuration for Redis cache TTLs and size limits
 */
export interface CacheConfig {
  /** TTL for usage stats cache in seconds (default: 86400 = 24h) */
  usageTTLSeconds: number;
  /** TTL for quota status cache in seconds (default: 60 = 1min) */
  quotaTTLSeconds: number;
  /** TTL for ranked accounts cache in seconds (default: 300 = 5min) */
  rankedTTLSeconds: number;
  /** Maximum size of a single cache entry in bytes (default: 1MB) */
  maxEntrySizeBytes: number;
}

/**
 * Default cache configuration values
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  usageTTLSeconds: 86400, // 24 hours
  quotaTTLSeconds: 60, // 1 minute
  rankedTTLSeconds: 300, // 5 minutes
  maxEntrySizeBytes: 1024 * 1024, // 1MB
};

/**
 * Redis key prefixes for cache entries
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4
 */
export const CacheKeyPrefixes = {
  /** Usage stats for a specific account: usage:account:{accountId}:24h */
  USAGE_ACCOUNT: 'usage:account:',
  /** Total usage stats: usage:total:24h */
  USAGE_TOTAL: 'usage:total:24h',
  /** Quota status for an account: quota:account:{accountId} */
  QUOTA_ACCOUNT: 'quota:account:',
  /** Ranked accounts list: accounts:ranked */
  RANKED_ACCOUNTS: 'accounts:ranked',
  /** Tracker SET for usage account keys (used for wildcard invalidation) */
  TRACKER_USAGE: '__cache_tracker:usage',
  /** Tracker SET for quota account keys (used for wildcard invalidation) */
  TRACKER_QUOTA: '__cache_tracker:quota',
} as const;

/**
 * Account ID validation pattern - only alphanumeric, underscore, and hyphen
 */
export const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
