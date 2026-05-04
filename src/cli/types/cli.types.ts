/**
 * CLI Type Definitions
 * 
 * Core type definitions for ClaudeFlow CLI Tool
 */

import type { Account } from '../../config/schema.js';

/**
 * CLI Configuration
 */
export interface CLIConfig {
  version: string;
  activeProfile: string;
  accounts: Account[];
  combos: KiroComboConfig[];
  infrastructure: InfrastructureConfig;
  daemon: DaemonConfig;
  preferences: PreferencesConfig;
}

/**
 * Kiro Account Configuration
 */
export interface KiroAccountConfig {
  id: string;
  machineId: string;
  apiKey: string;
  sessionToken?: string;
  sessionExpiry?: number;
  mitmRouterUrl: string;
  lastUsed?: number;
  requestCount?: number;
}

/**
 * Kiro Combo Configuration
 */
export interface KiroComboConfig {
  name: string;
  accounts: string[];
  strategy: 'round-robin' | 'sticky-round-robin';
  currentIndex: number;
}

/**
 * Infrastructure Configuration
 */
export interface InfrastructureConfig {
  qdrantUrl: string;
  redisUrl: string;
  voyageApiKey: string;
  mitmRouterUrl: string;
}

/**
 * Daemon Configuration
 */
export interface DaemonConfig {
  port: number;
  host: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  autoRestart: boolean;
}

/**
 * Preferences Configuration
 */
export interface PreferencesConfig {
  colorOutput: boolean;
  progressBars: boolean;
  autoUpdate: boolean;
}

/**
 * Session Status
 */
export interface SessionStatus {
  accountId: string;
  isValid: boolean;
  expiresAt?: Date;
  expiresIn?: string;
  needsRefresh: boolean;
}

/**
 * Daemon Status
 */
export interface DaemonStatus {
  isRunning: boolean;
  pid?: number;
  uptime?: number;
  memoryUsage?: number;
  port?: number;
  status?: string;
}

/**
 * Component Status
 */
export interface ComponentStatus {
  name: string;
  healthy: boolean;
  message?: string;
  latency?: number;
}

/**
 * Health Status
 */
export interface HealthStatus {
  overall: boolean;
  components: ComponentStatus[];
  timestamp: Date;
}

/**
 * Backup Metadata
 */
export interface Backup {
  id: string;
  timestamp: Date;
  size: number;
  path: string;
  includes: string[];
}

/**
 * Analytics Metrics
 */
export interface Metrics {
  totalRequests: number;
  totalCost: number;
  cacheHitRate: number;
  averageResponseTime: number;
  deduplicationRate: number;
  compressionRatio: number;
  timeRange: TimeRange;
  breakdown: MetricsBreakdown;
}

/**
 * Detailed Metrics
 */
export interface DetailedMetrics extends Metrics {
  byModel: Record<string, ModelMetrics>;
  byComplexity: Record<string, ComplexityMetrics>;
  byAccount: Record<string, AccountMetrics>;
  byAccountType: Record<string, AccountTypeMetrics>;
}

/**
 * Model Metrics
 */
export interface ModelMetrics {
  requests: number;
  cost: number;
  averageResponseTime: number;
  cacheHitRate: number;
}

/**
 * Complexity Metrics
 */
export interface ComplexityMetrics {
  requests: number;
  cost: number;
  averageResponseTime: number;
}

/**
 * Account Metrics
 */
export interface AccountMetrics {
  requests: number;
  cost: number;
  averageResponseTime: number;
  errorRate: number;
}

/**
 * Account Type Metrics
 */
export interface AccountTypeMetrics {
  requests: number;
  cost: number;
  savingsVsPaid: number;
}

/**
 * Metrics Breakdown
 */
export interface MetricsBreakdown {
  byModel: Record<string, number>;
  byComplexity: Record<string, number>;
  byAccountType: Record<string, number>;
}

/**
 * Time Range
 */
export type TimeRange = '24h' | '7d' | '30d';

/**
 * Insight
 */
export interface Insight {
  type: 'cost_optimization' | 'performance' | 'quality';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommendation: string;
  potentialSavings?: number;
}

/**
 * Test Result
 */
export interface TestResult {
  success: boolean;
  duration: number;
  message: string;
  details?: any;
}

/**
 * Global CLI Options
 */
export interface GlobalOptions {
  debug?: boolean;
  profile?: string;
}

/**
 * Login Options
 */
export interface LoginOptions {
  machineId?: string;
  apiKey?: string;
}

/**
 * Quota Options
 */
export interface QuotaOptions {
  account?: string;
}

/**
 * Logs Options
 */
export interface LogsOptions {
  follow?: boolean;
  lines?: number;
  level?: 'debug' | 'info' | 'warn' | 'error';
  clear?: boolean;
}

/**
 * Analytics Options
 */
export interface AnalyticsOptions {
  detailed?: boolean;
  range?: TimeRange;
}

/**
 * Export Options
 */
export interface ExportOptions {
  format: 'json' | 'csv';
  output?: string;
}

/**
 * Credentials
 */
export interface Credentials {
  machineId: string;
  apiKey: string;
  mitmRouterUrl?: string;
}

/**
 * Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Column Definition for Tables
 */
export interface Column {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
}
