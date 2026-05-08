/**
 * Background Job Scheduler
 *
 * Manages scheduled jobs for time-series data aggregation and cleanup.
 * Uses node-cron for proper cron scheduling with job locking and error handling.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 23.4, 23.5
 */

import * as cron from 'node-cron';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import { HourlyAggregation, DailyAggregation } from './TimeSeriesStorage.types.js';
import {
  JobStatus,
  AggregationResult,
  CleanupResult,
  BackgroundJobSchedulerConfig,
} from './BackgroundJobScheduler.types.js';

const DEFAULT_CONFIG: BackgroundJobSchedulerConfig = {
  enabled: true,
  jobs: {
    hourlyAggregation: {
      name: 'hourly-aggregation',
      schedule: '5 * * * *', // At :05 every hour
      enabled: true,
    },
    dailyAggregation: {
      name: 'daily-aggregation',
      schedule: '5 0 * * *', // At 00:05 every day
      enabled: true,
    },
    cleanup: {
      name: 'cleanup',
      schedule: '0 2 * * 0', // At 02:00 every Sunday
      enabled: true,
    },
  },
};

export class BackgroundJobScheduler {
  private storage: TimeSeriesStorage;
  private config: BackgroundJobSchedulerConfig;
  private jobs: Map<string, cron.ScheduledTask>;
  private jobStatus: Map<string, JobStatus>;
  private runningJobs: Set<string>;
  private shuttingDown: boolean;

  constructor(storage: TimeSeriesStorage, config: Partial<BackgroundJobSchedulerConfig> = {}) {
    this.storage = storage;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.jobs = new Map();
    this.jobStatus = new Map();
    this.runningJobs = new Set();
    this.shuttingDown = false;

    // Initialize job status
    for (const jobConfig of Object.values(this.config.jobs)) {
      this.jobStatus.set(jobConfig.name, {
        name: jobConfig.name,
        isRunning: false,
        runCount: 0,
        errorCount: 0,
      });
    }
  }

  /**
   * Start all scheduled jobs
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('BackgroundJobScheduler is disabled');
      return;
    }

    // Schedule hourly aggregation
    if (this.config.jobs.hourlyAggregation.enabled) {
      const task = cron.schedule(this.config.jobs.hourlyAggregation.schedule, () =>
        this.runJob('hourly-aggregation', () => this.aggregateHourlyData())
      );
      this.jobs.set('hourly-aggregation', task);
      console.log(`Scheduled hourly aggregation: ${this.config.jobs.hourlyAggregation.schedule}`);
    }

    // Schedule daily aggregation
    if (this.config.jobs.dailyAggregation.enabled) {
      const task = cron.schedule(this.config.jobs.dailyAggregation.schedule, () =>
        this.runJob('daily-aggregation', () => this.aggregateDailyData())
      );
      this.jobs.set('daily-aggregation', task);
      console.log(`Scheduled daily aggregation: ${this.config.jobs.dailyAggregation.schedule}`);
    }

    // Schedule cleanup
    if (this.config.jobs.cleanup.enabled) {
      const task = cron.schedule(this.config.jobs.cleanup.schedule, () =>
        this.runJob('cleanup', () => this.cleanupOldData())
      );
      this.jobs.set('cleanup', task);
      console.log(`Scheduled cleanup: ${this.config.jobs.cleanup.schedule}`);
    }
  }

  /**
   * Run a job with locking and error handling
   */
  private async runJob(
    jobName: string,
    handler: () => Promise<AggregationResult | CleanupResult>
  ): Promise<AggregationResult | CleanupResult | null> {
    // Check if shutting down
    if (this.shuttingDown) {
      console.log(`Skipping job ${jobName}: scheduler is shutting down`);
      return null;
    }

    // Check if job is already running (job locking)
    if (this.runningJobs.has(jobName)) {
      console.log(`Skipping job ${jobName}: already running`);
      return null;
    }

    const status = this.jobStatus.get(jobName)!;
    status.isRunning = true;
    status.runCount++;
    this.runningJobs.add(jobName);

    const startTime = Date.now();
    let result: AggregationResult | CleanupResult | null = null;

    try {
      console.log(`Starting job: ${jobName}`);

      result = await handler();

      status.lastRun = new Date();
      status.lastSuccess = new Date();
      status.lastError = undefined;

      console.log(
        `Job ${jobName} completed successfully in ${result.executionTime}ms: ${result.success ? 'SUCCESS' : 'PARTIAL'}`
      );

      if (result.errors.length > 0) {
        console.error(`Job ${jobName} had ${result.errors.length} errors:`, result.errors);
      }
    } catch (error) {
      status.lastRun = new Date();
      status.lastError = error instanceof Error ? error.message : String(error);
      status.errorCount++;

      console.error(`Job ${jobName} failed after ${Date.now() - startTime}ms:`, error);
    } finally {
      status.isRunning = false;
      this.runningJobs.delete(jobName);
    }

    return result;
  }

