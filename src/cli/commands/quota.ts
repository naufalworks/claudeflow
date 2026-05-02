/**
 * Quota Command
 * 
 * Display quota usage with visual progress bars
 */

import chalk from 'chalk';
// @ts-ignore - cli-progress doesn't have type definitions
import cliProgress from 'cli-progress';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';

/**
 * Quota data
 */
interface QuotaData {
  accountId: string;
  requestsPerMinute: {
    current: number;
    limit: number;
    percentage: number;
  };
  tokensPerDay: {
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
 * Fetch quota data from Redis
 */
async function fetchQuotaData(
  redisUrl: string,
  accountId?: string
): Promise<QuotaData[]> {
  try {
    // Import Redis dynamically
    const { default: Redis } = await import('ioredis');

    const redis = new Redis(redisUrl, {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    });

    const quotaData: QuotaData[] = [];

    // Get all account keys or specific account
    let accountKeys: string[];
    
    if (accountId) {
      accountKeys = [`quota:${accountId}:*`];
    } else {
      accountKeys = await redis.keys('quota:*');
    }

    // Extract unique account IDs
    const accountIds = new Set<string>();
    for (const key of accountKeys) {
      const match = key.match(/^quota:([^:]+):/);
      if (match) {
        accountIds.add(match[1]);
      }
    }

    // Fetch quota for each account
    for (const accId of accountIds) {
      // Get requests per minute
      const rpmKey = `quota:${accId}:rpm`;
      const rpmCurrent = parseInt((await redis.get(rpmKey)) || '0', 10);
      const rpmLimit = 50; // Default limit, should come from config

      // Get tokens per day
      const tpdKey = `quota:${accId}:tpd`;
      const tpdCurrent = parseInt((await redis.get(tpdKey)) || '0', 10);
      const tpdLimit = 1000000; // Default limit, should come from config

      // Get reset time
      const ttl = await redis.ttl(tpdKey);
      const resetTime = ttl > 0 ? new Date(Date.now() + ttl * 1000) : undefined;

      quotaData.push({
        accountId: accId,
        requestsPerMinute: {
          current: rpmCurrent,
          limit: rpmLimit,
          percentage: (rpmCurrent / rpmLimit) * 100,
        },
        tokensPerDay: {
          current: tpdCurrent,
          limit: tpdLimit,
          percentage: (tpdCurrent / tpdLimit) * 100,
        },
        resetTime,
      });
    }

    await redis.quit();

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
    console.log(chalk.gray('Make sure the daemon is running and has processed requests'));
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

    // Tokens per day
    const tpdColor = getColor(data.tokensPerDay.percentage);
    console.log(chalk.bold('\nTokens per Day:'));
    console.log(
      `${tpdColor(formatNumber(data.tokensPerDay.current))} / ${formatNumber(
        data.tokensPerDay.limit
      )} (${tpdColor(data.tokensPerDay.percentage.toFixed(1) + '%')})`
    );

    // Progress bar for TPD
    const tpdBar = new cliProgress.SingleBar({
      format: `${tpdColor('{bar}')} {percentage}%`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    tpdBar.start(100, data.tokensPerDay.percentage);
    tpdBar.stop();

    // Reset time
    if (data.resetTime) {
      console.log(
        chalk.gray(`\nResets in: ${formatTimeUntilReset(data.resetTime)}`)
      );
    }

    console.log();
  }
}

/**
 * Quota show command
 */
export async function quotaShowCommand(options: QuotaOptions): Promise<void> {
  try {
    logger.info('Starting quota show command', { options });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Fetch quota data
    const quotaData = await fetchQuotaData(
      config.infrastructure.redisUrl,
      options.account
    );

    // Display quota
    displayQuota(quotaData);

    logger.info('Quota show command completed successfully');
  } catch (error) {
    logger.error('Quota show command failed', error);

    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.error(chalk.red('\n✗ Cannot connect to Redis'));
      console.log(chalk.gray('Make sure Redis is running and accessible'));
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
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

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
          config.infrastructure.redisUrl,
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
      config.infrastructure.redisUrl,
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

    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.error(chalk.red('\n✗ Cannot connect to Redis'));
      console.log(chalk.gray('Make sure Redis is running and accessible'));
    } else {
      console.error(
        chalk.red('\n✗ Error:'),
        error instanceof Error ? error.message : String(error)
      );
    }

    process.exit(1);
  }
}
