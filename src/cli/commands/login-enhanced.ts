/**
 * Enhanced Login Command
 *
 * Supports multiple Kiro authentication methods like 9router:
 * 1. Builder ID login (OAuth flow)
 * 2. SSO login (Enterprise)
 * 3. Token import (from existing Kiro session)
 * 4. Manual token entry
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { DeviceCodeClient } from '../../auth/DeviceCodeClient.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import { ConfigurationManager } from '../../config/manager.js';
import { logger } from '../utils/logger.js';
import {
  sanitizeToken,
  validateRegion,
  generateAccountId,
  logSecurityEvent,
  type ValidRegion,
} from '../utils/security.js';
import type { KiroOAuthAccount } from '../../config/schema.js';

/**
 * Login method types
 */
type LoginMethod = 'builder-id' | 'sso' | 'token-import' | 'manual-token';

/**
 * Login command options
 */
interface LoginOptions {
  method?: string;
  region?: string;
  token?: string;
  ssoUrl?: string;
  startUrl?: string;
}

/**
 * Enhanced login command handler
 *
 * Supports multiple authentication methods:
 * - Builder ID: OAuth 2.0 + PKCE flow
 * - SSO: Enterprise single sign-on
 * - Token Import: Import existing Kiro session token
 * - Manual Token: Manually enter access token
 *
 * @param options - Login options
 */
export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  try {
    logger.info('Starting Kiro login command', { options });

    console.log(chalk.blue.bold('\n🔐 Kiro Authentication\n'));
    console.log(chalk.gray('ClaudeFlow supports multiple login methods:\n'));

    // Get login method (interactive or from options)
    const method = options.method
      ? await validateMethodOption(options.method)
      : await promptLoginMethod();

    // Route to appropriate login handler
    switch (method) {
      case 'builder-id':
        await loginWithBuilderID(options);
        break;
      case 'sso':
        await loginWithSSO(options);
        break;
      case 'token-import':
        await loginWithTokenImport(options);
        break;
      case 'manual-token':
        await loginWithManualToken(options);
        break;
      default:
        throw new Error(`Unknown login method: ${method}`);
    }

    logger.info('Login command completed successfully');
  } catch (error) {
    logger.error('Login command error', error);

    if (error instanceof Error) {
      console.error(chalk.red('\n✗ Error:'), error.message);
    } else {
      console.error(chalk.red('\n✗ Unexpected error:'), String(error));
    }

    logSecurityEvent('login', null, 'failure', {
      error: error instanceof Error ? error.message : String(error),
    });

    process.exit(1);
  }
}

/**
 * Prompt for login method
 */
async function promptLoginMethod(): Promise<LoginMethod> {
  const { method } = await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'Select authentication method:',
      choices: [
        {
          name: '🏗️  AWS Builder ID (OAuth) - Recommended',
          value: 'builder-id',
          short: 'Builder ID',
        },
        {
          name: '🏢 SSO (Enterprise Single Sign-On)',
          value: 'sso',
          short: 'SSO',
        },
        {
          name: '📥 Import Token (from existing Kiro session)',
          value: 'token-import',
          short: 'Token Import',
        },
        {
          name: '✏️  Manual Token Entry',
          value: 'manual-token',
          short: 'Manual Token',
        },
      ],
      default: 'builder-id',
    },
  ]);

  return method as LoginMethod;
}

/**
 * Login with AWS Builder ID (Device Code Flow)
 */
