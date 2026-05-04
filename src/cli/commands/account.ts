/**
 * Account Command
 * 
 * Manage accounts (add/remove/list/show/refresh)
 * Supports three account types: Direct Anthropic, Proxy, and OAuth
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { ConfigService } from '../services/config-service.js';
import { AuthService } from '../services/auth-service.js';
import { RedisClientWrapper } from '../../infrastructure/redis.js';
import { logger } from '../utils/logger.js';
import type { Account, AnthropicAccount, ProxyAccount, OAuthAccount } from '../../config/schema.js';

/**
 * Account add command
 * Supports three account types: Direct Anthropic, Proxy, and OAuth
 */
export async function accountAddCommand(): Promise<void> {
  try {
    logger.info('Starting account add command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Prompt for account type
    console.log(chalk.blue.bold('\n➕ Add Account\n'));
    console.log(chalk.gray('Select the account type you want to add.\n'));

    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Account Type:',
        choices: [
          {
            name: 'Direct Anthropic (api.anthropic.com)',
            value: 'anthropic',
          },
          {
            name: 'Proxy (Anthropic-compatible MITM proxy)',
            value: 'proxy',
          },
          {
            name: 'OAuth (OAuth-based router)',
            value: 'kiro',
          },
        ],
      },
    ]);

    let newAccount: Account;
    let accountId: string;

    // Handle Direct Anthropic account
    if (provider === 'anthropic') {
      console.log(chalk.gray('\nDirect Anthropic account - connects to api.anthropic.com\n'));

      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Anthropic API Key:',
          mask: '*',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'API Key is required';
            }
            if (!input.startsWith('sk-ant-')) {
              return 'Invalid Anthropic API key format (must start with sk-ant-)';
            }
            if (input.length < 40) {
              return 'API Key must be at least 40 characters';
            }
            return true;
          },
        },
      ]);

      // Generate account ID
      accountId = `anthropic-${Date.now()}`;

      // Create account object
      newAccount = {
        id: accountId,
        provider: 'anthropic',
        apiKey: answers.apiKey.trim(),
      } as AnthropicAccount;

      await configService.addAccount(newAccount);

      console.log(chalk.green('\n✓ Account added successfully!'));
      console.log(chalk.blue('\nAccount Details:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('Account ID:')} ${accountId}`);
      console.log(`${chalk.bold('Provider:')} Direct Anthropic`);
      console.log(`${chalk.bold('API Key:')} ${answers.apiKey.slice(0, 10)}...${answers.apiKey.slice(-4)}`);
      console.log(chalk.gray('─'.repeat(50)));

      logger.info('Direct Anthropic account added successfully', { accountId });
    }
    // Handle Proxy account
    else if (provider === 'proxy') {
      console.log(chalk.gray('\nProxy account - connects to Anthropic-compatible MITM proxy\n'));
      console.log(chalk.yellow('⚠ WARNING: Proxy must forward raw Anthropic format unchanged (NOT 9router)\n'));

      const answers = await inquirer.prompt([
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
          name: 'baseURL',
          message: 'Proxy Base URL:',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'Base URL is required';
            }
            try {
              const url = new URL(input);
              // Validate it's HTTP or HTTPS
              if (!['http:', 'https:'].includes(url.protocol)) {
                return 'URL must use HTTP or HTTPS protocol';
              }
              return true;
            } catch {
              return 'Invalid URL format';
            }
          },
        },
      ]);

      // Generate account ID
      accountId = `proxy-${Date.now()}`;

      // Create account object
      newAccount = {
        id: accountId,
        provider: 'proxy',
        apiKey: answers.apiKey.trim(),
        baseURL: answers.baseURL.trim(),
      } as ProxyAccount;

      await configService.addAccount(newAccount);

      console.log(chalk.green('\n✓ Account added successfully!'));
      console.log(chalk.blue('\nAccount Details:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('Account ID:')} ${accountId}`);
      console.log(`${chalk.bold('Provider:')} Proxy`);
      console.log(`${chalk.bold('Base URL:')} ${answers.baseURL.trim()}`);
      console.log(`${chalk.bold('API Key:')} ${answers.apiKey.slice(0, 10)}...${answers.apiKey.slice(-4)}`);
      console.log(chalk.gray('─'.repeat(50)));

      logger.info('Proxy account added successfully', { accountId });
    }
    // Handle OAuth account
    else if (provider === 'kiro') {
      console.log(chalk.gray('\nOAuth account - connects to OAuth-based router\n'));

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
          message: 'OAuth Router URL:',
          default: 'http://3.68.219.151:20128',
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return 'OAuth Router URL is required';
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
        accountId = `kiro-${answers.machineId.trim()}`;

        // Check if account already exists
        const existingAccount = await configService.getAccount(accountId);

        if (existingAccount) {
          // Update existing OAuth account
          if (existingAccount.provider === 'kiro') {
            existingAccount.kiroConfig.sessionToken = session.sessionToken;
            existingAccount.kiroConfig.sessionExpiry = session.expiresAt;
            existingAccount.lastUsed = Date.now();
            await configService.updateAccount(accountId, existingAccount);
          }

          console.log(chalk.green('\n✓ Account updated successfully!'));
        } else {
          // Create account object
          newAccount = {
            id: accountId,
            provider: 'kiro',
            apiKey: answers.apiKey.trim(),
            kiroConfig: {
              machineId: answers.machineId.trim(),
              mitmRouterUrl: answers.mitmRouterUrl.trim(),
              sessionToken: session.sessionToken,
              sessionExpiry: session.expiresAt,
            },
          } as OAuthAccount;

          await configService.addAccount(newAccount);

          console.log(chalk.green('\n✓ Account added successfully!'));
        }

        // Display account details
        console.log(chalk.blue('\nAccount Details:'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`${chalk.bold('Account ID:')} ${accountId}`);
        console.log(`${chalk.bold('Provider:')} OAuth`);
        console.log(`${chalk.bold('Machine ID:')} ${answers.machineId.trim()}`);
        console.log(`${chalk.bold('OAuth Router:')} ${answers.mitmRouterUrl.trim()}`);
        console.log(`${chalk.bold('Session Expires:')} ${session.expiresAt.toLocaleString()}`);
        console.log(chalk.gray('─'.repeat(50)));

        await redisClient.disconnect();
        logger.info('OAuth account added successfully', { accountId });
      } catch (error) {
        spinner.fail('Authentication failed');
        await redisClient.disconnect();
        throw error;
      }
    }

    // TODO: Security enhancement - implement encrypted credential storage
    // Current implementation stores credentials in plaintext. Future task should:
    // - Use OS credential managers (Keychain/Credential Manager/Secret Service)
    // - Encrypt API keys and session tokens before storage
    // - Implement secure credential deletion on account removal

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

    // Initialize auth service to get session statuses for OAuth accounts
    const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
    await redisClient.connect();

    const authService = new AuthService(configService, redisClient);
    await authService.initialize();

    // Get session statuses (only for OAuth accounts)
    const statuses = await authService.getAllSessionStatuses();

    // Create table
    const table = new Table({
      head: [
        chalk.cyan('Account ID'),
        chalk.cyan('Provider'),
        chalk.cyan('Status'),
        chalk.cyan('Session Expires'),
        chalk.cyan('Last Used'),
        chalk.cyan('Requests'),
      ],
      colWidths: [25, 15, 15, 25, 20, 12],
    });

    // Add rows
    for (const account of config.accounts) {
      let providerText = '';
      let statusText = '';
      let expiresText = '';

      if (account.provider === 'anthropic') {
        providerText = 'Anthropic';
        statusText = chalk.green('✓ Active');
        expiresText = 'N/A';
      } else if (account.provider === 'proxy') {
        providerText = 'Proxy';
        statusText = chalk.green('✓ Active');
        expiresText = 'N/A';
      } else if (account.provider === 'kiro') {
        providerText = 'OAuth';
        const status = statuses.find((s) => s.accountId === account.id);
        statusText = status?.isValid
          ? chalk.green('✓ Active')
          : status?.needsRefresh
          ? chalk.yellow('⚠ Expiring')
          : chalk.red('✗ Expired');
        expiresText = status?.expiresIn || 'Unknown';
      }

      const lastUsedText = account.lastUsed
        ? new Date(account.lastUsed).toLocaleDateString()
        : 'Never';

      table.push([
        account.id,
        providerText,
        statusText,
        expiresText,
        lastUsedText,
        account.requestCount?.toString() || '0',
      ]);
    }

    console.log(chalk.blue.bold('\n📋 Accounts\n'));
    console.log(table.toString());
    console.log(chalk.gray(`\nTotal: ${config.accounts.length} account(s)`));
    
    // Add note for proxy accounts
    const proxyAccounts = config.accounts.filter(a => a.provider === 'proxy');
    if (proxyAccounts.length > 0) {
      console.log(chalk.yellow('\n⚠ Note: Proxy accounts must return raw Anthropic format (NOT OpenAI format like 9router)'));
    }

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

    // Display account details
    console.log(chalk.blue.bold(`\n📄 Account Details: ${accountId}\n`));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.bold('Basic Information:'));
    console.log(`  Account ID:     ${account.id}`);
    console.log(`  Provider:       ${account.provider === 'anthropic' ? 'Direct Anthropic' : account.provider === 'proxy' ? 'Proxy' : 'OAuth'}`);

    // Display provider-specific information
    if (account.provider === 'anthropic') {
      console.log(`  API Key:        ${account.apiKey.slice(0, 10)}...${account.apiKey.slice(-4)}`);
      
      console.log(chalk.bold('\nUsage Statistics:'));
      console.log(`  Last Used:      ${account.lastUsed ? new Date(account.lastUsed).toLocaleString() : 'Never'}`);
      console.log(`  Request Count:  ${account.requestCount || 0}`);

      console.log(chalk.gray('─'.repeat(60)));
    } else if (account.provider === 'proxy') {
      console.log(`  Base URL:       ${account.baseURL}`);
      console.log(`  API Key:        ${account.apiKey.slice(0, 10)}...${account.apiKey.slice(-4)}`);
      
      console.log(chalk.bold('\nUsage Statistics:'));
      console.log(`  Last Used:      ${account.lastUsed ? new Date(account.lastUsed).toLocaleString() : 'Never'}`);
      console.log(`  Request Count:  ${account.requestCount || 0}`);

      console.log(chalk.gray('─'.repeat(60)));
    } else if (account.provider === 'kiro') {
      console.log(`  Machine ID:     ${account.kiroConfig.machineId}`);
      console.log(`  OAuth Router:   ${account.kiroConfig.mitmRouterUrl}`);

      // Initialize auth service to get session status for OAuth accounts
      const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
      await redisClient.connect();

      const authService = new AuthService(configService, redisClient);
      await authService.initialize();

      const status = await authService.getSessionStatus(accountId);

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
    }

    logger.info('Account show command completed successfully', { accountId });
  } catch (error) {
    logger.error('Account show command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Account refresh command
 * Only works for OAuth accounts
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

    // Check if account is OAuth type
    if (account.provider !== 'kiro') {
      console.error(chalk.red(`✗ Account '${accountId}' is not an OAuth account`));
      console.log(chalk.yellow('\nSession refresh is only available for OAuth accounts.'));
      console.log(chalk.gray(`This account is a ${account.provider === 'anthropic' ? 'Direct Anthropic' : 'Proxy'} account and does not use sessions.`));
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
