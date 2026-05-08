/**
 * Type definitions for Background Job Scheduler
 *
 * Defines types for job configuration, status, and aggregation results.
 */

export interface JobConfig {
  name: string;
  schedule: string; // Cron pattern
  enabled: boolean;
}

export interface JobStatus {
  name: string;
  lastRun?: Date;
  lastSuccess?: Date;
  lastError?: string;
  isRunning: boolean;
  runCount: number;
  errorCount: number;
}

export interface AggregationResult {
  success: boolean;
  recordsProcessed: number;
  aggregationsCreated: number;
  executionTime: number; // milliseconds
  errors: string[];
}

export interface CleanupResult {
  success: boolean;
  rawEventsDeleted: number;
  hourlyAggregationsDeleted: number;
  executionTime: number; // milliseconds
  errors: string[];
}

export interface BackgroundJobSchedulerConfig {
  enabled: boolean;
  jobs: {
    hourlyAggregation: JobConfig;
    dailyAggregation: JobConfig;
    cleanup: JobConfig;
  };
}