async function loginWithBuilderID(options: LoginOptions): Promise<void> {
  console.log(chalk.blue('\n🏗️  AWS Builder ID Login\n'));

  const configManager = new ConfigurationManager();
  const keychainStore = new KeychainStore();
  const deviceCodeClient = new DeviceCodeClient();

  // Get region
  const region = options.region
    ? await validateRegionOption(options.region)
    : await promptRegion();

  // Get start URL (default to AWS Builder ID)
  const startUrl = options.startUrl || 'https://view.awsapps.com/start';

  console.log(chalk.gray(`Region: ${region}`));
  console.log(chalk.gray(`Start URL: ${startUrl}\n`));

  const spinner = ora('Registering client with AWS SSO...').start();

  try {
    // Perform device code flow
    const result = await deviceCodeClient.login(startUrl, region);

    spinner.succeed('Authentication successful!');

    // Extract profile ARN from access token
    const profileArn = await extractProfileArnFromToken(result.tokens.accessToken);

    // Store credentials (including clientId and clientSecret for refresh)
    await storeCredentials(configManager, keychainStore, {
      accountId: generateAccountId(profileArn),
      provider: 'kiro-oauth',
      region,
      profileArn,
      tokens: result.tokens,
      clientId: result.clientId,
      clientSecret: result.clientSecret,
    });

    console.log(chalk.green('\n✓ Builder ID login successful!'));
    displayNextSteps();
  } catch (error) {
    spinner.fail('Authentication failed');
    throw error;
  }
}

/**
 * Login with SSO (Enterprise Single Sign-On)
 */
async function loginWithSSO(options: LoginOptions): Promise<void> {
  console.log(chalk.blue('\n🏢 SSO Login\n'));
  console.log(chalk.gray('Enterprise Single Sign-On authentication\n'));

  const configManager = new ConfigurationManager();
  const keychainStore = new KeychainStore();

  // Get SSO URL
  const ssoUrl = options.ssoUrl || await promptSSOUrl();

  // Get region
  const region = options.region
    ? await validateRegionOption(options.region)
    : await promptRegion();

  console.log(chalk.gray(`SSO URL: ${ssoUrl}`));
  console.log(chalk.gray(`Region: ${region}\n`));

  const spinner = ora('Opening SSO login page...').start();

  try {
    // Open SSO URL in browser
    const { exec } = await import('child_process');
    const openCommand = process.platform === 'darwin' ? 'open' :
                       process.platform === 'win32' ? 'start' : 'xdg-open';

    exec(`${openCommand} "${ssoUrl}"`);

    spinner.info('Browser opened. Complete authentication in your browser.');

    // Prompt for token after SSO login
    const { accessToken } = await inquirer.prompt([
      {
        type: 'password',
        name: 'accessToken',
        message: 'Enter the access token from SSO:',
        mask: '*',
        validate: (input: string) => {
          if (!input) return 'Access token is required';
          if (input.length < 20) return 'Invalid token format';
          return true;
        },
      },
    ]);

    spinner.start('Validating SSO token...');

    // Extract profile ARN from token
    const profileArn = await extractProfileArnFromToken(accessToken);

    // Create token object
    const tokens = {
      accessToken,
      refreshToken: '', // SSO may not provide refresh token
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour default
    };

    // Store credentials
    await storeCredentials(configManager, keychainStore, {
      accountId: generateAccountId(profileArn),
      provider: 'kiro-oauth',
      region,
      profileArn,
      tokens,
    });

    spinner.succeed('SSO login successful!');
    console.log(chalk.green('\n✓ SSO authentication complete!'));
    displayNextSteps();
  } catch (error) {
    spinner.fail('SSO login failed');
    throw error;
  }
}

/**
 * Login with token import (from existing Kiro session)
 */
