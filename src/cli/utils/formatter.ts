/**
 * Formatter Utility
 * 
 * Formatting utilities for CLI output
 */

import Table from 'cli-table3';
import chalk from 'chalk';

/**
 * Format a table with headers and rows
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  options?: {
    colWidths?: number[];
    style?: 'compact' | 'default';
  }
): string {
  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    colWidths: options?.colWidths,
    style: {
      head: [],
      border: options?.style === 'compact' ? ['gray'] : ['gray'],
    },
  });

  for (const row of rows) {
    table.push(row);
  }

  return table.toString();
}

/**
 * Format a progress bar
 */
export function formatProgressBar(
  current: number,
  total: number,
  options?: {
    width?: number;
    showPercentage?: boolean;
    colorize?: boolean;
  }
): string {
  const width = options?.width || 40;
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;

  let bar = '█'.repeat(filled) + '░'.repeat(empty);

  // Colorize based on percentage
  if (options?.colorize !== false) {
    if (percentage >= 90) {
      bar = chalk.red(bar);
    } else if (percentage >= 80) {
      bar = chalk.yellow(bar);
    } else {
      bar = chalk.green(bar);
    }
  }

  if (options?.showPercentage !== false) {
    return `${bar} ${percentage.toFixed(1)}%`;
  }

  return bar;
}

/**
 * Format a timestamp
 */
export function formatTimestamp(date: Date | number | string): string {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format a duration in milliseconds to human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format file size in bytes to human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format currency (USD)
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

/**
 * Format a number with thousands separators
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Format a percentage
 */
export function formatPercentage(value: number, total: number): string {
  if (total === 0) return '0%';
  const percentage = (value / total) * 100;
  return `${percentage.toFixed(1)}%`;
}

/**
 * Format relative time (e.g., "2 hours ago", "in 5 minutes")
 */
export function formatRelativeTime(date: Date | number | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffSec = Math.floor(Math.abs(diffMs) / 1000);
  const isPast = diffMs < 0;

  if (diffSec < 60) {
    return isPast ? 'just now' : 'in a few seconds';
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    const unit = diffMin === 1 ? 'minute' : 'minutes';
    return isPast ? `${diffMin} ${unit} ago` : `in ${diffMin} ${unit}`;
  }

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    const unit = diffHour === 1 ? 'hour' : 'hours';
    return isPast ? `${diffHour} ${unit} ago` : `in ${diffHour} ${unit}`;
  }

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) {
    const unit = diffDay === 1 ? 'day' : 'days';
    return isPast ? `${diffDay} ${unit} ago` : `in ${diffDay} ${unit}`;
  }

  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) {
    const unit = diffMonth === 1 ? 'month' : 'months';
    return isPast ? `${diffMonth} ${unit} ago` : `in ${diffMonth} ${unit}`;
  }

  const diffYear = Math.floor(diffMonth / 12);
  const unit = diffYear === 1 ? 'year' : 'years';
  return isPast ? `${diffYear} ${unit} ago` : `in ${diffYear} ${unit}`;
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Pad string to specified length
 */
export function pad(str: string, length: number, char: string = ' '): string {
  if (str.length >= length) return str;
  return str + char.repeat(length - str.length);
}

/**
 * Format key-value pairs
 */
export function formatKeyValue(
  pairs: Record<string, string | number | boolean>,
  options?: {
    indent?: number;
    separator?: string;
  }
): string {
  const indent = ' '.repeat(options?.indent || 0);
  const separator = options?.separator || ': ';
  const lines: string[] = [];

  for (const [key, value] of Object.entries(pairs)) {
    lines.push(`${indent}${chalk.bold(key)}${separator}${value}`);
  }

  return lines.join('\n');
}
