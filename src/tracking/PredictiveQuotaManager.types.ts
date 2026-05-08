/**
 * Type definitions for Predictive Quota Manager
 *
 * Defines types for reset time prediction, pattern detection,
 * and account switch recommendations.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

/** Result of reset time prediction */
export interface PredictionResult {
  accountId: string;
  predictedResetTime: Date;
  confidence: number; // 0-1, based on sample size and variance
  detectedPattern: 'hourly' | 'daily' | 'monthly' | 'unknown';
  averageIntervalMs: number;
  sampleSize: number;
}

/** Detected reset pattern for an account */
export interface ResetPattern {
  accountId: string;
  pattern: 'hourly' | 'daily' | 'monthly' | 'unknown';
  averageIntervalMs: number;
  confidence: number;
  sampleSize: number;
}

/** Recommendation to switch accounts */
export interface SwitchRecommendation {
  currentAccountId: string;
  recommendedAccountId: string;
  reason: string;
  expectedCostSavings: number;
  expectedPerformanceGain: number;
  confidence: number;
}

/** Account info for switch recommendations */
export interface AccountQuotaInfo {
  accountId: string;
  quotaUsed: number;
  quotaLimit: number;
  quotaPercentage: number;
  averageLatency: number;
  successRate: number;
}

/** Configuration for PredictiveQuotaManager */
export interface PredictiveQuotaConfig {
  emaAlpha: number; // Exponential moving average smoothing factor (default: 0.3)
  minSampleSize: number; // Minimum samples for prediction (default: 3)
  patternTolerance: number; // Tolerance for pattern detection (default: 0.1 = 10%)
  nearLimitThreshold: number; // Threshold for switch recommendation (default: 0.95)
}

/** Database row for reset history */
export interface ResetHistoryRow {
  id: number;
  account_id: string;
  timestamp: number;
  quota_type: string;
  interval_ms: number | null;
}
