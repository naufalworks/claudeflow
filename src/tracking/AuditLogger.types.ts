/**
 * Type definitions for Audit Logger
 *
 * Defines types for usage event logging, quota update tracking,
 * account selection logging, error logging, and log queries.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 18.4, 18.5
 */

/** Usage event log entry - Req 10.1 */
export interface UsageEventLog {
  timestamp: Date;
  accountId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  latency: number;
  status: 'success' | 'error';
  errorCode?: string;
}

/** Quota update log entry - Req 10.2 */
export interface QuotaUpdateLog {
  timestamp: Date;
  accountId: string;
  quotaUsed: number;
  quotaLimit: number;
  quotaPercentage: number;
  resetTime: Date;
}

/** Account selection log entry - Req 10.3 */
export interface AccountSelectionLog {
  timestamp: Date;
  selectedAccountId: string;
  availableAccounts: string[];
  selectionReason: string;
  score: number;
}

/** Error log entry - Req 10.4 */
export interface ErrorLog {
  timestamp: Date;
  accountId: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
}

/** Query for searching logs */
export interface LogQuery {
  startTime?: Date;
  endTime?: Date;
  accountId?: string;
  logType?: 'usage' | 'quota' | 'selection' | 'error';
  limit?: number;
  offset?: number;
}

/** Any log entry (union type) */
export type LogEntry =
  | { type: 'usage'; data: UsageEventLog }
  | { type: 'quota'; data: QuotaUpdateLog }
  | { type: 'selection'; data: AccountSelectionLog }
  | { type: 'error'; data: ErrorLog };

/** Configuration for AuditLogger */
export interface AuditLoggerConfig {
  logDirectory: string;
  retentionDays: number;
  maxFileSize: number; // bytes
  sanitizeKeys: string[]; // keys to sanitize from logs
}

/** Database row for log entries */
export interface AuditLogRow {
  id: number;
  timestamp: number;
  log_type: string;
  account_id: string;
  data: string; // JSON string
}
