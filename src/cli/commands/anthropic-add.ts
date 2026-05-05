/**
 * Anthropic Add Command
 *
 * Add direct Anthropic API accounts
 * This is the RECOMMENDED account type for ClaudeFlow
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigurationManager } from '../../config/manager.js';
import { AnthropicClient } from '../../clients/AnthropicClient.js';
import { logger } from '../utils/logger.js';
import type { AnthropicAccount } from '../../config/schema.js';

/**
 * Anthropic add command options
 */
interface AnthropicAddOptions {
  apiKey?: string;
  skipValidation?: boolean;
}

/**
 * Anthropic add command handler
 *
 * Validates API key before adding
 *
 * @param options - Anthropic add options
 */
export async function anthropicAddCommand(options: AnthropicAddOptions = {}): Promise<void> {
  try {
    logger.info('Starting anthropic add command', { options });

    console.log(chalk.blue.bold('\n🚀 Add Direct Anthropic Account\n'));
    console.log(chalk.green('✓ RECOMMENDED: Direct Anthropic API provides:'));
    console.log(chalk.gray('  • 100% feature support (thinking, caching, all content types)'));
    console.log(chalk.gray('  • Highest reliability'));
    console.log(chalk.gray('  • Best performance'));
    console.log(chalk.gray('  • Official support\n'));

    // Get API key (interactive or from options)
    const apiKey = options.apiKey || await promptApiKey();

    // Generate account ID from API key
    const accountId = generateAnthropicAccountId(apiKey);

    // Initialize services
    const configManager = new ConfigurationManager();
    const config = configManager.getConfig();

    // Check for duplicate account
    const existingAccount = config.accounts.find(a => a.id === accountId);
    if (existingAccount) {
      console.log(chalk.yellow(`\n⚠️  Account ${accountId} already exists`));

      const { shouldUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldUpdate',
          message: 'Update existing account?',
          default: true,
        },
      ]);

      if (!shouldUpdate) {
        console.log(chalk.gray('Operation cancelled'));
        return;
      }
    }

    // Validate API key (unless skipped)
    if (!options.skipValidation) {
      console.log(chalk.blue('\n🔍 Validating API key...\n'));

      const spinner = ora('Testing Anthropic API connection...').start();

      try {
        const anthropicClient = new AnthropicClient();
        const isValid = await anthropicClient.testConnection(apiKey);

        if (!isValid) {
          spinner.fail('API key validation failed');

          console.log(chalk.red('\n✗ API key validation failed\n'));
          console.log(chalk.yellow('Possible causes:'));
          console.log(chalk.yellow('  • Invalid API key'));
          console.log(chalk.yellow('  • API key expired or revoked'));
          console.log(chalk.yellow('  • Network connectivity issues'));
          console.log(chalk.yellow('  • Anthropic API is down\n'));

          process.exit(1);
        } else {
          spinner.succeed('API key validated successfully!');
          console.log(chalk.green('\n✓ Connection to Anthropic API successful'));
        }
      } catch (error) {
        spinner.fail('API key validation failed');

        if (error instanceof Error) {
          console.log(chalk.red(`\n✗ Validation error: ${error.message}\n`));
        }

        process.exit(1);
      }
    } else {
      console.log(chalk.yellow('\n⚠️  Skipping validation (--skip-validation flag)\n'));
    }

    // Create account metadata
    const accountMetadata: AnthropicAccount = {
      id: accountId,
      provider: 'anthropic',
      apiKey,
      lastUsed: 0,
      requestCount: 0,
    };

    if (existingAccount) {
      // Update existing account
      const accountIndex = config.accounts.findIndex(a => a.id === accountId);
      config.accounts[accountIndex] = accountMetadata;
    } else {
      // Add new account
      config.accounts.push(accountMetadata);
    }

    // Save config
    configManager.saveConfig(config);

    // Display success message
    console.log(chalk.green('\n✓ Anthropic account added successfully!\n'));
    console.log(chalk.blue('Account Details:'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.bold('Account ID:')} ${accountId}`);
    console.log(`${chalk.bold('Provider:')} anthropic (direct)`);
    console.log(`${chalk.bold('API Key:')} ${sanitizeApiKey(apiKey)}`);
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.green('\n✓ You can now use ClaudeFlow with this account!'));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  • Start the daemon: claudeflow daemon start'));
    console.log(chalk.gray('  • Check health: claudeflow health'));
    console.log(chalk.gray('  • View accounts: claudeflow account list'));

    logger.info('Anthropic add command completed successfully', { accountId });
  } catch (error) {
    logger.error('Anthropic add command error', error);

    if (error instanceof Error) {
      console.error(chalk.red('\n✗ Error:'), error.message);
    } else {
      console.error(chalk.red('\n✗ Unexpected error:'), String(error));
    }

    process.exit(1);
  }
}

/**
 * Prompt for API key interactively
 *
 * @returns API key
 */
async function promptApiKey(): Promise<string> {
  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter Anthropic API key (sk-ant-...):',
      mask: '*',
      validate: (input: string) => {
        if (!input) {
          return 'API key is required';
        }

        if (!input.startsWith('sk-ant-')) {
          return 'Invalid API key format. Anthropic API keys start with "sk-ant-"';
        }

        return true;
      },
    },
  ]);

  return apiKey;
}

/**
 * Generate deterministic account ID from API key
 *
 * @param apiKey - Anthropic API key
 * @returns Account ID
 */
function generateAnthropicAccountId(apiKey: string): string {
  // Use last 8 characters of API key for ID
  const suffix = apiKey.slice(-8);
  return `anthropic-${suffix}`;
}

/**
 * Sanitize API key for display (show first/last 4 chars)
 *
 * @param apiKey - API key to sanitize
 * @returns Sanitized API key
 */
function sanitizeApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '***';
  }

  const first = apiKey.slice(0, 7); // sk-ant-
  const last = apiKey.slice(-4);
  const masked = '*'.repeat(Math.min(apiKey.length - 11, 20));

  return `${first}${masked}${last}`;
}
