/**
 * Proxy Add Command
 *
 * Add and validate Anthropic-compatible proxy accounts
 * CRITICAL: Only accepts proxies that return native Anthropic format
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigurationManager } from '../../config/manager.js';
import { ProxyClient } from '../../clients/ProxyClient.js';
import { logger } from '../utils/logger.js';
import type { ProxyAccount } from '../../config/schema.js';

/**
 * Proxy add command options
 */
interface ProxyAddOptions {
  baseUrl?: string;
  apiKey?: string;
  skipValidation?: boolean;
}

/**
 * Proxy add command handler
 *
 * Validates that the proxy returns native Anthropic format before adding
 *
 * @param options - Proxy add options
 */
export async function proxyAddCommand(options: ProxyAddOptions = {}): Promise<void> {
  try {
    logger.info('Starting proxy add command', { options });

    console.log(chalk.blue.bold('\n🔌 Add Anthropic-Compatible Proxy\n'));
    console.log(chalk.yellow('⚠️  IMPORTANT: Proxy MUST return native Anthropic format'));
    console.log(chalk.gray('   NOT supported: 9router, OpenRouter, or any proxy that converts to OpenAI format\n'));

    // Get proxy details (interactive or from options)
    const baseUrl = options.baseUrl || await promptBaseUrl();
    const apiKey = options.apiKey || await promptApiKey();

    // Generate account ID
    const accountId = generateProxyAccountId(baseUrl);

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

    // Validate proxy format (unless skipped)
    if (!options.skipValidation) {
      console.log(chalk.blue('\n🔍 Validating proxy format...\n'));

      const spinner = ora('Testing proxy connection...').start();

      try {
        const proxyClient = new ProxyClient();
        const isValid = await proxyClient.testConnection(apiKey, baseUrl);

        if (!isValid) {
          spinner.fail('Proxy validation failed');

          console.log(chalk.red('\n✗ Proxy validation failed\n'));
          console.log(chalk.yellow('Possible causes:'));
          console.log(chalk.yellow('  • Proxy returns OpenAI format (not supported)'));
          console.log(chalk.yellow('  • Invalid API key'));
          console.log(chalk.yellow('  • Network connectivity issues'));
          console.log(chalk.yellow('  • Proxy is down\n'));

          const { shouldContinue } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'shouldContinue',
              message: 'Add proxy anyway? (not recommended)',
              default: false,
            },
          ]);

          if (!shouldContinue) {
            console.log(chalk.gray('Operation cancelled'));
            process.exit(1);
          }
        } else {
          spinner.succeed('Proxy validation passed!');
          console.log(chalk.green('\n✓ Proxy returns native Anthropic format'));
        }
      } catch (error) {
        spinner.fail('Proxy validation failed');

        if (error instanceof Error) {
          console.log(chalk.red(`\n✗ Validation error: ${error.message}\n`));

          // Check if it's an OpenAI format error
          if (error.message.includes('OpenAI format') || error.message.includes('choices')) {
            console.log(chalk.red('❌ REJECTED: This proxy returns OpenAI format\n'));
            console.log(chalk.yellow('ClaudeFlow ONLY supports native Anthropic format.'));
            console.log(chalk.yellow('Converting to OpenAI format loses critical capabilities:\n'));
            console.log(chalk.yellow('  • Extended thinking (thinking.budget_tokens)'));
            console.log(chalk.yellow('  • Prompt caching (cache_control markers)'));
            console.log(chalk.yellow('  • Thinking blocks and cache usage metrics\n'));
            console.log(chalk.blue('SOLUTION:'));
            console.log(chalk.blue('  1. Use direct Anthropic API (recommended)'));
            console.log(chalk.blue('  2. Use a true MITM proxy that forwards Anthropic format unchanged'));
            console.log(chalk.blue('  3. Use Kiro OAuth for free Claude access\n'));
            console.log(chalk.gray('See docs/ANTHROPIC_FORMAT_ONLY.md for details'));

            process.exit(1);
          }
        }

        const { shouldContinue } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldContinue',
            message: 'Add proxy anyway? (not recommended)',
            default: false,
          },
        ]);

        if (!shouldContinue) {
          console.log(chalk.gray('Operation cancelled'));
          process.exit(1);
        }
      }
    } else {
      console.log(chalk.yellow('\n⚠️  Skipping validation (--skip-validation flag)\n'));
    }

    // Create account metadata
    const accountMetadata: ProxyAccount = {
      id: accountId,
      provider: 'proxy',
      apiKey,
      baseURL: baseUrl,
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
    console.log(chalk.green('\n✓ Proxy account added successfully!\n'));
    console.log(chalk.blue('Account Details:'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.bold('Account ID:')} ${accountId}`);
    console.log(`${chalk.bold('Provider:')} proxy`);
    console.log(`${chalk.bold('Base URL:')} ${baseUrl}`);
    console.log(`${chalk.bold('API Key:')} ${sanitizeApiKey(apiKey)}`);
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.green('\n✓ You can now use ClaudeFlow with this proxy!'));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  • Start the daemon: claudeflow daemon start'));
    console.log(chalk.gray('  • Check health: claudeflow health'));
    console.log(chalk.gray('  • View accounts: claudeflow account list'));

    logger.info('Proxy add command completed successfully', { accountId, baseUrl });
  } catch (error) {
    logger.error('Proxy add command error', error);

    if (error instanceof Error) {
      console.error(chalk.red('\n✗ Error:'), error.message);
    } else {
      console.error(chalk.red('\n✗ Unexpected error:'), String(error));
    }

    process.exit(1);
  }
}

/**
 * Prompt for proxy base URL interactively
 *
 * @returns Proxy base URL
 */
async function promptBaseUrl(): Promise<string> {
  const { baseUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Enter proxy base URL (e.g., http://localhost:8080):',
      validate: (input: string) => {
        if (!input) {
          return 'Base URL is required';
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

  return baseUrl;
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
      message: 'Enter API key:',
      mask: '*',
      validate: (input: string) => {
        if (!input) {
          return 'API key is required';
        }
        return true;
      },
    },
  ]);

  return apiKey;
}

/**
 * Generate deterministic account ID from base URL
 *
 * @param baseUrl - Proxy base URL
 * @returns Account ID
 */
function generateProxyAccountId(baseUrl: string): string {
  // Extract hostname from URL
  const url = new URL(baseUrl);
  const hostname = url.hostname.replace(/\./g, '-');
  const port = url.port ? `-${url.port}` : '';

  return `proxy-${hostname}${port}`;
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

  const first = apiKey.slice(0, 4);
  const last = apiKey.slice(-4);
  const masked = '*'.repeat(Math.min(apiKey.length - 8, 20));

  return `${first}${masked}${last}`;
}
