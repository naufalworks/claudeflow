/**
 * Login Command
 * 
 * Interactive Kiro OAuth login via web browser
 * Supports AWS Builder ID, Google, and GitHub authentication
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { OAuthClient } from '../../auth/OAuthClient.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import { ConfigurationManager } from '../../config/manager.js';
import { logger } from '../utils/logger.js';
import {
  sanitizeToken,
  validateProvider,
  validateRegion,
  generateAccountId,
  logSecurityEvent,
  type OAuthProvider,
  type ValidRegion,
} from '../utils/security.js';
import type { OAuthClientConfig } from '../../types/kiro-oauth.types.js';
import type { KiroOAuthAccount } from '../../config/schema.js';

/**
 * Login command options
 */
interface LoginOptions {
  provider?: string;
  region?: string;
  token?: string;
}

/**
 * Login command handler
 * 
 * Implements OAuth 2.0 + PKCE flow for Kiro authentication
 * 
 * @param options - Login options
 */
export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  try {
    logger.info('Starting Kiro OAuth login command', { options });

    // Initialize services
    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();
    const oauthClient = new OAuthClient();

    // Get provider and region (interactive or from options)
    const provider = options.provider 
      ? await validateProviderOption(options.provider)
      : await promptProvider();

    const region = options.region
      ? await validateRegionOption(options.region)
      : await promptRegion();

    // Build OAuth config
    const oauthConfig: OAuthClientConfig = {
      provider,
      region,
    };

    console.log(chalk.blue.bold('\n🔐 Kiro OAuth Login\n'));
    console.log(chalk.gray(`Provider: ${provider}`));
    console.log(chalk.gray(`Region: ${region}\n`));

    let tokens;
    let profileArn: string;

    // Check if using non-interactive mode (--token flag)
    if (options.token) {
      // Non-interactive mode for CI/CD
      console.log(chalk.gray('Using non-interactive mode (--token provided)\n'));

      const spinner = ora('Refreshing authentication token...').start();

      try {
        tokens = await oauthClient.loginWithToken(options.token, oauthConfig);
        spinner.succeed('Token refreshed successfully!');

        // Extract profileArn from token (JWT decode)
        profileArn = await extractProfileArnFromToken(tokens.accessToken);
      } catch (error) {
        spinner.fail('Token refresh failed');
        throw error;
      }
    } else {
      // Interactive mode - open browser
      try {
        tokens = await oauthClient.login(oauthConfig);

        // Extract profileArn from token (JWT decode)
        profileArn = await extractProfileArnFromToken(tokens.accessToken);
      } catch (error) {
        if (error instanceof Error) {
          console.error(chalk.red(`\n✗ Authentication failed: ${error.message}`));

          if (error.message.includes('timeout')) {
            console.error(chalk.yellow('\nTroubleshooting:'));
            console.error(chalk.yellow('  • Make sure you complete authentication in the browser'));
            console.error(chalk.yellow('  • Check that the callback server is accessible'));
            console.error(chalk.yellow('  • Try running the command again'));
          } else if (error.message.includes('state mismatch')) {
            console.error(chalk.yellow('\nSecurity Error:'));
            console.error(chalk.yellow('  • Possible CSRF attack detected'));
            console.error(chalk.yellow('  • Try running the command again'));
          }
        }

        logger.error('OAuth login failed', error);
        process.exit(1);
      }
    }

    // Generate deterministic account ID from profileArn
    const accountId = generateAccountId(profileArn);

    // Check for duplicate account
    const config = configManager.getConfig();
    const existingAccount = config.accounts.find(a => a.id === accountId);

    if (existingAccount) {
      console.log(chalk.yellow(`\n⚠ Account ${accountId} already exists`));
      
      const { shouldUpdate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldUpdate',
          message: 'Update existing account credentials?',
          default: true,
        },
      ]);

      if (!shouldUpdate) {
        console.log(chalk.gray('Login cancelled'));
        return;
      }
    }

    // Store credentials in KeychainStore (secure storage)
    const spinner = ora('Storing credentials securely...').start();

    try {
      await keychainStore.store(accountId, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt.toISOString(),
      });

      spinner.succeed('Credentials stored in OS keychain');
    } catch (error) {
      spinner.fail('Failed to store credentials');
      throw error;
    }

    // Store account metadata in config (NO sensitive data)
    const accountMetadata: KiroOAuthAccount = {
      id: accountId,
      provider: 'kiro-oauth',
      region,
      profileArn,
      expiresAt: tokens.expiresAt.toISOString(),
      lastUsed: Date.now(),
      requestCount: 0,
      errorCount: 0,
      priority: 0,
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

    // Log security event
    logSecurityEvent('login', accountId, 'success', {
      provider,
      region,
      profileArn,
    });

    // Display success message
    console.log(chalk.green('\n✓ Account added successfully!\n'));
    console.log(chalk.blue('Account Details:'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.bold('Account ID:')} ${accountId}`);
    console.log(`${chalk.bold('Provider:')} ${provider}`);
    console.log(`${chalk.bold('Region:')} ${region}`);
    console.log(`${chalk.bold('Profile ARN:')} ${profileArn}`);
    console.log(`${chalk.bold('Token Expires:')} ${tokens.expiresAt.toLocaleString()}`);
    console.log(`${chalk.bold('Access Token:')} ${sanitizeToken(tokens.accessToken)}`);
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.green('\n✓ You can now use ClaudeFlow with this account!'));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  • Start the daemon: claudeflow daemon start'));
    console.log(chalk.gray('  • Check health: claudeflow health'));
    console.log(chalk.gray('  • View accounts: claudeflow account list'));

    logger.info('Login command completed successfully', { accountId });
  } catch (error) {
    logger.error('Login command error', error);
    
    if (error instanceof Error) {
      console.error(chalk.red('\n✗ Error:'), error.message);
    } else {
      console.error(chalk.red('\n✗ Unexpected error:'), String(error));
    }

    // Log security event
    logSecurityEvent('login', null, 'failure', {
      error: error instanceof Error ? error.message : String(error),
    });

    process.exit(1);
  }
}

/**
 * Prompt for OAuth provider interactively
 * 
 * @returns Selected OAuth provider
 */
async function promptProvider(): Promise<OAuthProvider> {
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Select OAuth provider:',
      choices: [
        {
          name: 'AWS Builder ID (recommended)',
          value: 'aws',
        },
        {
          name: 'Google',
          value: 'google',
        },
        {
          name: 'GitHub',
          value: 'github',
        },
      ],
      default: 'aws',
    },
  ]);

  return provider as OAuthProvider;
}

/**
 * Prompt for AWS region interactively
 * 
 * @returns Selected AWS region
 */
async function promptRegion(): Promise<ValidRegion> {
  const { region } = await inquirer.prompt([
    {
      type: 'list',
      name: 'region',
      message: 'Select AWS region:',
      choices: [
        {
          name: 'US East (N. Virginia) - us-east-1',
          value: 'us-east-1',
        },
        {
          name: 'US West (Oregon) - us-west-2',
          value: 'us-west-2',
        },
        {
          name: 'EU (Frankfurt) - eu-central-1',
          value: 'eu-central-1',
        },
        {
          name: 'Asia Pacific (Singapore) - ap-southeast-1',
          value: 'ap-southeast-1',
        },
      ],
      default: 'us-east-1',
    },
  ]);

  return region as ValidRegion;
}

/**
 * Validate provider option from CLI flag
 * 
 * @param provider - Provider string from CLI
 * @returns Validated OAuth provider
 * @throws Error if provider is invalid
 */
async function validateProviderOption(provider: string): Promise<OAuthProvider> {
  try {
    validateProvider(provider);
    return provider as OAuthProvider;
  } catch (error) {
    throw new Error(
      `Invalid provider: ${provider}. Must be one of: aws, google, github`
    );
  }
}

/**
 * Validate region option from CLI flag
 * 
 * @param region - Region string from CLI
 * @returns Validated AWS region
 * @throws Error if region is invalid
 */
async function validateRegionOption(region: string): Promise<ValidRegion> {
  try {
    validateRegion(region);
    return region as ValidRegion;
  } catch (error) {
    throw new Error(
      `Invalid region: ${region}. Must be one of: us-east-1, us-west-2, eu-central-1, ap-southeast-1`
    );
  }
}

/**
 * Extract profileArn from JWT access token
 * 
 * Decodes the JWT token and extracts the profile ARN from claims.
 * 
 * @param accessToken - JWT access token
 * @returns Profile ARN
 * @throws Error if token is invalid or profileArn not found
 */
async function extractProfileArnFromToken(accessToken: string): Promise<string> {
  try {
    // JWT tokens have 3 parts: header.payload.signature
    const parts = accessToken.split('.');
    
    if (parts.length !== 3) {
      throw new Error('Invalid JWT token format');
    }

    // Decode payload (base64url)
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(decoded);

    // Extract profileArn from claims
    // The exact claim name may vary - check common locations
    const profileArn = 
      claims.profile_arn || 
      claims.profileArn || 
      claims.sub || 
      claims['custom:profile_arn'];

    if (!profileArn) {
      throw new Error('Profile ARN not found in token claims');
    }

    // Validate ARN format
    const arnPattern = /^arn:aws:codewhisperer:[a-z0-9-]+:\d+:profile\/[a-zA-Z0-9-]+$/;
    if (!arnPattern.test(profileArn)) {
      throw new Error(`Invalid profile ARN format: ${profileArn}`);
    }

    return profileArn;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to extract profile ARN from token: ${error.message}`);
    }
    throw error;
  }
}
