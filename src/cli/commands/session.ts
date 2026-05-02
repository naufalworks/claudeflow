/**
 * Session Command
 * 
 * Display session status for all accounts
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';
import { formatRelativeTime } from '../utils/formatter.js';

/**
 * Session status command
 */
export async function sessionStatusCommand(): Promise<void> {
  try {
    logger.info('Starting session status command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    if (config.accounts.length === 0) {
      console.log(chalk.yellow('\n⚠ No accounts configured'));
      console.log(chalk.gray('Add an account with: claudeflow account add'));
      return;
    }

    console.log(chalk.blue.bold('\n🔐 Session Status\n'));

    const table = new Table({
      head: [
        chalk.cyan('Account ID'),
        chalk.cyan('Machine ID'),
        chalk.cyan('Session Status'),
        chalk.cyan('Expires'),
        chalk.cyan('Needs Refresh'),
      ],
      colWidths: [20, 30, 15, 25, 15],
    });

    const now = Date.now();
    const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    for (const account of config.accounts) {
      let sessionStatus: string;
      let expiresText: string;
      let needsRefresh: string;

      if (!account.sessionToken) {
        sessionStatus = chalk.red('No Session');
        expiresText = chalk.gray('N/A');
        needsRefresh = chalk.red('Yes');
      } else if (!account.sessionExpiry) {
        sessionStatus = chalk.yellow('Unknown');
        expiresText = chalk.gray('Unknown');
        needsRefresh = chalk.yellow('Unknown');
      } else {
        const expiresAt = new Date(account.sessionExpiry);
        const timeUntilExpiry = account.sessionExpiry - now;

        if (timeUntilExpiry <= 0) {
          sessionStatus = chalk.red('Expired');
          expiresText = chalk.red('Expired');
          needsRefresh = chalk.red('Yes');
        } else if (timeUntilExpiry <= REFRESH_THRESHOLD_MS) {
          sessionStatus = chalk.yellow('Expiring Soon');
          expiresText = chalk.yellow(formatRelativeTime(expiresAt));
          needsRefresh = chalk.yellow('Yes');
        } else {
          sessionStatus = chalk.green('Active');
          expiresText = chalk.green(formatRelativeTime(expiresAt));
          needsRefresh = chalk.green('No');
        }
      }

      table.push([
        account.id,
        account.machineId,
        sessionStatus,
        expiresText,
        needsRefresh,
      ]);
    }

    console.log(table.toString());

    // Summary
    const expiredCount = config.accounts.filter(
      (a) => a.sessionExpiry && a.sessionExpiry <= now
    ).length;

    const expiringSoonCount = config.accounts.filter(
      (a) =>
        a.sessionExpiry &&
        a.sessionExpiry > now &&
        a.sessionExpiry - now <= REFRESH_THRESHOLD_MS
    ).length;

    const activeCount = config.accounts.filter(
      (a) =>
        a.sessionExpiry &&
        a.sessionExpiry > now &&
        a.sessionExpiry - now > REFRESH_THRESHOLD_MS
    ).length;

    console.log(chalk.gray('\nSummary:'));
    console.log(chalk.green(`  Active: ${activeCount}`));
    console.log(chalk.yellow(`  Expiring Soon: ${expiringSoonCount}`));
    console.log(chalk.red(`  Expired: ${expiredCount}`));
    console.log(chalk.gray(`  Total: ${config.accounts.length}`));

    if (expiredCount > 0 || expiringSoonCount > 0) {
      console.log(chalk.yellow('\n⚠ Some sessions need refresh'));
      console.log(chalk.gray('Refresh sessions with: claudeflow account refresh <accountId>'));
      console.log(chalk.gray('Or refresh all: claudeflow account refresh --all'));
    }

    logger.info('Session status command completed successfully');
  } catch (error) {
    logger.error('Session status command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
