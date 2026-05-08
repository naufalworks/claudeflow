/**
 * Predictive Quota Manager
 *
 * Predicts quota reset times using Exponential Moving Average (EMA),
 * detects reset patterns (hourly/daily/monthly), and recommends
 * account switching when approaching quota limits.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  PredictionResult,
  ResetPattern,
  SwitchRecommendation,
  AccountQuotaInfo,
  PredictiveQuotaConfig,
  ResetHistoryRow,
} from './PredictiveQuotaManager.types.js';

/**
 * Known reset pattern intervals in milliseconds
 */
const PATTERNS = {
  hourly: 3_600_000, // 1 hour in ms
  daily: 86_400_000, // 1 day in ms
  monthly: 2_592_000_000, // 30 days in ms
} as const;

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PredictiveQuotaConfig = {
  emaAlpha: 0.3,
  minSampleSize: 3,
  patternTolerance: 0.1,
  nearLimitThreshold: 0.95,
};

/**
 * Token pricing constant: $15 per 1M tokens
 */
const TOKEN_PRICE_PER_MILLION = 15;

/**
 * Predictive Quota Manager
 *
 * Uses historical reset data to predict when quota will reset
 * and recommends optimal account switching strategies.
 */
export class PredictiveQuotaManager extends EventEmitter {
  private db: Database.Database;
  private config: PredictiveQuotaConfig;

  // Prepared statements for performance
  private stmtInsertReset: Database.Statement;
  private stmtUpdatePreviousInterval: Database.Statement;
  private stmtGetLastReset: Database.Statement;
  private stmtGetResetHistory: Database.Statement;

  constructor(databasePath?: string, config?: Partial<PredictiveQuotaConfig>) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize database
    const dbPath =
      databasePath || path.join(process.env.HOME || '', '.claudeflow', 'prediction.db');

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.initializeSchema();

    // Prepare statements for repeated use
    this.stmtInsertReset = this.db.prepare(`
      INSERT INTO prediction_reset_history (account_id, timestamp, quota_type, interval_ms)
      VALUES (?, ?, ?, ?)
    `);

    this.stmtUpdatePreviousInterval = this.db.prepare(`
      UPDATE prediction_reset_history
      SET interval_ms = ?
      WHERE id = ?
    `);

    this.stmtGetLastReset = this.db.prepare(`
      SELECT id, account_id, timestamp, quota_type, interval_ms
      FROM prediction_reset_history
      WHERE account_id = ? AND quota_type = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    this.stmtGetResetHistory = this.db.prepare(`
      SELECT id, account_id, timestamp, quota_type, interval_ms
      FROM prediction_reset_history
      WHERE account_id = ? AND quota_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
  }

  /**
   * Initialize database schema for prediction tracking
   *
   * Requirements: 9.1
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prediction_reset_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        quota_type TEXT NOT NULL,
        interval_ms INTEGER
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_prediction_account_timestamp
      ON prediction_reset_history (account_id, timestamp);
    `);
  }

  /**
   * Record a quota reset time for an account.
   * Calculates interval from the previous reset and updates it.
   *
   * Requirements: 9.1
   *
   * @param accountId - Account identifier
   * @param timestamp - Time when the reset occurred
   * @param quotaType - Type of quota that reset ('rpm' or 'tpd')
   */
  recordResetTime(accountId: string, timestamp: Date, quotaType: 'rpm' | 'tpd'): void {
    const timestampMs = timestamp.getTime();

    // Get the most recent previous reset for this account + quota type
    const previousReset = this.stmtGetLastReset.get(accountId, quotaType) as
      | ResetHistoryRow
      | undefined;

    let intervalMs: number | null = null;

    if (previousReset) {
      intervalMs = timestampMs - previousReset.timestamp;

      // Update the previous row with the calculated interval
      this.stmtUpdatePreviousInterval.run(intervalMs, previousReset.id);
    }

    // Insert the new reset record
    this.stmtInsertReset.run(accountId, timestampMs, quotaType, null);

    this.emit('reset_recorded', {
      accountId,
      timestamp,
      quotaType,
      intervalMs,
    });
  }

