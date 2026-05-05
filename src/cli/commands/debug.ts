/**
 * Debug Command
 * 
 * Debugging utilities for Kiro OAuth integration
 */

import chalk from 'chalk';
import ora from 'ora';
import { ConfigurationManager } from '../../config/manager.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import { KiroAPIClient } from '../../clients/KiroAPIClient.js';
import { ResponseFormatValidator } from '../../clients/ResponseFormatValidator.js';
import { logger } from '../utils/logger.js';
import { validateAccountId } from '../utils/security.js';
import type { KiroOAuthAccount } from '../../config/schema.js';
import type { KiroAPIConfig } from '../../types/kiro-oauth.types.js';
import type { AnthropicRequest } from '../../types/anthropic.types.js';

/**
 * Debug validate-response command
 * 
 * Makes a test API call and validates the response format
 * Useful for debugging response format issues
 */
export async function debugValidateResponseCommand(accountId?: string): Promise<void> {
  try {
    logger.info('Starting debug validate-response command', { accountId });

    // Initialize services
    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();
    const kiroAPIClient = new KiroAPIClient();
    const validator = new ResponseFormatValidator();

    const config = configManager.getConfig();

    // Get account to test
    let account: KiroOAuthAccount;

    if (accountId) {
      // Validate account ID format
      validateAccountId(accountId);

      // Find specific account
      const foundAccount = config.accounts.find(a => a.id === accountId);
      if (!foundAccount) {
        console.error(chalk.red(`✗ Account '${accountId}' not found`));
        process.exit(1);
      }

      if (foundAccount.provider !== 'kiro-oauth') {
        console.error(chalk.red(`✗ Account '${accountId}' is not a Kiro OAuth account`));
        process.exit(1);
      }

      account = foundAccount as KiroOAuthAccount;
    } else {
      // Use first available kiro-oauth account
      const kiroAccounts = config.accounts.filter(
        a => a.provider === 'kiro-oauth'
      ) as KiroOAuthAccount[];

      if (kiroAccounts.length === 0) {
        console.error(chalk.red('✗ No Kiro OAuth accounts configured'));
        console.log(chalk.gray('Add an account with: claudeflow login'));
        process.exit(1);
      }

      account = kiroAccounts[0];
      console.log(chalk.gray(`Using account: ${account.id}\n`));
    }

    // Retrieve credentials
    const credentials = await keychainStore.retrieve(account.id);
    if (!credentials) {
      console.error(chalk.red(`✗ No credentials found for account '${account.id}'`));
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

    // Create minimal test request
    const testRequest: AnthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Say "test" and nothing else.',
        },
      ],
    };

    console.log(chalk.blue.bold('🔍 Debug: Response Format Validation\n'));
    console.log(chalk.gray('Making test API call...\n'));

    // Make API call
    const spinner = ora('Sending test request...').start();

    try {
      const startTime = Date.now();
      const response = await kiroAPIClient.sendRequest(
        testRequest,
        credentials.accessToken,
        apiConfig
      );
      const responseTime = Date.now() - startTime;

      spinner.succeed('Test request completed');

      // Validate response format
      console.log(chalk.blue('\n📋 Response Format Validation:\n'));

      const validationResult = validator.validateDetailed(response);

      if (validationResult.valid) {
        console.log(chalk.green('✓ Response format is valid Anthropic format\n'));

        console.log(chalk.bold('Response Structure:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`${chalk.bold('ID:')} ${response.id}`);
        console.log(`${chalk.bold('Type:')} ${response.type}`);
        console.log(`${chalk.bold('Role:')} ${response.role}`);
        console.log(`${chalk.bold('Model:')} ${response.model}`);
        console.log(`${chalk.bold('Stop Reason:')} ${response.stop_reason || 'N/A'}`);
        console.log(chalk.gray('─'.repeat(60)));

        console.log(chalk.bold('\nContent Blocks:'));
        console.log(chalk.gray('─'.repeat(60)));
        response.content.forEach((block, index) => {
          console.log(`${chalk.bold(`Block ${index + 1}:`)} ${block.type}`);
          if (block.type === 'text') {
            const preview = block.text.substring(0, 50);
            console.log(`  Text: ${preview}${block.text.length > 50 ? '...' : ''}`);
          }
        });
        console.log(chalk.gray('─'.repeat(60)));

        console.log(chalk.bold('\nUsage Statistics:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`${chalk.bold('Input Tokens:')} ${response.usage.input_tokens}`);
        console.log(`${chalk.bold('Output Tokens:')} ${response.usage.output_tokens}`);
        
        if (response.usage.cache_creation_input_tokens !== undefined) {
          console.log(`${chalk.bold('Cache Creation Tokens:')} ${response.usage.cache_creation_input_tokens}`);
        }
        
        if (response.usage.cache_read_input_tokens !== undefined) {
          console.log(`${chalk.bold('Cache Read Tokens:')} ${response.usage.cache_read_input_tokens}`);
        }
        console.log(chalk.gray('─'.repeat(60)));

        console.log(chalk.bold('\nPerformance:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`${chalk.bold('Response Time:')} ${responseTime}ms`);
        console.log(chalk.gray('─'.repeat(60)));

        console.log(chalk.green('\n✓ All validation checks passed!'));
        console.log(chalk.gray('The API is returning proper Anthropic format responses.'));
      } else {
        console.log(chalk.red('✗ Response format validation FAILED\n'));

        console.log(chalk.bold('Validation Errors:'));
        console.log(chalk.gray('─'.repeat(60)));
        validationResult.errors.forEach((error, index) => {
          console.log(chalk.red(`${index + 1}. ${error}`));
        });
        console.log(chalk.gray('─'.repeat(60)));

        console.log(chalk.bold('\nResponse Sample:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(JSON.stringify(response, null, 2));
        console.log(chalk.gray('─'.repeat(60)));

        console.log(chalk.yellow('\n⚠ Warning: Response is not in valid Anthropic format'));
        console.log(chalk.gray('This could indicate:'));
        console.log(chalk.gray('  • API endpoint is returning OpenAI format (like 9router)'));
        console.log(chalk.gray('  • Proxy is converting response format'));
        console.log(chalk.gray('  • API endpoint configuration is incorrect'));

        process.exit(1);
      }

      logger.info('Debug validate-response command completed successfully', {
        accountId: account.id,
        valid: validationResult.valid,
        responseTime,
      });
    } catch (error) {
      spinner.fail('Test request failed');

      if (error instanceof Error) {
        console.error(chalk.red(`\n✗ API Error: ${error.message}`));

        if (error.message.includes('401') || error.message.includes('403')) {
          console.log(chalk.yellow('\nAuthentication failed:'));
          console.log(chalk.gray('  • Token may be expired'));
          console.log(chalk.gray('  • Try refreshing: claudeflow account refresh ' + account.id));
        } else if (error.message.includes('timeout')) {
          console.log(chalk.yellow('\nRequest timeout:'));
          console.log(chalk.gray('  • Network connectivity issues'));
          console.log(chalk.gray('  • API endpoint may be slow or unreachable'));
        }
      }

      throw error;
    }
  } catch (error) {
    logger.error('Debug validate-response command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
