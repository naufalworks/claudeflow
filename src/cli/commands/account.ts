/**
 * Account Command
 * 
 * Manage Kiro OAuth accounts (list/remove/refresh/test/set-priority)
 * Supports kiro-oauth accounts with secure keychain storage
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { ConfigurationManager } from '../../config/manager.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import { TokenManager } from '../../auth/TokenManager.js';
import { DualAuthModeHandler } from '../../auth/DualAuthModeHandler.js';
import { KiroAPIClient } from '../../clients/KiroAPIClient.js';
import { logger } from '../utils/logger.js';
import {
  validateAccountId,
  validatePriority,
  sanitizeToken,
  logSecurityEvent,
} from '../utils/security.js';
import type { KiroOAuthAccount } from '../../config/schema.js';
import type { KiroAPIConfig } from '../../types/kiro-oauth.types.js';

/**
 * Account list command
 * 
 * Displays all Kiro OAuth accounts with status, expiry, and usage info
 */
export async function accountListCommand(options: { json?: boolean } = {}): Promise<void> {
  try {
    logger.info('Starting account list command');

    // Initialize services
    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();

    // Load config from file
    const configPath = process.env.CLAUDEFLOW_CONFIG || `${process.env.HOME}/.claudeflow/config.json`;
    await configManager.loadConfig(configPath);

    const config = configManager.getConfig();

    // Filter for kiro-oauth accounts only
    const kiroAccounts = config.accounts.filter(
      a => a.provider === 'kiro-oauth'
    ) as KiroOAuthAccount[];

    if (kiroAccounts.length === 0) {
      console.log(chalk.yellow('\nNo Kiro OAuth accounts configured'));
      console.log(chalk.gray('Add an account with: claudeflow login'));
      return;
    }

    // JSON output mode
    if (options.json) {
      const jsonOutput = await Promise.all(
        kiroAccounts.map(async account => {
          const credentials = await keychainStore.retrieve(account.id);
          const expiresAt = new Date(account.expiresAt);
          const now = new Date();
          const timeUntilExpiry = expiresAt.getTime() - now.getTime();
          const isExpired = timeUntilExpiry <= 0;
          const isExpiring = timeUntilExpiry > 0 && timeUntilExpiry < 5 * 60 * 1000;

          return {
            id: account.id,
            provider: 'kiro-oauth',
            region: account.region,
            profileArn: account.profileArn,
            status: isExpired ? 'expired' : isExpiring ? 'expiring' : 'active',
            expiresAt: account.expiresAt,
            lastUsed: account.lastUsed,
            requestCount: account.requestCount,
            errorCount: account.errorCount,
            priority: account.priority,
            hasCredentials: !!credentials,
          };
        })
      );

      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Create table for human-readable output
    const table = new Table({
      head: [
        chalk.cyan('Account ID'),
        chalk.cyan('Region'),
        chalk.cyan('Status'),
        chalk.cyan('Expires'),
        chalk.cyan('Last Used'),
        chalk.cyan('Requests'),
        chalk.cyan('Priority'),
      ],
      colWidths: [20, 15, 15, 20, 20, 12, 10],
    });

    // Add rows
    for (const account of kiroAccounts) {
      // Check token expiry
      const expiresAt = new Date(account.expiresAt);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      const minutesUntilExpiry = Math.floor(timeUntilExpiry / 60000);

      let statusText: string;
      let expiresText: string;

      if (timeUntilExpiry <= 0) {
        statusText = chalk.red('✗ Expired');
        expiresText = chalk.red('Expired');
      } else if (timeUntilExpiry < 5 * 60 * 1000) {
        statusText = chalk.yellow('⚠ Expiring');
        expiresText = chalk.yellow(`${minutesUntilExpiry}m`);
      } else if (timeUntilExpiry < 60 * 60 * 1000) {
        statusText = chalk.green('✓ Active');
        expiresText = chalk.yellow(`${minutesUntilExpiry}m`);
      } else {
        statusText = chalk.green('✓ Active');
        const hoursUntilExpiry = Math.floor(timeUntilExpiry / 3600000);
        expiresText = chalk.green(`${hoursUntilExpiry}h`);
      }

      // Check for errors
      if (account.errorCount > 0) {
        statusText = chalk.red(`✗ Errors (${account.errorCount})`);
      }

      const lastUsedText = account.lastUsed
        ? new Date(account.lastUsed).toLocaleDateString()
        : 'Never';

      table.push([
        account.id,
        account.region,
        statusText,
        expiresText,
        lastUsedText,
        account.requestCount?.toString() || '0',
        account.priority?.toString() || '0',
      ]);
    }

    console.log(chalk.blue.bold('\n📋 Kiro OAuth Accounts\n'));
    console.log(table.toString());
    console.log(chalk.gray(`\nTotal: ${kiroAccounts.length} account(s)`));

    // Show warnings for expired/expiring accounts
    const expiredAccounts = kiroAccounts.filter(a => {
      const expiresAt = new Date(a.expiresAt);
      return expiresAt.getTime() <= Date.now();
    });

    const expiringAccounts = kiroAccounts.filter(a => {
      const expiresAt = new Date(a.expiresAt);
      const timeUntilExpiry = expiresAt.getTime() - Date.now();
      return timeUntilExpiry > 0 && timeUntilExpiry < 5 * 60 * 1000;
    });

    if (expiredAccounts.length > 0) {
      console.log(chalk.red(`\n⚠ ${expiredAccounts.length} account(s) expired`));
      console.log(chalk.gray('Run: claudeflow account refresh <account-id>'));
    }

    if (expiringAccounts.length > 0) {
      console.log(chalk.yellow(`\n⚠ ${expiringAccounts.length} account(s) expiring soon`));
      console.log(chalk.gray('Tokens will auto-refresh if daemon is running'));
    }

    logger.info('Account list command completed successfully');
  } catch (error) {
    logger.error('Account list command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account remove command
 * 
 * Removes account from config AND deletes credentials from keychain
 */
export async function accountRemoveCommand(accountId: string): Promise<void> {
  try {
    logger.info('Starting account remove command', { accountId });

    // Validate account ID format
    validateAccountId(accountId);

    // Initialize services
    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();

    const config = configManager.getConfig();

    // Check if account exists
    const account = config.accounts.find(a => a.id === accountId);
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Check if it's a kiro-oauth account
    if (account.provider !== 'kiro-oauth') {
      console.error(chalk.red(`✗ Account '${accountId}' is not a Kiro OAuth account`));
      console.log(chalk.gray(`This account has provider: ${account.provider}`));
      process.exit(1);
    }

    // Confirm removal
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to remove account '${accountId}'?`,
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow('✗ Account removal cancelled'));
      return;
    }

    const spinner = ora('Removing account...').start();

    try {
      // Delete credentials from keychain
      await keychainStore.delete(accountId);

      // Remove from config
      config.accounts = config.accounts.filter(a => a.id !== accountId);
      configManager.saveConfig(config);

      spinner.succeed('Account removed successfully');

      console.log(chalk.green(`\n✓ Account '${accountId}' removed`));
      console.log(chalk.gray('  • Credentials deleted from keychain'));
      console.log(chalk.gray('  • Account removed from config'));

      // Log security event
      logSecurityEvent('account-remove', accountId, 'success');

      logger.info('Account remove command completed successfully', { accountId });
    } catch (error) {
      spinner.fail('Failed to remove account');
      throw error;
    }
  } catch (error) {
    logger.error('Account remove command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));

    // Log security event
    logSecurityEvent('account-remove', accountId, 'failure', {
      error: error instanceof Error ? error.message : String(error),
    });

    process.exit(1);
  }
}

/**
 * Account refresh command
 * 
 * Manually refresh token for a Kiro OAuth account
 */
export async function accountRefreshCommand(accountId: string): Promise<void> {
  try {
    logger.info('Starting account refresh command', { accountId });

    // Validate account ID format
    validateAccountId(accountId);

    // Initialize services
    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();
    const dualAuthModeHandler = new DualAuthModeHandler();
    const tokenManager = new TokenManager(keychainStore, dualAuthModeHandler, configManager);

    const config = configManager.getConfig();

    // Check if account exists
    const account = config.accounts.find(a => a.id === accountId) as KiroOAuthAccount | undefined;
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Check if it's a kiro-oauth account
    if (account.provider !== 'kiro-oauth') {
      console.error(chalk.red(`✗ Account '${accountId}' is not a Kiro OAuth account`));
      console.log(chalk.gray(`This account has provider: ${account.provider}`));
      console.log(chalk.gray('Token refresh is only available for Kiro OAuth accounts.'));
      process.exit(1);
    }

    // Refresh token
    const spinner = ora('Refreshing token...').start();

    try {
      const result = await tokenManager.refresh(accountId);

      spinner.succeed('Token refreshed successfully!');

      // Update config with new expiry time
      account.expiresAt = result.expiresAt.toISOString();
      account.lastUsed = Date.now();
      configManager.saveConfig(config);

      console.log(chalk.green('\n✓ Token refreshed successfully!'));
      console.log(chalk.blue('\nToken Details:'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(`${chalk.bold('Account ID:')} ${accountId}`);
      console.log(`${chalk.bold('New Expiry:')} ${result.expiresAt.toLocaleString()}`);
      console.log(`${chalk.bold('Access Token:')} ${sanitizeToken(result.accessToken)}`);
      console.log(chalk.gray('─'.repeat(60)));

      // Log security event
      logSecurityEvent('token-refresh', accountId, 'success');

      logger.info('Account refresh command completed successfully', { accountId });
    } catch (error) {
      spinner.fail('Token refresh failed');

      if (error instanceof Error && error.message.includes('401')) {
        console.error(chalk.red('\n✗ Authentication failed'));
        console.log(chalk.yellow('\nYour refresh token has expired or is invalid.'));
        console.log(chalk.gray('Please login again: claudeflow login'));
      }

      // Log security event
      logSecurityEvent('token-refresh', accountId, 'failure', {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  } catch (error) {
    logger.error('Account refresh command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account test command
 * 
 * Test account connectivity with a minimal API call
 */
export async function accountTestCommand(accountId: string): Promise<void> {
  try {
    logger.info('Starting account test command', { accountId });

    // Validate account ID format
    validateAccountId(accountId);

    // Initialize services
    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();
    const kiroAPIClient = new KiroAPIClient();

    const config = configManager.getConfig();

    // Check if account exists
    const account = config.accounts.find(a => a.id === accountId) as KiroOAuthAccount | undefined;
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Check if it's a kiro-oauth account
    if (account.provider !== 'kiro-oauth') {
      console.error(chalk.red(`✗ Account '${accountId}' is not a Kiro OAuth account`));
      console.log(chalk.gray(`This account has provider: ${account.provider}`));
      process.exit(1);
    }

    // Retrieve credentials
    const credentials = await keychainStore.retrieve(accountId);
    if (!credentials) {
      console.error(chalk.red(`✗ No credentials found for account '${accountId}'`));
      console.log(chalk.gray('Please login again: claudeflow login'));
      process.exit(1);
    }

    // Build API config
    const apiConfig: KiroAPIConfig = {
      region: account.region,
      timeout: {
        connect: 10000,
        read: 60000,
      },
      retries: 3,
    };

    // Test connectivity
    const spinner = ora('Testing account connectivity...').start();

    try {
      const startTime = Date.now();
      const isHealthy = await kiroAPIClient.healthCheck(credentials.accessToken, apiConfig);
      const responseTime = Date.now() - startTime;

      if (isHealthy) {
        spinner.succeed('Account is healthy!');

        console.log(chalk.green('\n✓ Account connectivity test passed'));
        console.log(chalk.blue('\nTest Results:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`${chalk.bold('Account ID:')} ${accountId}`);
        console.log(`${chalk.bold('Region:')} ${account.region}`);
        console.log(`${chalk.bold('Response Time:')} ${responseTime}ms`);
        console.log(`${chalk.bold('Status:')} ${chalk.green('Healthy')}`);
        console.log(chalk.gray('─'.repeat(60)));
      } else {
        spinner.fail('Account is unhealthy');

        console.log(chalk.red('\n✗ Account connectivity test failed'));
        console.log(chalk.yellow('\nPossible causes:'));
        console.log(chalk.yellow('  • Token expired or invalid'));
        console.log(chalk.yellow('  • Network connectivity issues'));
        console.log(chalk.yellow('  • Kiro API is down'));
        
        process.exit(1);
      }

      logger.info('Account test command completed successfully', { accountId, responseTime });
    } catch (error) {
      spinner.fail('Connectivity test failed');
      throw error;
    }
  } catch (error) {
    logger.error('Account test command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account set-priority command
 * 
 * Update routing priority for an account
 */
export async function accountSetPriorityCommand(accountId: string, priority: number): Promise<void> {
  try {
    logger.info('Starting account set-priority command', { accountId, priority });

    // Validate account ID format
    validateAccountId(accountId);

    // Validate priority value
    validatePriority(priority);

    // Initialize services
    const configManager = new ConfigurationManager();
    const config = configManager.getConfig();

    // Check if account exists
    const account = config.accounts.find(a => a.id === accountId) as KiroOAuthAccount | undefined;
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Check if it's a kiro-oauth account
    if (account.provider !== 'kiro-oauth') {
      console.error(chalk.red(`✗ Account '${accountId}' is not a Kiro OAuth account`));
      console.log(chalk.gray(`This account has provider: ${account.provider}`));
      process.exit(1);
    }

    // Update priority
    const oldPriority = account.priority || 0;
    account.priority = priority;
    configManager.saveConfig(config);

    console.log(chalk.green(`\n✓ Priority updated for account '${accountId}'`));
    console.log(chalk.gray(`  Old priority: ${oldPriority}`));
    console.log(chalk.gray(`  New priority: ${priority}`));
    console.log(chalk.gray('\nHigher priority accounts are preferred for routing.'));

    logger.info('Account set-priority command completed successfully', { accountId, oldPriority, priority });
  } catch (error) {
    logger.error('Account set-priority command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
