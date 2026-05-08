/**
 * Performance Optimizer
 *
 * Provides performance optimization utilities for the tracking system:
 * - Cached prepared statements (avoids re-preparing on each call)
 * - Batch insert with transaction support
 * - In-memory ranking cache with TTL
 * - Precomputed cost calculation constants
 *
 * Requirements: 3.5, 11.5, 16.1, 16.2, 16.5
 */

import Database from 'better-sqlite3';
import { RankedAccount } from './QuotaManagementManager.types.js';
import { UsageEvent } from './TimeSeriesStorage.types.js';

// ---------------------------------------------------------------------------
// Precomputed Cost Calculation Constants (Requirement 16.1)
// ---------------------------------------------------------------------------

/**
 * Token pricing per million tokens
 */
export const TOKEN_PRICING_PER_TOKEN = {
  /** $15 / 1M = $0.000015 per token */
  INPUT: 0.000015,
  /** $15 / 1M = $0.000015 per token */
  OUTPUT: 0.000015,
  /** $15 / 1M = $0.000015 per token */
  CACHE_CREATION: 0.000015,
  /** $1.50 / 1M = $0.0000015 per token */
  CACHE_READ: 0.0000015,
} as const;

/**
 * Optimized cost calculation using precomputed per-token costs.
 * Avoids division on every call (Requirement 16.1)
 */
export function calculateCostOptimized(tokens: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number {
  return (
    tokens.inputTokens * TOKEN_PRICING_PER_TOKEN.INPUT +
    tokens.outputTokens * TOKEN_PRICING_PER_TOKEN.OUTPUT +
    tokens.cacheCreationTokens * TOKEN_PRICING_PER_TOKEN.CACHE_CREATION +
    tokens.cacheReadTokens * TOKEN_PRICING_PER_TOKEN.CACHE_READ
  );
}

// ---------------------------------------------------------------------------
// Cached Prepared Statements (Requirement 16.2)
// ---------------------------------------------------------------------------

/**
 * Cache for prepared statements to avoid re-preparing on each call.
 * Bounded by maxCacheSize to prevent memory exhaustion.
 */
export class PreparedStatementCache {
  private cache: Map<string, Database.Statement> = new Map();
  private maxCacheSize: number;

  constructor(maxCacheSize = 100) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Get or create a prepared statement
   */
  getOrPrepare(db: Database.Database, sql: string): Database.Statement {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      // Evict oldest if at capacity
      if (this.cache.size >= this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        }
      }
      stmt = db.prepare(sql);
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }
}

// ---------------------------------------------------------------------------
// Batch Insert (Requirement 16.2)
// ---------------------------------------------------------------------------

/**
 * Batch insert usage events using a transaction for optimal performance.
 *
 * @param db - Database instance
 * @param events - Array of usage events to insert
 * @returns Number of events inserted
 */
export function batchInsertEvents(db: Database.Database, events: UsageEvent[]): number {
  if (events.length === 0) {
    return 0;
  }

  const stmt = db.prepare(`
    INSERT INTO usage_events (
      timestamp, account_id, model, region,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
      cost, latency, status, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: UsageEvent[]) => {
    let count = 0;
    for (const event of items) {
      stmt.run(
        event.timestamp,
        event.accountId,
        event.model,
        event.region,
        event.inputTokens,
        event.outputTokens,
        event.cacheCreationTokens,
        event.cacheReadTokens,
        event.cost,
        event.latency,
        event.status,
        event.errorCode || null
      );
      count++;
    }
    return count;
  });

  return insertMany(events);
}

// ---------------------------------------------------------------------------
// Ranking Cache (Requirement 16.5)
// ---------------------------------------------------------------------------

/**
 * Cache entry with TTL
 */
interface CacheEntry {
  accounts: RankedAccount[];
  cachedAt: number;
}

/**
 * In-memory cache for ranked accounts with TTL.
 * Avoids database queries for account ranking on every request.
 *
 * Requirements: 16.5
 */
export class RankingCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;
  private maxSize: number;

  /**
   * @param ttlMs - Cache TTL in milliseconds (default: 5 minutes)
   * @param maxSize - Maximum number of entries (default: 100 accounts)
   */
  constructor(ttlMs = 300000, maxSize = 100) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /**
   * Get cached ranking if still valid
   */
  get(key: string): RankedAccount[] | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.accounts;
  }

  /**
   * Store ranking in cache
   */
  set(key: string, accounts: RankedAccount[]): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      accounts,
      cachedAt: Date.now(),
    });
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all entries
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Check if entry exists and is valid
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }
}