async function loginWithTokenImport(options: LoginOptions): Promise<void> {
  console.log(chalk.blue('\n📥 Import Kiro Token\n'));
  console.log(chalk.gray('Import session token from existing Kiro installation\n'));

  const configManager = new ConfigurationManager();
  const keychainStore = new KeychainStore();

  // Get region
  const region = options.region
    ? await validateRegionOption(options.region)
    : await promptRegion();

  console.log(chalk.yellow('Where to find your Kiro token:'));
  console.log(chalk.gray('  1. Open Kiro application'));
  console.log(chalk.gray('  2. Go to Settings → Account'));
  console.log(chalk.gray('  3. Click "Export Token"'));
  console.log(chalk.gray('  4. Copy the access token\n'));

  // Prompt for tokens
  const { accessToken, refreshToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'accessToken',
      message: 'Enter Kiro access token:',
      mask: '*',
      validate: (input: string) => {
        if (!input) return 'Access token is required';
        if (input.length < 20) return 'Invalid token format';
        return true;
      },
    },
    {
      type: 'password',
      name: 'refreshToken',
      message: 'Enter Kiro refresh token (optional):',
      mask: '*',
    },
  ]);

  const spinner = ora('Validating imported token...').start();

  try {
    // Extract profile ARN from token
    const profileArn = await extractProfileArnFromToken(accessToken);

    // Create token object
    const tokens = {
      accessToken,
      refreshToken: refreshToken || '',
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour default
    };

    // Store credentials
    await storeCredentials(configManager, keychainStore, {
      accountId: generateAccountId(profileArn),
      provider: 'kiro-oauth',
      region,
      profileArn,
      tokens,
    });

    spinner.succeed('Token imported successfully!');
    console.log(chalk.green('\n✓ Kiro token imported!'));
    displayNextSteps();
  } catch (error) {
    spinner.fail('Token import failed');
    throw error;
  }
}

/**
 * Login with manual token entry
 */
async function loginWithManualToken(options: LoginOptions): Promise<void> {
  console.log(chalk.blue('\n✏️  Manual Token Entry\n'));
  console.log(chalk.gray('Manually enter Kiro access token\n'));

  const configManager = new ConfigurationManager();
  const keychainStore = new KeychainStore();

  // Get region
  const region = options.region
    ? await validateRegionOption(options.region)
    : await promptRegion();

  // Prompt for token
  const { accessToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'accessToken',
      message: 'Enter access token:',
      mask: '*',
      validate: (input: string) => {
        if (!input) return 'Access token is required';
        if (input.length < 20) return 'Invalid token format';
        return true;
      },
    },
  ]);

  const spinner = ora('Validating token...').start();

  try {
    // Extract profile ARN from token
    const profileArn = await extractProfileArnFromToken(accessToken);

    // Create token object
    const tokens = {
      accessToken,
      refreshToken: '',
      expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour default
    };

    // Store credentials
    await storeCredentials(configManager, keychainStore, {
      accountId: generateAccountId(profileArn),
      provider: 'kiro-oauth',
      region,
      profileArn,
      tokens,
    });

    spinner.succeed('Token validated successfully!');
    console.log(chalk.green('\n✓ Manual token added!'));
    displayNextSteps();
  } catch (error) {
    spinner.fail('Token validation failed');
    throw error;
  }
}

/**
 * Store credentials in keychain and config
 */
