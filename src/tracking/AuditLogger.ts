/**
 * Audit Logger
 *
 * Comprehensive audit logging for usage events, quota updates,
 * account selections, and errors. Uses dual storage with SQLite
 * for structured queries and daily JSON Lines files for backup/compliance.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 18.4, 18.5
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  UsageEventLog,
  QuotaUpdateLog,
  AccountSelectionLog,
  ErrorLog,
  LogQuery,
  LogEntry,
  AuditLoggerConfig,
  AuditLogRow,
} from './AuditLogger.types.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AuditLoggerConfig = {
  logDirectory: path.join(process.env.HOME || '', '.claudeflow', 'logs'),
  retentionDays: 90,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  sanitizeKeys: [
    'apiKey',
    'accessToken',
    'sessionToken',
    'password',
    'secret',
    'token',
    'authorization',
  ],
};

/**
 * Audit Logger
 *
 * Provides comprehensive audit logging with dual storage:
 * - SQLite for structured queries
 * - Daily JSON Lines files for backup/compliance
 */
export class AuditLogger extends EventEmitter {
  private db: Database.Database;
  private config: AuditLoggerConfig;
  private currentLogDate: string;

  // Prepared statements for performance
  private stmtInsertLog: Database.Statement;
  private stmtDeleteOldLogs: Database.Statement;
  private stmtCountLogs: Database.Statement;

  constructor(config?: Partial<AuditLoggerConfig>) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure log directory exists
    if (!fs.existsSync(this.config.logDirectory)) {
      fs.mkdirSync(this.config.logDirectory, { recursive: true });
    }

    // Initialize database
    const dbPath = path.join(this.config.logDirectory, 'audit.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.currentLogDate = this.getFormattedDate(new Date());

    this.initializeSchema();

    // Prepare statements for repeated use
    this.stmtInsertLog = this.db.prepare(`
      INSERT INTO audit_logs (timestamp, log_type, account_id, data)
      VALUES (?, ?, ?, ?)
    `);

    this.stmtDeleteOldLogs = this.db.prepare(`
      DELETE FROM audit_logs WHERE timestamp < ?
    `);

    this.stmtCountLogs = this.db.prepare(`
      SELECT COUNT(*) as count FROM audit_logs WHERE timestamp < ?
    `);
  }