  /**
   * Aggregate hourly data from raw events
   * Requirements: 4.4, 4.5, 23.4, 23.5
   */
  private async aggregateHourlyData(): Promise<AggregationResult> {
    const startTime = Date.now();
    const result: AggregationResult = {
      success: true,
      recordsProcessed: 0,
      aggregationsCreated: 0,
      executionTime: 0,
      errors: [],
    };

    try {
      // Calculate time window for previous complete hour
      const now = Date.now();
      const previousHourStart = Math.floor(now / 3600000) * 3600000 - 3600000; // Previous hour start
      const previousHourEnd = previousHourStart + 3600000; // Previous hour end

      console.log(
        `Aggregating hourly data from ${new Date(previousHourStart).toISOString()} to ${new Date(previousHourEnd).toISOString()}`
      );

      // Query events from previous hour
      const events = await Promise.resolve(
        this.storage.queryEvents({
          start: new Date(previousHourStart),
          end: new Date(previousHourEnd),
        })
      );

      result.recordsProcessed = events.length;

      if (events.length === 0) {
        console.log('No events to aggregate for this hour');
        result.executionTime = Date.now() - startTime;
        return result;
      }

      // Aggregate by account, model, region
      const aggregations = new Map<string, HourlyAggregation>();

      for (const event of events) {
        try {
          // Validate event data
          if (!event.accountId || !event.model || !event.region) {
            result.errors.push(`Invalid event: missing required fields`);
            continue;
          }

          if (
            typeof event.inputTokens !== 'number' ||
            typeof event.outputTokens !== 'number' ||
            typeof event.cost !== 'number' ||
            typeof event.latency !== 'number'
          ) {
            result.errors.push(`Invalid event: numeric fields are not numbers`);
            continue;
          }

          const key = `${event.accountId}:${event.model}:${event.region}`;

          if (!aggregations.has(key)) {
            aggregations.set(key, {
              hourTimestamp: previousHourStart,
              accountId: event.accountId,
              model: event.model,
              region: event.region,
              requestCount: 0,
              totalTokens: 0,
              totalCost: 0,
              avgLatency: 0,
              successCount: 0,
              errorCount: 0,
            });
          }

          const agg = aggregations.get(key)!;
          agg.requestCount++;
          agg.totalTokens +=
            event.inputTokens +
            event.outputTokens +
            (event.cacheCreationTokens || 0) +
            (event.cacheReadTokens || 0);
          agg.totalCost += event.cost;
          agg.avgLatency += event.latency;

          if (event.status === 'success') {
            agg.successCount++;
          } else {
            agg.errorCount++;
          }
        } catch (error) {
          result.errors.push(`Error processing event: ${String(error)}`);
        }
      }

      // Calculate averages and insert aggregations
      for (const agg of aggregations.values()) {
        try {
          agg.avgLatency = agg.requestCount > 0 ? agg.avgLatency / agg.requestCount : 0;
          await Promise.resolve(this.storage.insertHourlyAggregation(agg));
          result.aggregationsCreated++;
        } catch (error) {
          result.errors.push(`Error inserting hourly aggregation: ${String(error)}`);
          result.success = false;
        }
      }

      console.log(
        `Created ${result.aggregationsCreated} hourly aggregations from ${result.recordsProcessed} events`
      );
    } catch (error) {
      result.success = false;
      result.errors.push(`Hourly aggregation failed: ${String(error)}`);
    }

    result.executionTime = Date.now() - startTime;
    return result;
  }

  /**
   * Aggregate daily data from raw events
   * Requirements: 4.4, 4.5, 23.4, 23.5
   */
  private async aggregateDailyData(): Promise<AggregationResult> {
    const startTime = Date.now();
    const result: AggregationResult = {
      success: true,
      recordsProcessed: 0,
      aggregationsCreated: 0,
      executionTime: 0,
      errors: [],
    };

    try {
      // Calculate time window for previous complete day
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const dayStart = yesterday.getTime();
      const dayEnd = dayStart + 86400000; // 24 hours

      const dateString = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

      console.log(
        `Aggregating daily data for ${dateString} from ${new Date(dayStart).toISOString()} to ${new Date(dayEnd).toISOString()}`
      );

      // Query events from previous day
      const events = await Promise.resolve(
        this.storage.queryEvents({
          start: new Date(dayStart),
          end: new Date(dayEnd),
        })
      );

      result.recordsProcessed = events.length;

      if (events.length === 0) {
        console.log('No events to aggregate for this day');
        result.executionTime = Date.now() - startTime;
        return result;
      }

      // Aggregate by account
      const aggregations = new Map<string, DailyAggregation>();

      for (const event of events) {
        try {
          // Validate event data
          if (!event.accountId) {
            result.errors.push(`Invalid event: missing accountId`);
            continue;
          }

          if (
            typeof event.inputTokens !== 'number' ||
            typeof event.outputTokens !== 'number' ||
            typeof event.cost !== 'number'
          ) {
            result.errors.push(`Invalid event: numeric fields are not numbers`);
            continue;
          }

          if (!aggregations.has(event.accountId)) {
            aggregations.set(event.accountId, {
              date: dateString,
              accountId: event.accountId,
              totalRequests: 0,
              totalTokens: 0,
              totalCost: 0,
            });
          }

          const agg = aggregations.get(event.accountId)!;
          agg.totalRequests++;
          agg.totalTokens +=
            event.inputTokens +
            event.outputTokens +
            (event.cacheCreationTokens || 0) +
            (event.cacheReadTokens || 0);
          agg.totalCost += event.cost;
        } catch (error) {
          result.errors.push(`Error processing event: ${String(error)}`);
        }
      }

      // Insert daily aggregations
      for (const agg of aggregations.values()) {
        try {
          await Promise.resolve(this.storage.insertDailyAggregation(agg));
          result.aggregationsCreated++;
        } catch (error) {
          result.errors.push(`Error inserting daily aggregation: ${String(error)}`);
          result.success = false;
        }
      }

      console.log(
        `Created ${result.aggregationsCreated} daily aggregations from ${result.recordsProcessed} events`
      );
    } catch (error) {
      result.success = false;
      result.errors.push(`Daily aggregation failed: ${String(error)}`);
    }

    result.executionTime = Date.now() - startTime;
    return result;
  }

