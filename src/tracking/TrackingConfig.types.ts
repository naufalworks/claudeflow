/**
 * Type definitions for Tracking Configuration
 *
 * Defines Zod schemas and types for usage tracking configuration.
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5
 */

import { z } from 'zod';

/**
 * Usage tracking configuration schema
 * Requirements: 20.1, 20.3
 */
export const UsageTrackingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  databasePath: z.string().min(1).default('~/.claudeflow/usage.db'),
  aggregationInterval: z.number().int().min(60).max(86400).default(3600),
  retentionDays: z.number().int().min(1).max(365).default(90),
});

/**
 * Real-time updates configuration schema
 * Requirements: 20.3, 20.4
 */
export const RealTimeUpdatesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(8080),
  batchInterval: z.number().int().min(10).max(10000).default(100),
  maxBatchSize: z.number().int().min(1).max(1000).default(10),
});

/**
 * Quota management configuration schema
 * Requirements: 20.2
 */
export const QuotaManagementConfigSchema = z.object({
  enabled: z.boolean().default(true),
  checkInterval: z.number().int().min(5).max(3600).default(60),
  predictiveEnabled: z.boolean().default(true),
});

/**
 * Audit logging configuration schema
 * Requirements: 20.5
 */
export const AuditLoggingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  logDir: z.string().min(1).default('~/.claudeflow/logs'),
  rotationInterval: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  retentionDays: z.number().int().min(1).max(365).default(90),
});

/**
 * Complete tracking configuration schema
 */
export const TrackingConfigSchema = z.object({
  usageTracking: UsageTrackingConfigSchema.default({}),
  realTimeUpdates: RealTimeUpdatesConfigSchema.default({}),
  quotaManagement: QuotaManagementConfigSchema.default({}),
  auditLogging: AuditLoggingConfigSchema.default({}),
});

/**
 * Inferred type from Zod schema
 */
export type TrackingConfig = z.infer<typeof TrackingConfigSchema>;

/**
 * Deep partial type for updates
 */
export type DeepPartial<T> = {
  [P in keyof T]?: Partial<T[P]>;
};

/**
 * Default configuration values
 */
export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  usageTracking: {
    enabled: true,
    databasePath: '~/.claudeflow/usage.db',
    aggregationInterval: 3600,
    retentionDays: 90,
  },
  realTimeUpdates: {
    enabled: true,
    port: 8080,
    batchInterval: 100,
    maxBatchSize: 10,
  },
  quotaManagement: {
    enabled: true,
    checkInterval: 60,
    predictiveEnabled: true,
  },
  auditLogging: {
    enabled: true,
    logDir: '~/.claudeflow/logs',
    rotationInterval: 'daily',
    retentionDays: 90,
  },
};
