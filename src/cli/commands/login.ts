/**
 * Login Command
 * 
 * Interactive Kiro account login via OAuth
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigService } from '../services/config-service.js';
import { AuthService } from '../services/auth-service.js';
import { RedisClientWrapper } from '../../infrastructure/redis.js';
import { logger } from '../utils/logger.js';
import type { LoginOptions, Credentials } from '../types/cli.types.js';
import type { OAuthAccount } from '../../config/schema.js';

/**
 * Login command handler
 * 
 * @param options - Login options
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  try {
    logger.info('Starting login command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();
    const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
    await redisClient.connect();

    const authService = new AuthService(configService, redisClient);
    await authService.initialize();

    // Get credentials (interactive or from options)
    const credentials = options.machineId && options.apiKey
      ? {
          machineId: options.machineId,
          apiKey: options.apiKey,
          mitmRouterUrl: config.infrastructure.mitmRouterUrl,
        }
      : await promptCredentials(config.infrastructure.mitmRouterUrl);

    // Validate credentials
    const validation = validateCredentials(credentials);
    if (!validation.valid) {
      console.error(chalk.red('✗ Invalid credentials:'));
      validation.errors.forEach((error) => {
        console.error(chalk.red(`  - ${error}`));
      });
      process.exit(1);
    }

    // Authenticate
    const spinner = ora('Authenticating with Kiro...').start();

    try {
      const session = await authService.authenticate(
        credentials.machineId,
        credentials.apiKey,
        credentials.mitmRouterUrl
      );

      spinner.succeed('Authentication successful!');

      // Generate account ID
      const accountId = `kiro-${credentials.machineId}`;

      // Check if account already exists
      const existingAccount = config.accounts.find(a => a.id === accountId);

      if (existingAccount && existingAccount.provider === 'kiro') {
        // Update existing OAuth account
        existingAccount.kiroConfig.sessionToken = session.sessionToken;
        existingAccount.kiroConfig.sessionExpiry = session.expiresAt;
        existingAccount.lastUsed = Date.now();
        await configService.save(config);

        console.log(chalk.green('\n✓ Account updated successfully!'));
      } else {
        // Add new OAuth account
        const newAccount: OAuthAccount = {
          id: accountId,
          provider: 'kiro',
          apiKey: credentials.apiKey,
          kiroConfig: {
            machineId: credentials.machineId,
            mitmRouterUrl: credentials.mitmRouterUrl || config.infrastructure.mitmRouterUrl,
            sessionToken: session.sessionToken,
            sessionExpiry: session.expiresAt,
          },
          lastUsed: Date.now(),
          requestCount: 0,
        };

        config.accounts.push(newAccount);
        await configService.save(config);

        console.log(chalk.green('\n✓ Account added successfully!'));
      }

      // Display account details
      console.log(chalk.blue('\nAccount Details:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('Account ID:')} ${accountId}`);
      console.log(`${chalk.bold('Machine ID:')} ${credentials.machineId}`);
      console.log(`${chalk.bold('MITM Router:')} ${credentials.mitmRouterUrl || config.infrastructure.mitmRouterUrl}`);
      console.log(`${chalk.bold('Session Expires:')} ${session.expiresAt.toLocaleString()}`);
      console.log(chalk.gray('─'.repeat(50)));

      console.log(chalk.green('\n✓ You can now use ClaudeFlow with this account!'));
      console.log(chalk.gray('\nNext steps:'));
      console.log(chalk.gray('  • Start the daemon: claudeflow daemon start'));
      console.log(chalk.gray('  • Check quota: claudeflow quota show'));
      console.log(chalk.gray('  • View accounts: claudeflow account list'));

      await redisClient.disconnect();
      logger.info('Login command completed successfully');
    } catch (error) {
      spinner.fail('Authentication failed');

      if (error instanceof Error) {
        console.error(chalk.red(`\n✗ Error: ${error.message}`));

        if (error.message.includes('401') || error.message.includes('403')) {
          console.error(chalk.yellow('\nPossible causes:'));
          console.error(chalk.yellow('  • Invalid Machine ID or API key'));
          console.error(chalk.yellow('  • Account not authorized'));
          console.error(chalk.yellow('  • API key expired'));
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
          console.error(chalk.yellow('\nPossible causes:'));
          console.error(chalk.yellow('  • MITM router is unreachable'));
          console.error(chalk.yellow('  • Network connectivity issues'));
          console.error(chalk.yellow('  • Incorrect MITM router URL'));
        }
      }

      await redisClient.disconnect();
      logger.error('Login command failed', error);
      process.exit(1);
    }
  } catch (error) {
    logger.error('Login command error', error);
    console.error(chalk.red('✗ Unexpected error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Prompt for credentials interactively
 * 
 * @param defaultMitmRouterUrl - Default MITM router URL
 * @returns Credentials
 */
async function promptCredentials(defaultMitmRouterUrl: string): Promise<Credentials> {
  console.log(chalk.blue.bold('\n🔐 Kiro Account Login\n'));
  console.log(chalk.gray('Please provide your Kiro account credentials.\n'));

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
      default: defaultMitmRouterUrl,
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

  return {
    machineId: answers.machineId.trim(),
    apiKey: answers.apiKey.trim(),
    mitmRouterUrl: answers.mitmRouterUrl.trim(),
  };
}

/**
 * Validate credentials
 * 
 * @param credentials - Credentials to validate
 * @returns Validation result
 */
function validateCredentials(credentials: Credentials): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate Machine ID
  if (!credentials.machineId || credentials.machineId.trim().length === 0) {
    errors.push('Machine ID is required');
  } else if (credentials.machineId.length < 3) {
    errors.push('Machine ID must be at least 3 characters');
  }

  // Validate API Key
  if (!credentials.apiKey || credentials.apiKey.trim().length === 0) {
    errors.push('API Key is required');
  } else if (credentials.apiKey.length < 10) {
    errors.push('API Key must be at least 10 characters');
  }

  // Validate MITM Router URL
  if (credentials.mitmRouterUrl) {
    try {
      new URL(credentials.mitmRouterUrl);
    } catch {
      errors.push('Invalid MITM Router URL format');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
