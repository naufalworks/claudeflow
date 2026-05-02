/**
 * Account Command
 * 
 * Manage Kiro accounts (add/remove/list/show/refresh)
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { ConfigService } from '../services/config-service.js';
import { AuthService } from '../services/auth-service.js';
import { RedisClientWrapper } from '../../infrastructure/redis.js';
import { logger } from '../utils/logger.js';
import type { KiroAccountConfig } from '../types/cli.types.js';

/**
 * Account add command
 */
export async function accountAddCommand(): Promise<void> {
  try {
    logger.info('Starting account add command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Prompt for account details
    console.log(chalk.blue.bold('\n➕ Add Kiro Account\n'));
    console.log(chalk.gray('Please provide the account details.\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'machineId',
        message: 'Machine ID:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Machine ID is required';
          }
          if (input.length < 3) {
            return 'Machine ID must be at least 3 characters';
          }
          return true;
        },
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'API Key:',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'API Key is required';
          }
          if (input.length < 10) {
            return 'API Key must be at least 10 characters';
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'mitmRouterUrl',
        message: 'MITM Router URL:',
        default: config.infrastructure.mitmRouterUrl,
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'MITM Router URL is required';
          }
          try {
            new URL(input);
            return true;
          } catch {
            return 'Invalid URL format';
          }
        },
      },
    ]);

    // Authenticate to verify credentials
    const spinner = ora('Authenticating account...').start();

    const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
    await redisClient.connect();

    const authService = new AuthService(configService, redisClient);
    await authService.initialize();

    try {
      const session = await authService.authenticate(
        answers.machineId.trim(),
        answers.apiKey.trim(),
        answers.mitmRouterUrl.trim()
      );

      spinner.succeed('Authentication successful!');

      // Generate account ID
      const accountId = `kiro-${answers.machineId.trim()}`;

      // Check if account already exists
      const existingAccount = await configService.getAccount(accountId);

      if (existingAccount) {
        // Update existing account
        await configService.updateAccount(accountId, {
          sessionToken: session.sessionToken,
          sessionExpiry: session.expiresAt.getTime(),
          lastUsed: Date.now(),
        });

        console.log(chalk.green('\n✓ Account updated successfully!'));
      } else {
        // Add new account
        const newAccount: KiroAccountConfig = {
          id: accountId,
          machineId: answers.machineId.trim(),
          apiKey: answers.apiKey.trim(),
          sessionToken: session.sessionToken,
          sessionExpiry: session.expiresAt.getTime(),
          mitmRouterUrl: answers.mitmRouterUrl.trim(),
          lastUsed: Date.now(),
          requestCount: 0,
        };

        await configService.addAccount(newAccount);

        console.log(chalk.green('\n✓ Account added successfully!'));
      }

      // Display account details
      console.log(chalk.blue('\nAccount Details:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('Account ID:')} ${accountId}`);
      console.log(`${chalk.bold('Machine ID:')} ${answers.machineId.trim()}`);
      console.log(`${chalk.bold('MITM Router:')} ${answers.mitmRouterUrl.trim()}`);
      console.log(`${chalk.bold('Session Expires:')} ${session.expiresAt.toLocaleString()}`);
      console.log(chalk.gray('─'.repeat(50)));

      await redisClient.disconnect();
      logger.info('Account add command completed successfully');
    } catch (error) {
      spinner.fail('Authentication failed');
      await redisClient.disconnect();
      throw error;
    }
  } catch (error) {
    logger.error('Account add command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account remove command
 */
export async function accountRemoveCommand(accountId: string): Promise<void> {
  try {
    logger.info('Starting account remove command', { accountId });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Check if account exists
    const account = await configService.getAccount(accountId);
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Confirm removal
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to remove account '${accountId}'?`,
        default: false,
      },
    ]);

    if (!answers.confirm) {
      console.log(chalk.yellow('✗ Account removal cancelled'));
      return;
    }

    // Remove account
    await configService.removeAccount(accountId);

    console.log(chalk.green(`✓ Account '${accountId}' removed successfully`));
    logger.info('Account remove command completed successfully', { accountId });
  } catch (error) {
    logger.error('Account remove command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account list command
 */
export async function accountListCommand(): Promise<void> {
  try {
    logger.info('Starting account list command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    if (config.accounts.length === 0) {
      console.log(chalk.yellow('\nNo accounts configured'));
      console.log(chalk.gray('Add an account with: claudeflow account add'));
      return;
    }

    // Initialize auth service to get session statuses
    const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
    await redisClient.connect();

    const authService = new AuthService(configService, redisClient);
    await authService.initialize();

    // Get session statuses
    const statuses = await authService.getAllSessionStatuses();

    // Create table
    const table = new Table({
      head: [
        chalk.cyan('Account ID'),
        chalk.cyan('Machine ID'),
        chalk.cyan('Status'),
        chalk.cyan('Session Expires'),
        chalk.cyan('Last Used'),
        chalk.cyan('Requests'),
      ],
      colWidths: [25, 20, 15, 25, 20, 12],
    });

    // Add rows
    for (const account of config.accounts) {
      const status = statuses.find((s) => s.accountId === account.id);
      const statusText = status?.isValid
        ? chalk.green('✓ Active')
        : status?.needsRefresh
        ? chalk.yellow('⚠ Expiring')
        : chalk.red('✗ Expired');

      const expiresText = status?.expiresIn || 'Unknown';
      const lastUsedText = account.lastUsed
        ? new Date(account.lastUsed).toLocaleDateString()
        : 'Never';

      table.push([
        account.id,
        account.machineId,
        statusText,
        expiresText,
        lastUsedText,
        account.requestCount?.toString() || '0',
      ]);
    }

    console.log(chalk.blue.bold('\n📋 Kiro Accounts\n'));
    console.log(table.toString());
    console.log(chalk.gray(`\nTotal: ${config.accounts.length} account(s)`));

    await redisClient.disconnect();
    logger.info('Account list command completed successfully');
  } catch (error) {
    logger.error('Account list command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account show command
 */
export async function accountShowCommand(accountId: string): Promise<void> {
  try {
    logger.info('Starting account show command', { accountId });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Find account
    const account = config.accounts.find((a) => a.id === accountId);
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Initialize auth service to get session status
    const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
    await redisClient.connect();

    const authService = new AuthService(configService, redisClient);
    await authService.initialize();

    const status = await authService.getSessionStatus(accountId);

    // Display account details
    console.log(chalk.blue.bold(`\n📄 Account Details: ${accountId}\n`));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.bold('Basic Information:'));
    console.log(`  Account ID:     ${account.id}`);
    console.log(`  Machine ID:     ${account.machineId}`);
    console.log(`  MITM Router:    ${account.mitmRouterUrl}`);

    console.log(chalk.bold('\nSession Information:'));
    const statusText = status.isValid
      ? chalk.green('✓ Active')
      : status.needsRefresh
      ? chalk.yellow('⚠ Expiring Soon')
      : chalk.red('✗ Expired');
    console.log(`  Status:         ${statusText}`);
    console.log(`  Expires:        ${status.expiresAt?.toLocaleString() || 'Unknown'}`);
    console.log(`  Expires In:     ${status.expiresIn || 'Unknown'}`);
    console.log(`  Needs Refresh:  ${status.needsRefresh ? chalk.yellow('Yes') : chalk.green('No')}`);

    console.log(chalk.bold('\nUsage Statistics:'));
    console.log(`  Last Used:      ${account.lastUsed ? new Date(account.lastUsed).toLocaleString() : 'Never'}`);
    console.log(`  Request Count:  ${account.requestCount || 0}`);

    console.log(chalk.gray('─'.repeat(60)));

    if (status.needsRefresh) {
      console.log(chalk.yellow('\n⚠ Session needs refresh. Run: claudeflow account refresh ' + accountId));
    }

    await redisClient.disconnect();
    logger.info('Account show command completed successfully', { accountId });
  } catch (error) {
    logger.error('Account show command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account refresh command
 */
export async function accountRefreshCommand(accountId: string): Promise<void> {
  try {
    logger.info('Starting account refresh command', { accountId });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Check if account exists
    const account = await configService.getAccount(accountId);
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Initialize auth service
    const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
    await redisClient.connect();

    const authService = new AuthService(configService, redisClient);
    await authService.initialize();

    // Refresh session
    const spinner = ora('Refreshing session...').start();

    try {
      const session = await authService.refreshSession(accountId);

      spinner.succeed('Session refreshed successfully!');

      console.log(chalk.green('\n✓ Session refreshed successfully!'));
      console.log(chalk.blue('\nSession Details:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('Account ID:')} ${accountId}`);
      console.log(`${chalk.bold('New Expiry:')} ${session.expiresAt.toLocaleString()}`);
      console.log(chalk.gray('─'.repeat(50)));

      await redisClient.disconnect();
      logger.info('Account refresh command completed successfully', { accountId });
    } catch (error) {
      spinner.fail('Session refresh failed');
      await redisClient.disconnect();
      throw error;
    }
  } catch (error) {
    logger.error('Account refresh command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
