/**
 * Analytics Command
 * 
 * Display and export analytics metrics
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { AnalyticsService, TimeRange } from '../services/analytics-service.js';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';

/**
 * Analytics command options
 */
interface AnalyticsOptions {
  detailed?: boolean;
  range?: TimeRange;
}

/**
 * Export command options
 */
interface ExportOptions {
  format: 'json' | 'csv';
  output: string;
  range?: TimeRange;
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format currency
 */
function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

/**
 * Format percentage
 */
function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Get color for percentage
 */
function getPercentageColor(value: number, inverse: boolean = false): (text: string) => string {
  if (inverse) {
    // For error rates - lower is better
    if (value < 1) return chalk.green;
    if (value < 5) return chalk.yellow;
    return chalk.red;
  } else {
    // For cache hit rates - higher is better
    if (value > 80) return chalk.green;
    if (value > 50) return chalk.yellow;
    return chalk.red;
  }
}

/**
 * Analytics show command
 */
export async function analyticsShowCommand(options: AnalyticsOptions): Promise<void> {
  try {
    logger.info('Starting analytics show command', { options });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const analyticsService = new AnalyticsService();
    analyticsService.initialize();

    const timeRange = options.range || '24h';

    // Get metrics
    const metrics = options.detailed
      ? analyticsService.getDetailedMetrics(timeRange)
      : analyticsService.getMetrics(timeRange);

    // Display header
    console.log(chalk.blue.bold('\n📊 Analytics Report\n'));
    console.log(chalk.gray(`Time Range: ${timeRange}`));
    console.log(chalk.gray('─'.repeat(60)));

    // Summary table
    const summaryTable = new Table({
      head: [chalk.cyan('Metric'), chalk.cyan('Value')],
      colWidths: [30, 30],
    });

    summaryTable.push(
      ['Total Requests', formatNumber(metrics.totalRequests)],
      ['Total Cost', chalk.yellow(formatCurrency(metrics.totalCost))],
      ['Total Tokens', formatNumber(metrics.totalTokens)],
      ['Avg Response Time', formatDuration(metrics.avgResponseTime)],
      [
        'Cache Hit Rate',
        getPercentageColor(metrics.cacheHitRate)(formatPercentage(metrics.cacheHitRate)),
      ],
      [
        'Error Rate',
        getPercentageColor(metrics.errorRate, true)(formatPercentage(metrics.errorRate)),
      ]
    );

    console.log(chalk.bold('\n📈 Summary\n'));
    console.log(summaryTable.toString());

    // Requests by model
    if (Object.keys(metrics.requestsByModel).length > 0) {
      const modelTable = new Table({
        head: [chalk.cyan('Model'), chalk.cyan('Requests'), chalk.cyan('Cost')],
        colWidths: [40, 15, 15],
      });

      for (const [model, count] of Object.entries(metrics.requestsByModel)) {
        const cost = metrics.costByModel[model] || 0;
        modelTable.push([model, formatNumber(count), formatCurrency(cost)]);
      }

      console.log(chalk.bold('\n🤖 Requests by Model\n'));
      console.log(modelTable.toString());
    }

    // Requests by complexity
    if (Object.keys(metrics.requestsByComplexity).length > 0) {
      const complexityTable = new Table({
        head: [chalk.cyan('Complexity'), chalk.cyan('Requests')],
        colWidths: [30, 20],
      });

      for (const [complexity, count] of Object.entries(metrics.requestsByComplexity)) {
        complexityTable.push([complexity, formatNumber(count)]);
      }

      console.log(chalk.bold('\n⚡ Requests by Complexity\n'));
      console.log(complexityTable.toString());
    }

    // Detailed metrics
    if (options.detailed) {
      const detailedMetrics = metrics as any; // Type assertion for detailed metrics
      
      // Top accounts
      if (detailedMetrics.topAccounts && Array.isArray(detailedMetrics.topAccounts) && detailedMetrics.topAccounts.length > 0) {
        const accountTable = new Table({
          head: [chalk.cyan('Account ID'), chalk.cyan('Requests'), chalk.cyan('Cost')],
          colWidths: [30, 15, 15],
        });

        for (const account of detailedMetrics.topAccounts) {
          accountTable.push([
            account.accountId,
            formatNumber(account.requests),
            formatCurrency(account.cost),
          ]);
        }

        console.log(chalk.bold('\n👥 Top Accounts\n'));
        console.log(accountTable.toString());
      }

      // Requests by hour (last 24 hours)
      if (detailedMetrics.requestsByHour && Array.isArray(detailedMetrics.requestsByHour) && detailedMetrics.requestsByHour.length > 0) {
        console.log(chalk.bold('\n📅 Requests by Hour (Last 24h)\n'));
        
        const maxCount = Math.max(...detailedMetrics.requestsByHour.map((h: any) => h.count));
        const barWidth = 40;

        for (const hourData of detailedMetrics.requestsByHour.slice(-24)) {
          const barLength = Math.round((hourData.count / maxCount) * barWidth);
          const bar = '█'.repeat(barLength);
          console.log(
            `${chalk.gray(hourData.hour)} ${chalk.blue(bar)} ${chalk.bold(
              formatNumber(hourData.count)
            )}`
          );
        }
      }
    }

    // Generate insights
    const insights = analyticsService.generateInsights(metrics);

    if (insights.length > 0) {
      console.log(chalk.bold('\n💡 Insights\n'));

      for (const insight of insights) {
        let icon = '';
        let color = chalk.white;

        switch (insight.type) {
          case 'info':
            icon = 'ℹ️';
            color = chalk.blue;
            break;
          case 'warning':
            icon = '⚠️';
            color = chalk.yellow;
            break;
          case 'recommendation':
            icon = '💡';
            color = chalk.cyan;
            break;
        }

        console.log(color(`${icon} ${chalk.bold(insight.title)}`));
        console.log(color(`   ${insight.message}\n`));
      }
    }

    // Footer
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Export data: claudeflow analytics export --format json --output data.json'));

    analyticsService.close();

    logger.info('Analytics show command completed successfully');
  } catch (error) {
    logger.error('Analytics show command failed', error);

    if (error instanceof Error && error.message.includes('SQLITE_CANTOPEN')) {
      console.error(chalk.red('\n✗ Analytics database not found'));
      console.log(chalk.gray('The daemon needs to run and process requests to generate analytics data'));
    } else {
      console.error(
        chalk.red('\n✗ Error:'),
        error instanceof Error ? error.message : String(error)
      );
    }

    process.exit(1);
  }
}

/**
 * Analytics export command
 */
export async function analyticsExportCommand(options: ExportOptions): Promise<void> {
  try {
    logger.info('Starting analytics export command', { options });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const analyticsService = new AnalyticsService();
    analyticsService.initialize();

    const timeRange = options.range || '24h';

    console.log(chalk.blue(`\n📤 Exporting analytics data (${timeRange})...\n`));

    // Export based on format
    if (options.format === 'json') {
      await analyticsService.exportToJSON(options.output, timeRange);
      console.log(chalk.green(`✓ Data exported to JSON: ${options.output}`));
    } else if (options.format === 'csv') {
      await analyticsService.exportToCSV(options.output, timeRange);
      console.log(chalk.green(`✓ Data exported to CSV: ${options.output}`));
    }

    analyticsService.close();

    logger.info('Analytics export command completed successfully');
  } catch (error) {
    logger.error('Analytics export command failed', error);

    if (error instanceof Error && error.message.includes('SQLITE_CANTOPEN')) {
      console.error(chalk.red('\n✗ Analytics database not found'));
      console.log(chalk.gray('The daemon needs to run and process requests to generate analytics data'));
    } else {
      console.error(
        chalk.red('\n✗ Error:'),
        error instanceof Error ? error.message : String(error)
      );
    }

    process.exit(1);
  }
}