  /**
   * Predict the next reset time using Exponential Moving Average (EMA).
   *
   * Algorithm:
   * 1. Retrieve last N reset timestamps
   * 2. Calculate intervals between consecutive resets
   * 3. Apply EMA smoothing: ema = alpha * interval + (1 - alpha) * prev_ema
   * 4. Predicted time = last_reset + ema_interval
   * 5. Confidence = min(sampleSize / 10, 1) * (1 - varianceFactor)
   *
   * Requirements: 9.2
   *
   * @param accountId - Account to predict reset for
   * @param quotaType - Quota type to predict (default: 'tpd')
   * @returns Prediction result with confidence score
   */
  predictResetTime(accountId: string, quotaType: 'rpm' | 'tpd' = 'tpd'): PredictionResult {
    try {
      const rows = this.stmtGetResetHistory.all(
        accountId,
        quotaType,
        50 // Max samples to consider
      ) as ResetHistoryRow[];

      if (rows.length < this.config.minSampleSize) {
        // Not enough data - return a default prediction
        return {
          accountId,
          predictedResetTime: new Date(Date.now() + PATTERNS.daily),
          confidence: 0,
          detectedPattern: 'unknown',
          averageIntervalMs: PATTERNS.daily,
          sampleSize: rows.length,
        };
      }

      // Extract intervals (most recent first from DESC order, reverse for chronological)
      const chronologicalRows = [...rows].reverse();
      const intervals: number[] = [];

      for (let i = 1; i < chronologicalRows.length; i++) {
        const interval = chronologicalRows[i].timestamp - chronologicalRows[i - 1].timestamp;
        if (interval > 0) {
          intervals.push(interval);
        }
      }

      if (intervals.length === 0) {
        return {
          accountId,
          predictedResetTime: new Date(Date.now() + PATTERNS.daily),
          confidence: 0,
          detectedPattern: 'unknown',
          averageIntervalMs: PATTERNS.daily,
          sampleSize: rows.length,
        };
      }

      // Apply EMA to intervals
      let ema = intervals[0];
      for (let i = 1; i < intervals.length; i++) {
        ema = this.config.emaAlpha * intervals[i] + (1 - this.config.emaAlpha) * ema;
      }

      // Calculate variance for confidence
      const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
      const variance =
        intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = avgInterval > 0 ? stdDev / avgInterval : 1;
      const varianceFactor = Math.min(coefficientOfVariation, 1);

      // Confidence based on sample size and variance
      const sampleConfidence = Math.min(intervals.length / 10, 1);
      const confidence = sampleConfidence * (1 - varianceFactor);

      // Last reset timestamp (most recent from DESC query)
      const lastResetTimestamp = rows[0].timestamp;

      // Predicted next reset
      const predictedResetTime = new Date(lastResetTimestamp + ema);

      // Detect pattern
      const pattern = this.detectResetPattern(accountId);

      this.emit('prediction_updated', {
        accountId,
        predictedResetTime,
        confidence,
      });

      return {
        accountId,
        predictedResetTime,
        confidence: Math.max(0, Math.min(1, confidence)),
        detectedPattern: pattern.pattern,
        averageIntervalMs: Math.round(ema),
        sampleSize: intervals.length,
      };
    } catch {
      // Never throw on prediction failures - return reasonable defaults
      return {
        accountId,
        predictedResetTime: new Date(Date.now() + PATTERNS.daily),
        confidence: 0,
        detectedPattern: 'unknown',
        averageIntervalMs: PATTERNS.daily,
        sampleSize: 0,
      };
    }
  }

  /**
   * Detect the reset pattern for an account by comparing
   * average interval against known patterns (hourly, daily, monthly).
   *
   * Requirements: 9.3
   *
   * @param accountId - Account to detect pattern for
   * @param quotaType - Quota type to analyze (default: 'tpd')
   * @returns Detected pattern with confidence
   */
  detectResetPattern(accountId: string, quotaType: 'rpm' | 'tpd' = 'tpd'): ResetPattern {
    try {
      const rows = this.stmtGetResetHistory.all(accountId, quotaType, 50) as ResetHistoryRow[];

      if (rows.length < this.config.minSampleSize) {
        return {
          accountId,
          pattern: 'unknown',
          averageIntervalMs: 0,
          confidence: 0,
          sampleSize: rows.length,
        };
      }

      // Calculate average interval
      const chronologicalRows = [...rows].reverse();
      const intervals: number[] = [];

      for (let i = 1; i < chronologicalRows.length; i++) {
        const interval = chronologicalRows[i].timestamp - chronologicalRows[i - 1].timestamp;
        if (interval > 0) {
          intervals.push(interval);
        }
      }

      if (intervals.length === 0) {
        return {
          accountId,
          pattern: 'unknown',
          averageIntervalMs: 0,
          confidence: 0,
          sampleSize: rows.length,
        };
      }

      const averageIntervalMs = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;

      // Match against known patterns with tolerance
      const tolerance = this.config.patternTolerance;
      let bestMatch: 'hourly' | 'daily' | 'monthly' | 'unknown' = 'unknown';
      let bestDistance = Infinity;

      const patternEntries = Object.entries(PATTERNS) as [string, number][];
      for (const [name, expectedMs] of patternEntries) {
        const distance = Math.abs(averageIntervalMs - expectedMs) / expectedMs;
        if (distance <= tolerance && distance < bestDistance) {
          bestMatch = name as 'hourly' | 'daily' | 'monthly';
          bestDistance = distance;
        }
      }

      // Confidence: how close the match is (1 = perfect, 0 = at tolerance boundary)
      const matchConfidence = bestMatch !== 'unknown' ? 1 - bestDistance / tolerance : 0;

      return {
        accountId,
        pattern: bestMatch,
        averageIntervalMs: Math.round(averageIntervalMs),
        confidence: Math.max(0, Math.min(1, matchConfidence)),
        sampleSize: intervals.length,
      };
    } catch {
      return {
        accountId,
        pattern: 'unknown',
        averageIntervalMs: 0,
        confidence: 0,
        sampleSize: 0,
      };
    }
  }

