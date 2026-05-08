/**
 * Type definitions for Quota Management Manager
 *
 * Defines types for quota tracking, account ranking, and quota status.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 25.1, 25.2, 25.3, 25.4, 25.5
 */

/**
 * Quota limits for an account
 */
export interface QuotaLimits {
  requestsPerMinute: number;
  tokensPerDay: number;
}

/**
 * Quota usage for a specific time window
 */
export interface QuotaUsage {
  used: number;
  limit: number;
  resetTime: Date;
}

/**
 * Complete quota status for an account
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
export interface QuotaStatus {
  accountId: string;
  requestsPerMinute: QuotaUsage;
  tokensPerDay: QuotaUsage;
  status: 'available' | 'near_limit' | 'exceeded';
}

/**
 * Ranked account with availability score
 *
 * Requirements: 8.1, 8.2, 8.3
 */
export interface RankedAccount {
  accountId: string;
  score: number;
  quotaRemaining: number;
  quotaPercentage: number;
  resetTime: Date;
  averageLatency: number;
  successRate: number;
  reason: string;
  status?: 'available' | 'near_limit' | 'exceeded'; // Internal use for ranking logic
}

/**
 * Quota reset detection event
 *
 * Requirements: 25.1, 25.2, 25.3, 25.4, 25.5
 */
export interface QuotaResetEvent {
  accountId: string;
  timestamp: Date;
  previousUsage: number;
  currentUsage: number;
  decreasePercentage: number;
  quotaType: 'rpm' | 'tpd';
}

/**
 * Configuration for quota management
 */
export interface QuotaConfig {
  defaultLimits: QuotaLimits;
  nearLimitThreshold: number; // Percentage (e.g., 0.95 for 95%)
  resetDetectionThreshold: number; // Percentage decrease (e.g., 0.5 for 50%)
}

/**
 * Internal quota tracking data
 */
export interface QuotaTrackingData {
  accountId: string;
  requestsThisMinute: number;
  tokensToday: number;
  lastMinuteTimestamp: number;
  lastDayTimestamp: number;
  limits: QuotaLimits;
  lastResetDetection?: Date;
}

/**
 * Database row type for quota_tracking table
 */
export interface QuotaTrackingRow {
  account_id: string;
  requests_this_minute: number;
  tokens_today: number;
  last_minute_timestamp: number;
  last_day_timestamp: number;
  rpm_limit: number;
  tpd_limit: number;
  last_reset_detection: number | null;
}