  /**
   * Clean up old data based on retention policy
   * Requirements: 4.1, 4.2, 4.3
   */
  private async cleanupOldData(): Promise<CleanupResult> {
    const startTime = Date.now();
    const result: CleanupResult = {
      success: true,
      rawEventsDeleted: 0,
      hourlyAggregationsDeleted: 0,
      executionTime: 0,
      errors: [],
    };

    try {
      console.log('Starting data cleanup based on retention policy');

      // Get counts before cleanup
      const beforeRawEvents = await Promise.resolve(
        this.storage.getDatabase().prepare('SELECT COUNT(*) as count FROM usage_events').get() as {
          count: number;
        }
      );

      const beforeHourlyAggs = await Promise.resolve(
        this.storage.getDatabase().prepare('SELECT COUNT(*) as count FROM usage_hourly').get() as {
          count: number;
        }
      );

      // Run cleanup
      await Promise.resolve(this.storage.cleanupOldData());

      // Get counts after cleanup
      const afterRawEvents = await Promise.resolve(
        this.storage.getDatabase().prepare('SELECT COUNT(*) as count FROM usage_events').get() as {
          count: number;
        }
      );

      const afterHourlyAggs = await Promise.resolve(
        this.storage.getDatabase().prepare('SELECT COUNT(*) as count FROM usage_hourly').get() as {
          count: number;
        }
      );

      result.rawEventsDeleted = beforeRawEvents.count - afterRawEvents.count;
      result.hourlyAggregationsDeleted = beforeHourlyAggs.count - afterHourlyAggs.count;

      console.log(
        `Cleanup completed: deleted ${result.rawEventsDeleted} raw events, ${result.hourlyAggregationsDeleted} hourly aggregations`
      );
    } catch (error) {
      result.success = false;
      result.errors.push(`Cleanup failed: ${String(error)}`);
    }

    result.executionTime = Date.now() - startTime;
    return result;
  }

  /**
   * Get status of all jobs
   */
  getJobStatus(): Map<string, JobStatus> {
    return new Map(this.jobStatus);
  }

  /**
   * Stop all scheduled jobs gracefully
   */
  async stop(): Promise<void> {
    this.shuttingDown = true;

    console.log('Stopping BackgroundJobScheduler...');

    // Stop all cron tasks
    for (const [name, task] of this.jobs.entries()) {
      void task.stop();
      console.log(`Stopped job: ${name}`);
    }

    // Wait for running jobs to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.runningJobs.size > 0 && Date.now() - startTime < timeout) {
      console.log(`Waiting for ${this.runningJobs.size} running jobs to complete...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.runningJobs.size > 0) {
      console.warn(
        `Timeout waiting for jobs to complete. ${this.runningJobs.size} jobs still running.`
      );
    }

    this.jobs.clear();
    console.log('BackgroundJobScheduler stopped');
  }

  /**
   * Manually trigger a job (for testing)
   */
  async triggerJob(jobName: string): Promise<AggregationResult | CleanupResult> {
    let handler: () => Promise<AggregationResult | CleanupResult>;

    switch (jobName) {
      case 'hourly-aggregation':
        handler = () => this.aggregateHourlyData();
        break;
      case 'daily-aggregation':
        handler = () => this.aggregateDailyData();
        break;
      case 'cleanup':
        handler = () => this.cleanupOldData();
        break;
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }

    // Use runJob to ensure status tracking
    const result = await this.runJob(jobName, handler);

    if (result === null) {
      throw new Error(`Job ${jobName} did not return a result`);
    }

    return result;
  }
}