  /**
   * Recommend switching to an alternative account when the current
   * account is near its quota limit.
   *
   * Ranking formula: (1 - quotaPercentage) * 0.4 + successRate * 0.3 + (1 - latency/5000) * 0.3
   *
   * Requirements: 9.4
   *
   * @param currentAccountId - The current account ID
   * @param availableAccounts - All available accounts with quota info
   * @returns Switch recommendation or null if no switch needed
   */
  recommendAccountSwitch(
    currentAccountId: string,
    availableAccounts: AccountQuotaInfo[]
  ): SwitchRecommendation | null {
    try {
      // Find current account
      const currentAccount = availableAccounts.find((acc) => acc.accountId === currentAccountId);

      if (!currentAccount) {
        return null;
      }

      // Check if current account is near limit
      if (currentAccount.quotaPercentage < this.config.nearLimitThreshold) {
        return null;
      }

      // Filter accounts that are NOT near their limit
      const alternatives = availableAccounts.filter(
        (acc) =>
          acc.accountId !== currentAccountId && acc.quotaPercentage < this.config.nearLimitThreshold
      );

      if (alternatives.length === 0) {
        return null;
      }

      // Rank alternatives by composite score
      const ranked = alternatives
        .map((acc) => ({
          account: acc,
          score:
            (1 - acc.quotaPercentage) * 0.4 +
            acc.successRate * 0.3 +
            (1 - acc.averageLatency / 5000) * 0.3,
        }))
        .sort((a, b) => b.score - a.score);

      const best = ranked[0];
      const recommended = best.account;

      // Calculate expected savings and performance gain
      const { costSavings, performanceGain } = this.calculateExpectedSavings(
        currentAccount,
        recommended
      );

      // Confidence based on how much better the recommended account is
      const currentScore =
        (1 - currentAccount.quotaPercentage) * 0.4 +
        currentAccount.successRate * 0.3 +
        (1 - currentAccount.averageLatency / 5000) * 0.3;
      const scoreDifference = best.score - currentScore;
      const confidence = Math.min(Math.max(scoreDifference, 0), 1);

      const reason = `Account ${recommended.accountId} has ${Math.round((1 - recommended.quotaPercentage) * 100)}% quota remaining with ${Math.round(recommended.successRate * 100)}% success rate`;

      this.emit('switch_recommended', {
        currentAccountId,
        recommendedAccountId: recommended.accountId,
        reason,
      });

      return {
        currentAccountId,
        recommendedAccountId: recommended.accountId,
        reason,
        expectedCostSavings: costSavings,
        expectedPerformanceGain: performanceGain,
        confidence,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate expected cost savings and performance gain when
   * switching from one account to another.
   *
   * Cost savings: Based on latency improvement * estimated requests until reset
   * Performance gain: Based on success rate improvement percentage
   *
   * Requirements: 9.5
   *
   * @param current - Current account quota info
   * @param recommended - Recommended account quota info
   * @returns Cost savings and performance gain metrics
   */
  calculateExpectedSavings(
    current: AccountQuotaInfo,
    recommended: AccountQuotaInfo
  ): { costSavings: number; performanceGain: number } {
    // Latency improvement translates to cost savings (faster = fewer tokens wasted)
    const latencyImprovement = Math.max(0, current.averageLatency - recommended.averageLatency);

    // Estimate remaining requests until reset based on remaining quota
    const remainingQuota = recommended.quotaLimit - recommended.quotaUsed;
    // Assume average request uses ~1000 tokens
    const estimatedRequests = Math.max(1, remainingQuota / 1000);

    // Cost savings = latency reduction * estimated requests * token price factor
    // Latency improvement is in ms, convert to cost factor
    const latencyCostFactor = latencyImprovement / 1000; // $ per ms saved per request
    const costSavings = latencyCostFactor * estimatedRequests * (TOKEN_PRICE_PER_MILLION / 1000);

    // Performance gain: success rate improvement as a percentage
    const performanceGain = Math.max(0, recommended.successRate - current.successRate);

    return {
      costSavings: Math.round(costSavings * 10000) / 10000, // Round to 4 decimal places
      performanceGain: Math.round(performanceGain * 10000) / 10000,
    };
  }

  /**
   * Get reset history for an account.
   *
   * @param accountId - Account to get history for
   * @param limit - Maximum number of records to return (default: 100)
   * @param quotaType - Quota type to filter by (default: 'tpd')
   * @returns Array of reset history rows
   */
  getResetHistory(
    accountId: string,
    limit: number = 100,
    quotaType: 'rpm' | 'tpd' = 'tpd'
  ): ResetHistoryRow[] {
    const stmt = this.db.prepare(`
      SELECT id, account_id, timestamp, quota_type, interval_ms
      FROM prediction_reset_history
      WHERE account_id = ? AND quota_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(accountId, quotaType, limit) as ResetHistoryRow[];
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
