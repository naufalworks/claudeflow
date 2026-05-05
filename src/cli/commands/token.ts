/**
 * Token Export/Import Command
 *
 * Export and import Kiro session tokens for backup or migration
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigurationManager } from '../../config/manager.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import { logger } from '../utils/logger.js';
import { sanitizeToken } from '../utils/security.js';
import type { KiroOAuthAccount } from '../../config/schema.js';

/**
 * Export token command
 *
 * Exports Kiro session token to a file or displays it
 */
export async function tokenExportCommand(accountId: string, options: { output?: string; json?: boolean } = {}): Promise<void> {
  try {
    logger.info('Starting token export command', { accountId });

    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();
    const config = configManager.getConfig();

    // Find account
    const account = config.accounts.find(a => a.id === accountId) as KiroOAuthAccount | undefined;
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    if (account.provider !== 'kiro-oauth') {
      console.error(chalk.red(`✗ Account '${accountId}' is not a Kiro OAuth account`));
      process.exit(1);
    }

    const spinner = ora('Retrieving credentials...').start();

    // Retrieve credentials from keychain
    const credentials = await keychainStore.retrieve(accountId);
    if (!credentials) {
      spinner.fail('Credentials not found');
      console.error(chalk.red(`✗ No credentials found for account '${accountId}'`));
      process.exit(1);
    }

    spinner.succeed('Credentials retrieved');

    // Prepare export data
    const exportData = {
      accountId: account.id,
      provider: account.provider,
      region: account.region,
      profileArn: account.profileArn,
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
      exportedAt: new Date().toISOString(),
    };

    // Output format
    if (options.json) {
      // JSON output
      console.log(JSON.stringify(exportData, null, 2));
    } else if (options.output) {
      // Save to file
      const outputPath = path.resolve(options.output);
      await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
      console.log(chalk.green(`\n✓ Token exported to: ${outputPath}`));
    } else {
      // Display in terminal
      console.log(chalk.blue('\n📤 Exported Token\n'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(`${chalk.bold('Account ID:')} ${exportData.accountId}`);
      console.log(`${chalk.bold('Region:')} ${exportData.region}`);
      console.log(`${chalk.bold('Profile ARN:')} ${exportData.profileArn}`);
      console.log(`${chalk.bold('Access Token:')} ${sanitizeToken(exportData.accessToken)}`);
      console.log(`${chalk.bold('Refresh Token:')} ${exportData.refreshToken ? sanitizeToken(exportData.refreshToken) : 'N/A'}`);
      console.log(`${chalk.bold('Expires At:')} ${exportData.expiresAt}`);
      console.log(chalk.gray('─'.repeat(60)));

      console.log(chalk.yellow('\n⚠️  Security Warning:'));
      console.log(chalk.gray('  • Keep these tokens secure'));
      console.log(chalk.gray('  • Do not share with others'));
      console.log(chalk.gray('  • Tokens grant full access to your Kiro account\n'));

      // Ask if user wants to save to file
      const { shouldSave } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldSave',
          message: 'Save token to file?',
          default: false,
        },
      ]);

      if (shouldSave) {
        const { outputPath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'outputPath',
            message: 'Enter output file path:',
            default: `kiro-token-${accountId}.json`,
          },
        ]);

        const fullPath = path.resolve(outputPath);
        await fs.writeFile(fullPath, JSON.stringify(exportData, null, 2), 'utf-8');
        console.log(chalk.green(`\n✓ Token saved to: ${fullPath}`));
      }
    }

    logger.info('Token export command completed successfully', { accountId });
  } catch (error) {
    logger.error('Token export command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Import token command
 *
 * Imports Kiro session token from a file or stdin
 */
export async function tokenImportCommand(options: { input?: string; json?: string } = {}): Promise<void> {
  try {
    logger.info('Starting token import command', { options });

    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();

    let importData: any;

    // Get import data
    if (options.json) {
      // From JSON string
      importData = JSON.parse(options.json);
    } else if (options.input) {
      // From file
      const inputPath = path.resolve(options.input);
      const fileContent = await fs.readFile(inputPath, 'utf-8');
      importData = JSON.parse(fileContent);
    } else {
      // Interactive mode
      console.log(chalk.blue('\n📥 Import Kiro Token\n'));

      const { inputMethod } = await inquirer.prompt([
        {
          type: 'list',
          name: 'inputMethod',
          message: 'How would you like to import the token?',
          choices: [
            { name: 'From file', value: 'file' },
            { name: 'Paste JSON', value: 'paste' },
            { name: 'Manual entry', value: 'manual' },
          ],
        },
      ]);

      if (inputMethod === 'file') {
        const { filePath } = await inquirer.prompt([
          {
            type: 'input',
            name: 'filePath',
            message: 'Enter file path:',
            validate: async (input: string) => {
              try {
                await fs.access(path.resolve(input));
                return true;
              } catch {
                return 'File not found';
              }
            },
          },
        ]);

        const fileContent = await fs.readFile(path.resolve(filePath), 'utf-8');
        importData = JSON.parse(fileContent);
      } else if (inputMethod === 'paste') {
        const { jsonData } = await inquirer.prompt([
          {
            type: 'editor',
            name: 'jsonData',
            message: 'Paste the exported JSON:',
          },
        ]);

        importData = JSON.parse(jsonData);
      } else {
        // Manual entry
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'region',
            message: 'Enter region:',
            default: 'us-east-1',
          },
          {
            type: 'input',
            name: 'profileArn',
            message: 'Enter profile ARN:',
          },
          {
            type: 'password',
            name: 'accessToken',
            message: 'Enter access token:',
            mask: '*',
          },
          {
            type: 'password',
            name: 'refreshToken',
            message: 'Enter refresh token (optional):',
            mask: '*',
          },
        ]);

        importData = {
          provider: 'kiro-oauth',
          region: answers.region,
          profileArn: answers.profileArn,
          accessToken: answers.accessToken,
          refreshToken: answers.refreshToken || '',
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        };
      }
    }

    // Validate import data
    if (!importData.accessToken || !importData.region || !importData.profileArn) {
      throw new Error('Invalid import data: missing required fields');
    }

    const spinner = ora('Importing token...').start();

    // Generate account ID
    const accountId = importData.accountId || `kiro-${importData.profileArn.split('/').pop()}`;

    // Check for duplicate
    const config = configManager.getConfig();
    const existingAccount = config.accounts.find(a => a.id === accountId);

    if (existingAccount) {
      spinner.info('Account already exists');

      const { shouldUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldUpdate',
          message: `Account '${accountId}' already exists. Update?`,
          default: true,
        },
      ]);

      if (!shouldUpdate) {
        console.log(chalk.gray('Import cancelled'));
        return;
      }
    }

    // Store credentials in keychain
    await keychainStore.store(accountId, {
      accessToken: importData.accessToken,
      refreshToken: importData.refreshToken || '',
      expiresAt: importData.expiresAt,
    });

    // Store account metadata
    const accountMetadata: KiroOAuthAccount = {
      id: accountId,
      provider: 'kiro-oauth',
      region: importData.region,
      profileArn: importData.profileArn,
      expiresAt: importData.expiresAt,
      lastUsed: 0,
      requestCount: 0,
      errorCount: 0,
      priority: 0,
    };

    if (existingAccount) {
      const accountIndex = config.accounts.findIndex(a => a.id === accountId);
      config.accounts[accountIndex] = accountMetadata;
    } else {
      config.accounts.push(accountMetadata);
    }

    configManager.saveConfig(config);

    spinner.succeed('Token imported successfully!');

    console.log(chalk.green('\n✓ Token imported!'));
    console.log(chalk.blue('\nAccount Details:'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.bold('Account ID:')} ${accountId}`);
    console.log(`${chalk.bold('Region:')} ${importData.region}`);
    console.log(`${chalk.bold('Profile ARN:')} ${importData.profileArn}`);
    console.log(`${chalk.bold('Expires At:')} ${importData.expiresAt}`);
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  • Start the daemon: claudeflow daemon start'));
    console.log(chalk.gray('  • Check health: claudeflow health'));
    console.log(chalk.gray('  • View accounts: claudeflow account list'));

    logger.info('Token import command completed successfully', { accountId });
  } catch (error) {
    logger.error('Token import command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