async function storeCredentials(
  configManager: ConfigurationManager,
  keychainStore: KeychainStore,
  data: {
    accountId: string;
    provider: 'kiro-oauth';
    region: ValidRegion;
    profileArn: string;
    tokens: {
      accessToken: string;
      refreshToken: string;
      expiresAt: Date;
    };
    clientId?: string;
    clientSecret?: string;
  }
): Promise<void> {
  const { accountId, provider, region, profileArn, tokens, clientId, clientSecret } = data;

  // Load config from file
  const configPath = process.env.CLAUDEFLOW_CONFIG || `${process.env.HOME}/.claudeflow/config.json`;
  await configManager.loadConfig(configPath);

  // Check for duplicate account
  const config = configManager.getConfig();
  const existingAccount = config.accounts.find(a => a.id === accountId);

  if (existingAccount) {
    console.log(chalk.yellow(`\n⚠️  Account ${accountId} already exists`));

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
      clientId,
      clientSecret,
    });

    spinner.succeed('Credentials stored in OS keychain');
  } catch (error) {
    spinner.fail('Failed to store credentials');
    throw error;
  }

  // Store account metadata in config (NO sensitive data)
  const accountMetadata: KiroOAuthAccount = {
    id: accountId,
    provider,
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

  // Display account details
  console.log(chalk.blue('\nAccount Details:'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(`${chalk.bold('Account ID:')} ${accountId}`);
  console.log(`${chalk.bold('Provider:')} ${provider}`);
  console.log(`${chalk.bold('Region:')} ${region}`);
  console.log(`${chalk.bold('Profile ARN:')} ${profileArn}`);
  console.log(`${chalk.bold('Token Expires:')} ${tokens.expiresAt.toLocaleString()}`);
  console.log(`${chalk.bold('Access Token:')} ${sanitizeToken(tokens.accessToken)}`);
  console.log(chalk.gray('─'.repeat(60)));
}

/**
 * Display next steps
 */
function displayNextSteps(): void {
  console.log(chalk.green('\n✓ You can now use ClaudeFlow with this account!'));
  console.log(chalk.gray('\nNext steps:'));
  console.log(chalk.gray('  • Start the daemon: claudeflow daemon start'));
  console.log(chalk.gray('  • Check health: claudeflow health'));
  console.log(chalk.gray('  • View accounts: claudeflow account list'));
}

/**
 * Prompt for AWS region
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
 * Prompt for SSO URL
 */
async function promptSSOUrl(): Promise<string> {
  const { ssoUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'ssoUrl',
      message: 'Enter your organization SSO URL:',
      validate: (input: string) => {
        if (!input) return 'SSO URL is required';
        try {
          new URL(input);
          return true;
        } catch {
          return 'Invalid URL format';
        }
      },
    },
  ]);

  return ssoUrl;
}

/**
 * Validate method option from CLI flag
 */
async function validateMethodOption(method: string): Promise<LoginMethod> {
  const validMethods: LoginMethod[] = ['builder-id', 'sso', 'token-import', 'manual-token'];

  if (!validMethods.includes(method as LoginMethod)) {
    throw new Error(
      `Invalid login method: ${method}. Must be one of: ${validMethods.join(', ')}`
    );
  }

  return method as LoginMethod;
}

/**
 * Validate region option from CLI flag
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
 */
async function extractProfileArnFromToken(accessToken: string): Promise<string> {
  try {
    // JWT tokens have 3 parts: header.payload.signature
    const parts = accessToken.split('.');

    if (parts.length !== 3) {
      // Not a JWT - might be an opaque token
      // Generate a profile ARN from the token hash
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(accessToken).digest('hex').substring(0, 16);
      console.log(chalk.yellow('\n⚠️  Token is not a JWT, generating profile ARN from token hash'));
      return `arn:aws:codewhisperer:us-east-1:000000000000:profile/${hash}`;
    }

    // Decode payload (base64url)
    const payload = parts[1];

    // Add padding if needed for base64 decoding
    let paddedPayload = payload;
    while (paddedPayload.length % 4) {
      paddedPayload += '=';
    }

    const decoded = Buffer.from(paddedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(decoded);

    console.log(chalk.gray('\nToken claims:'), JSON.stringify(claims, null, 2));

    // Extract profileArn from claims
    const profileArn =
      claims.profile_arn ||
      claims.profileArn ||
      claims['custom:profile_arn'] ||
      claims.arn ||
      claims.sub;

    if (!profileArn) {
      // Generate from sub or token hash
      const crypto = await import('crypto');
      const identifier = claims.sub || crypto.createHash('sha256').update(accessToken).digest('hex').substring(0, 16);
      console.log(chalk.yellow('\n⚠️  Profile ARN not found in token, generating from identifier'));
      return `arn:aws:codewhisperer:us-east-1:000000000000:profile/${identifier}`;
    }

    // If it's already an ARN, return it
    if (profileArn.startsWith('arn:')) {
      return profileArn;
    }

    // Otherwise, construct ARN from identifier
    return `arn:aws:codewhisperer:us-east-1:000000000000:profile/${profileArn}`;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to extract profile ARN from token: ${error.message}`);
    }
    throw error;
  }
}
