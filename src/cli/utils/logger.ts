/**
 * Logger
 * 
 * Structured logging utility for CLI operations
 */

import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { LogSanitizer } from '../../utils/log-sanitizer.js';

/**
 * Log Level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log Entry
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: any;
}

/**
 * Logger Configuration
 */
interface LoggerConfig {
  logDir?: string;
  logFile?: string;
  consoleOutput?: boolean;
  colorOutput?: boolean;
  minLevel?: LogLevel;
}

/**
 * Logger
 * 
 * Handles structured logging with file and console output
 */
export class Logger {
  private logDir: string;
  private logPath: string;
  private consoleOutput: boolean;
  private colorOutput: boolean;
  private minLevel: LogLevel;

  private static levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: LoggerConfig = {}) {
    this.logDir = config.logDir || join(homedir(), '.claudeflow', 'logs');
    this.logPath = join(this.logDir, config.logFile || 'cli.log');
    this.consoleOutput = config.consoleOutput ?? true;
    this.colorOutput = config.colorOutput ?? true;
    this.minLevel = config.minLevel || 'info';

    // Ensure log directory exists
    this.ensureLogDirectory();
  }

  /**
   * Ensure log directory exists
   */
  private async ensureLogDirectory(): Promise<void> {
    if (!existsSync(this.logDir)) {
      await mkdir(this.logDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Check if log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return Logger.levelPriority[level] >= Logger.levelPriority[this.minLevel];
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format log entry for file
   */
  private formatLogEntry(entry: LogEntry): string {
    const metaStr = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${metaStr}\n`;
  }

  /**
   * Format log entry for console
   */
  private formatConsoleEntry(entry: LogEntry): string {
    const timestamp = chalk.gray(entry.timestamp);
    const level = this.colorizeLevel(entry.level);
    const message = this.colorizeMessage(entry.level, entry.message);
    const metaStr = entry.meta ? chalk.gray(` ${JSON.stringify(entry.meta)}`) : '';

    return `${timestamp} ${level} ${message}${metaStr}`;
  }

  /**
   * Colorize log level
   */
  private colorizeLevel(level: LogLevel): string {
    if (!this.colorOutput) {
      return `[${level.toUpperCase()}]`;
    }

    switch (level) {
      case 'debug':
        return chalk.blue('[DEBUG]');
      case 'info':
        return chalk.green('[INFO]');
      case 'warn':
        return chalk.yellow('[WARN]');
      case 'error':
        return chalk.red('[ERROR]');
    }
  }

  /**
   * Colorize message
   */
  private colorizeMessage(level: LogLevel, message: string): string {
    if (!this.colorOutput) {
      return message;
    }

    switch (level) {
      case 'debug':
        return chalk.blue(message);
      case 'info':
        return message;
      case 'warn':
        return chalk.yellow(message);
      case 'error':
        return chalk.red(message);
    }
  }

  /**
   * Mask sensitive data in logs
   * 
   * Delegates to LogSanitizer for comprehensive sanitization.
   */
  private maskSensitiveData(data: any): any {
    if (typeof data === 'string') {
      return LogSanitizer.sanitize(data);
    }

    if (typeof data === 'object' && data !== null) {
      return LogSanitizer.sanitizeObject(data);
    }

    return data;
  }

  /**
   * Write log entry
   */
  private async writeLog(level: LogLevel, message: string, meta?: any): Promise<void> {
    if (!this.shouldLog(level)) {
      return;
    }

    // Mask sensitive data
    const maskedMeta = meta ? this.maskSensitiveData(meta) : undefined;
    const maskedMessage = this.maskSensitiveData(message);

    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      message: maskedMessage,
      meta: maskedMeta,
    };

    // Write to console
    if (this.consoleOutput) {
      const consoleEntry = this.formatConsoleEntry(entry);
      console.log(consoleEntry);
    }

    // Write to file
    try {
      await this.ensureLogDirectory();
      const fileEntry = this.formatLogEntry(entry);
      await appendFile(this.logPath, fileEntry, { mode: 0o600 });
    } catch (error) {
      // If we can't write to log file, at least output to console
      if (!this.consoleOutput) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, meta?: any): void {
    void this.writeLog('debug', message, meta);
  }

  /**
   * Log info message
   */
  info(message: string, meta?: any): void {
    void this.writeLog('info', message, meta);
  }

  /**
   * Log warning message
   */
  warn(message: string, meta?: any): void {
    void this.writeLog('warn', message, meta);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | any): void {
    const meta = error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : error;

    void this.writeLog('error', message, meta);
  }

  /**
   * Set minimum log level
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Enable/disable console output
   */
  setConsoleOutput(enabled: boolean): void {
    this.consoleOutput = enabled;
  }

  /**
   * Enable/disable color output
   */
  setColorOutput(enabled: boolean): void {
    this.colorOutput = enabled;
  }

  /**
   * Get log file path
   */
  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger({
  minLevel: process.env.DEBUG === 'true' ? 'debug' : 'info',
  colorOutput: process.stdout.isTTY,
});
