/**
 * Quota Command
 * 
 * Display quota usage with visual progress bars
 * Integrates with QuotaTracker for per-account quota monitoring
 */

import chalk from 'chalk';
// @ts-ignore - cli-progress doesn't have type definitions
import cliProgress from 'cli-progress';
import { ConfigurationManager } from '../../config/manager.js';
import { QuotaTracker } from '../../accounts/quota-tracker.js';
import { logger } from '../utils/logger.js';
import type { KiroOAuthAccount } from '../../config/schema.js';

/**
 * Quota data structure
 */
interface QuotaData {
  accountId: string;
  requestsPerMinute: {
    current: number;
    limit: number;
    percentage: number;
  };
  requestsPerHour: {
    current: number;
    limit: number;
    percentage: number;
  };
  requestsPerDay: {
    current: number;
    limit: number;
    percentage: number;
  };
  resetTime?: Date;
}

/**
 * Quota command options
 */
interface QuotaOptions {
  account?: string;
  watch?: boolean;
}

/**
 * Get color based on percentage
 */
function getColor(percentage: number): (text: string) => string {
  if (percentage < 80) {
    return chalk.green;
  } else if (percentage < 90) {
    return chalk.yellow;
  } else {
    return chalk.red;
  }
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format time until reset
 */
function formatTimeUntilReset(resetTime: Date): string {
  const now = new Date();
  const diff = resetTime.getTime() - now.getTime();

  if (diff <= 0) {
    return 'Resetting now';
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Fetch quota data from QuotaTracker
 */
async function fetchQuotaData(
  configManager: ConfigurationManager,
  accountId?: string
): Promise<QuotaData[]> {
  try {
    const config = configManager.getConfig();
    const quotaData: QuotaData[] = [];

    // Get kiro-oauth accounts
    let accounts: KiroOAuthAccount[];
    
    if (accountId) {
      const account = config.accounts.find(a => a.id === accountId);
      if (!account || account.provider !== 'kiro-oauth') {
        throw new Error(`Account ${accountId} not found or not a Kiro OAuth account`);
      }
      accounts = [account as KiroOAuthAccount];
    } else {
      accounts = config.accounts.filter(
        a => a.provider === 'kiro-oauth'
      ) as KiroOAuthAccount[];
    }

    // Fetch quota for each account
    for (const account of accounts) {
      // Create QuotaTracker instance for this account
      const quotaTracker = new QuotaTracker(account.id);
      const status = quotaTracker.getStatus();

      // If no status available, use defaults
      if (!status) {
        quotaData.push({
          accountId: account.id,
          requestsPerMinute: {
            current: 0,
            limit: 60,
            percentage: 0,
          },
          requestsPerHour: {
            current: 0,
            limit: 3600,
            percentage: 0,
          },
          requestsPerDay: {
            current: 0,
            limit: 86400,
            percentage: 0,
          },
        });
        continue;
      }

      quotaData.push({
        accountId: account.id,
        requestsPerMinute: {
          current: status.perMinute.used,
          limit: status.perMinute.limit,
          percentage: status.perMinute.limit > 0 
            ? (status.perMinute.used / status.perMinute.limit) * 100 
            : 0,
        },
        requestsPerHour: {
          current: status.perHour.used,
          limit: status.perHour.limit,
          percentage: status.perHour.limit > 0 
            ? (status.perHour.used / status.perHour.limit) * 100 
            : 0,
        },
        requestsPerDay: {
          current: status.perDay.used,
          limit: status.perDay.limit,
          percentage: status.perDay.limit > 0 
            ? (status.perDay.used / status.perDay.limit) * 100 
            : 0,
        },
        resetTime: status.perDay.resetAt,
      });
    }

    return quotaData;
  } catch (error) {
    logger.error('Failed to fetch quota data', error);
    throw error;
  }
}

/**
 * Display quota data
 */
function displayQuota(quotaData: QuotaData[]): void {
  if (quotaData.length === 0) {
    console.log(chalk.yellow('\n⚠ No quota data available'));
    console.log(chalk.gray('Make sure you have Kiro OAuth accounts configured'));
    return;
  }

  console.log(chalk.blue.bold('\n📊 Quota Usage\n'));

  for (const data of quotaData) {
    console.log(chalk.bold(`Account: ${data.accountId}`));
    console.log(chalk.gray('─'.repeat(60)));

    // Requests per minute
    const rpmColor = getColor(data.requestsPerMinute.percentage);
    console.log(chalk.bold('\nRequests per Minute:'));
    console.log(
      `${rpmColor(formatNumber(data.requestsPerMinute.current))} / ${formatNumber(
        data.requestsPerMinute.limit
      )} (${rpmColor(data.requestsPerMinute.percentage.toFixed(1) + '%')})`
    );

    // Progress bar for RPM
    const rpmBar = new cliProgress.SingleBar({
      format: `${rpmColor('{bar}')} {percentage}%`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    rpmBar.start(100, data.requestsPerMinute.percentage);
    rpmBar.stop();

    // Requests per hour
    const rphColor = getColor(data.requestsPerHour.percentage);
    console.log(chalk.bold('\nRequests per Hour:'));
    console.log(
      `${rphColor(formatNumber(data.requestsPerHour.current))} / ${formatNumber(
        data.requestsPerHour.limit
      )} (${rphColor(data.requestsPerHour.percentage.toFixed(1) + '%')})`
    );

    // Progress bar for RPH
    const rphBar = new cliProgress.SingleBar({
      format: `${rphColor('{bar}')} {percentage}%`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    rphBar.start(100, data.requestsPerHour.percentage);
    rphBar.stop();

    // Requests per day
    const rpdColor = getColor(data.requestsPerDay.percentage);
    console.log(chalk.bold('\nRequests per Day:'));
    console.log(
      `${rpdColor(formatNumber(data.requestsPerDay.current))} / ${formatNumber(
        data.requestsPerDay.limit
      )} (${rpdColor(data.requestsPerDay.percentage.toFixed(1) + '%')})`
    );

    // Progress bar for RPD
    const rpdBar = new cliProgress.SingleBar({
      format: `${rpdColor('{bar}')} {percentage}%`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    rpdBar.start(100, data.requestsPerDay.percentage);
    rpdBar.stop();

    // Reset time
    if (data.resetTime) {
      console.log(
        chalk.gray(`\nResets in: ${formatTimeUntilReset(data.resetTime)}`)
      );
    }

    console.log();
  }

  // Check if all accounts are near limits
  const accountsNearLimit = quotaData.filter(
    d => d.requestsPerDay.percentage >= 90
  );

  if (accountsNearLimit.length > 0) {
    console.log(chalk.red(`\n⚠ WARNING: ${accountsNearLimit.length} account(s) near quota limit!`));
    console.log(chalk.gray('Consider adding more accounts or waiting for quota reset.'));
  }
}

/**
 * Quota show command
 */
export async function quotaShowCommand(options: QuotaOptions): Promise<void> {
  try {
    logger.info('Starting quota show command', { options });

    // Initialize services
    const configManager = new ConfigurationManager();

    // Fetch quota data
    const quotaData = await fetchQuotaData(
      configManager,
      options.account
    );

    // Display quota
    displayQuota(quotaData);

    logger.info('Quota show command completed successfully');
  } catch (error) {
    logger.error('Quota show command failed', error);

    if (error instanceof Error && error.message.includes('not found')) {
      console.error(chalk.red('\n✗ Account not found'));
      console.log(chalk.gray('Check available accounts: claudeflow account list'));
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
 * Quota watch command
 */
export async function quotaWatchCommand(options: QuotaOptions): Promise<void> {
  try {
    logger.info('Starting quota watch command', { options });

    // Initialize services
    const configManager = new ConfigurationManager();

    console.log(chalk.blue('📊 Watching quota usage (Ctrl+C to stop)\n'));
    console.log(chalk.gray('Refreshing every 5 seconds...\n'));

    // Watch loop
    const watchInterval = setInterval(async () => {
      try {
        // Clear screen
        console.clear();

        console.log(chalk.blue('📊 Watching quota usage (Ctrl+C to stop)\n'));
        console.log(chalk.gray('Refreshing every 5 seconds...\n'));

        // Fetch and display quota
        const quotaData = await fetchQuotaData(
          configManager,
          options.account
        );

        displayQuota(quotaData);

        console.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));
      } catch (error) {
        logger.error('Error in watch loop', error);
        console.error(chalk.red('Error fetching quota data'));
      }
    }, 5000);

    // Initial display
    const quotaData = await fetchQuotaData(
      configManager,
      options.account
    );
    displayQuota(quotaData);
    console.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`));

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(watchInterval);
      console.log(chalk.gray('\n\nStopped watching quota'));
      process.exit(0);
    });
  } catch (error) {
    logger.error('Quota watch command failed', error);

    if (error instanceof Error && error.message.includes('not found')) {
      console.error(chalk.red('\n✗ Account not found'));
      console.log(chalk.gray('Check available accounts: claudeflow account list'));
    } else {
      console.error(
        chalk.red('\n✗ Error:'),
        error instanceof Error ? error.message : String(error)
      );
    }

    process.exit(1);
  }
}