  /**
   * Initialize database schema for audit logging
   */
  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        log_type TEXT NOT NULL,
        account_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs (timestamp);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_logs (account_id);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_logs (log_type);
    `);
  }

  /**
   * Log a usage event - Req 10.1
   *
   * @param event - Usage event data
   */
  logUsageEvent(event: UsageEventLog): void {
    try {
      const sanitized = this.sanitize(event as unknown as Record<string, unknown>);
      this.writeLogEntry('usage', event.accountId, sanitized);
      this.emit('usage_logged', event);
    } catch (error) {
      console.error('[AuditLogger] Failed to log usage event:', error);
    }
  }

  /**
   * Log a quota update - Req 10.2
   *
   * @param update - Quota update data
   */
  logQuotaUpdate(update: QuotaUpdateLog): void {
    try {
      const sanitized = this.sanitize(update as unknown as Record<string, unknown>);
      this.writeLogEntry('quota', update.accountId, sanitized);
      this.emit('quota_logged', update);
    } catch (error) {
      console.error('[AuditLogger] Failed to log quota update:', error);
    }
  }

  /**
   * Log an account selection - Req 10.3
   *
   * @param selection - Account selection data
   */
  logAccountSelection(selection: AccountSelectionLog): void {
    try {
      const sanitized = this.sanitize(selection as unknown as Record<string, unknown>);
      this.writeLogEntry('selection', selection.selectedAccountId, sanitized);
      this.emit('selection_logged', selection);
    } catch (error) {
      console.error('[AuditLogger] Failed to log account selection:', error);
    }
  }

  /**
   * Log an error - Req 10.4
   *
   * @param error - Error log data
   */
  logError(error: ErrorLog): void {
    try {
      const sanitized = this.sanitize(error as unknown as Record<string, unknown>);
      this.writeLogEntry('error', error.accountId, sanitized);
      this.emit('error_logged', error);
    } catch (error) {
      console.error('[AuditLogger] Failed to log error:', error);
    }
  }

  /**
   * Query logs with filters
   *
   * @param query - Query parameters for filtering logs
   * @returns Array of log entries matching the query
   */
  queryLogs(query: LogQuery): LogEntry[] {
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.startTime) {
        conditions.push('timestamp >= ?');
        params.push(query.startTime.getTime());
      }

      if (query.endTime) {
        conditions.push('timestamp <= ?');
        params.push(query.endTime.getTime());
      }

      if (query.accountId) {
        conditions.push('account_id = ?');
        params.push(query.accountId);
      }

      if (query.logType) {
        conditions.push('log_type = ?');
        params.push(query.logType);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const limit = query.limit ?? 1000;
      const offset = query.offset ?? 0;

      const stmt = this.db.prepare(`
        SELECT id, timestamp, log_type, account_id, data
        FROM audit_logs
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `);

      const rows = stmt.all(...params, limit, offset) as AuditLogRow[];

      return rows.map((row) => {
        // JSON.parse returns any - suppressed for audit log deserialization
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsedData = JSON.parse(row.data);
        return {
          type: row.log_type as LogEntry['type'],
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: parsedData,
        } as unknown as LogEntry;
      });
    } catch (error) {
      console.error('[AuditLogger] Failed to query logs:', error);
      return [];
    }
  }

  /**
   * Cleanup old logs beyond retention period - Req 18.4
   * Removes old entries from both SQLite and daily log files.
   *
   * @returns Number of deleted entries
   */
  cleanupOldLogs(): number {
    try {
      const cutoffTime = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;

      // Get count before deletion
      const countResult = this.stmtCountLogs.get(cutoffTime) as { count: number };
      const deletedCount = countResult.count;

      // Delete old entries from SQLite
      this.stmtDeleteOldLogs.run(cutoffTime);

      // Clean up old log files
      this.cleanupOldLogFiles(cutoffTime);

      return deletedCount;
    } catch (error) {
      console.error('[AuditLogger] Failed to cleanup old logs:', error);
      return 0;
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    try {
      this.db.close();
    } catch (error) {
      console.error('[AuditLogger] Failed to close database:', error);
    }
  }

  /**
   * Sanitize sensitive data - Req 18.5
   * Replaces values of sensitive keys with [REDACTED]
   *
   * @param data - Data object to sanitize
   * @returns Sanitized copy of the data
   */
  private sanitize(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const entries = Object.entries(data);

    for (const [key, value] of entries) {
      if (this.config.sanitizeKeys.includes(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitize(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Rotate log file if date has changed - Req 10.5
   */
  private rotateLogIfNeeded(): void {
    const today = this.getFormattedDate(new Date());
    if (today !== this.currentLogDate) {
      this.currentLogDate = today;
    }
  }

  /**
   * Write a log entry to both SQLite and daily log file
   *
   * @param logType - Type of log entry
   * @param accountId - Account ID associated with the entry
   * @param data - Log entry data (already sanitized)
   */
  private writeLogEntry(logType: string, accountId: string, data: Record<string, unknown>): void {
    const timestamp = Date.now();

    // Insert into SQLite
    this.stmtInsertLog.run(timestamp, logType, accountId, JSON.stringify(data));

    // Write to daily log file
    this.rotateLogIfNeeded();
    const logEntry = JSON.stringify({
      timestamp,
      type: logType,
      accountId,
      ...data,
    });

    this.writeToFile(logEntry);
  }

  /**
   * Append a JSON line to the daily log file
   *
   * @param entry - JSON string to append
   */
  private writeToFile(entry: string): void {
    try {
      const logFilePath = this.getLogFilePath(this.currentLogDate);
      fs.appendFileSync(logFilePath, entry + '\n', 'utf-8');
    } catch (error) {
      console.error('[AuditLogger] Failed to write to log file:', error);
    }
  }

  /**
   * Get the log file path for a given date
   *
   * @param date - Date string in YYYY-MM-DD format
   * @returns Full path to the log file
   */
  private getLogFilePath(date: string): string {
    return path.join(this.config.logDirectory, `audit-${date}.jsonl`);
  }

  /**
   * Get formatted date string (YYYY-MM-DD)
   *
   * @param date - Date to format
   * @returns Formatted date string
   */
  private getFormattedDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Clean up old daily log files beyond retention period
   *
   * @param cutoffTime - Timestamp cutoff for deletion
   */
  private cleanupOldLogFiles(cutoffTime: number): void {
    try {
      const files = fs.readdirSync(this.config.logDirectory);
      const logFiles = files.filter((file) => file.startsWith('audit-') && file.endsWith('.jsonl'));

      for (const file of logFiles) {
        // Extract date from filename: audit-YYYY-MM-DD.jsonl
        const dateStr = file.replace('audit-', '').replace('.jsonl', '');
        const fileDate = new Date(dateStr);

        if (!isNaN(fileDate.getTime()) && fileDate.getTime() < cutoffTime) {
          const filePath = path.join(this.config.logDirectory, file);
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      console.error('[AuditLogger] Failed to cleanup old log files:', error);
    }
  }
}
