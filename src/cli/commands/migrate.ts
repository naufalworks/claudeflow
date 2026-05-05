/**
 * Migration Command
 * 
 * Migrates from old 9router-based authentication to new Kiro OAuth
 * 
 * Security features:
 * - Secure backups with 0600 permissions
 * - Sensitive field redaction (sessionToken, combo)
 * - Atomic file operations
 * - Comprehensive error handling
 * - Audit logging without credential exposure
 */

import * as fs from 'fs/promises';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigurationManager } from '../../config/manager.js';
import { loginCommand } from './login.js';
import { logger } from '../utils/logger.js';
import { logSecurityEvent } from '../utils/security.js';

/**
 * Old Kiro account format (9router-based)
 */
interface OldKiroAccount {
  id: string;
  provider: 'kiro';
  kiroConfig: {
    machineId: string;
    mitmRouterUrl: string;
    sessionToken?: string;
    sessionExpiry?: string;
    combo?: string;
  };
}

/**
 * Migration result
 */
interface MigrationResult {
  success: boolean;
  oldAccountCount: number;
  newAccountCount: number;
  backupPath: string;
  error?: string;
}

/**
 * Migration command handler
 * 
 * Implements secure migration from 9router to Kiro OAuth
 */
export async function migrateCommand(): Promise<void> {
  console.log(chalk.blue.bold('\n🔄 ClaudeFlow Migration: 9router → Kiro OAuth\n'));

  try {
    logger.info('Migration started');
    logSecurityEvent('migration_started', null, 'success', {});

    // Phase 1: Pre-migration validation
    const validationResult = await validatePreMigration();
    
    if (!validationResult.hasOldAccounts) {
      console.log(chalk.green('\n✓ No old 9router accounts found. Your configuration is up to date!\n'));
      logger.info('Migration skipped - no old accounts found');
      return;
    }

    console.log(chalk.yellow(`\n⚠ Warning: Migration requires re-authentication`));
    console.log(chalk.gray('  Your old accounts will be removed and you\'ll need to log in again.'));
    console.log(chalk.gray('  Your optimization settings will be preserved.\n'));

    const { shouldProceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldProceed',
        message: 'Proceed with migration?',
        default: false,
      },
    ]);

    if (!shouldProceed) {
      console.log(chalk.gray('\nMigration cancelled.\n'));
      logger.info('Migration cancelled by user');
      return;
    }

    // Phase 2: Secure backup creation
    const backupPath = await createSecureBackup(validationResult.configManager);

    // Phase 3: Account removal
    await removeOldAccounts(validationResult.configManager, validationResult.oldAccounts);

    // Phase 4: User guidance for re-authentication
    const newAccountCount = await guideReAuthentication(validationResult.oldAccounts.length);

    // Phase 5: Post-migration validation
    await validatePostMigration(newAccountCount);

    // Display success summary
    displayMigrationSummary({
      success: true,
      oldAccountCount: validationResult.oldAccounts.length,
      newAccountCount,
      backupPath,
    });

    logger.info('Migration completed successfully', {
      oldAccountCount: validationResult.oldAccounts.length,
      newAccountCount,
      backupPath,
    });

    logSecurityEvent('migration_completed', null, 'success', {
      oldAccountCount: validationResult.oldAccounts.length,
      newAccountCount,
    });

  } catch (error) {
    logger.error('Migration failed', error);
    
    logSecurityEvent('migration_failed', null, 'failure', {
      error: error instanceof Error ? error.message : String(error),
    });

    console.error(chalk.red('\n✗ Migration failed:'), error instanceof Error ? error.message : String(error));
    console.error(chalk.yellow('\nYour configuration has been preserved.'));
    console.error(chalk.yellow('If a backup was created, you can find it in your config directory.\n'));

    process.exit(1);
  }
}

/**
 * Phase 1: Pre-migration validation
 */
async function validatePreMigration(): Promise<{
  hasOldAccounts: boolean;
  oldAccounts: OldKiroAccount[];
  configManager: ConfigurationManager;
}> {
  const spinner = ora('Step 1/5: Validating configuration...').start();

  try {
    const configManager = new ConfigurationManager();
    const config = configManager.getConfig();

    // Detect old accounts
    const oldAccounts = config.accounts.filter(isOldKiroAccount) as OldKiroAccount[];

    if (oldAccounts.length === 0) {
      spinner.succeed('Step 1/5: Validation complete - no old accounts found');
      return {
        hasOldAccounts: false,
        oldAccounts: [],
        configManager,
      };
    }

    spinner.succeed(`Step 1/5: Validation complete - found ${oldAccounts.length} old 9router account${oldAccounts.length > 1 ? 's' : ''}`);

    // Display old accounts
    console.log(chalk.gray('\nOld accounts to migrate:'));
    for (const account of oldAccounts) {
      console.log(chalk.gray(`  • ${account.id}`));
    }

    return {
      hasOldAccounts: true,
      oldAccounts,
      configManager,
    };
  } catch (error) {
    spinner.fail('Step 1/5: Validation failed');
    throw error;
  }
}

/**
 * Phase 2: Create secure backup with redacted sensitive fields
 */
async function createSecureBackup(configManager: ConfigurationManager): Promise<string> {
  const spinner = ora('Step 2/5: Creating secure backup...').start();

  try {
    const config = configManager.getConfig();
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0]; // YYYYMMDDTHHMMSS
    const configPath = configManager.getConfigPath();
    const backupPath = `${configPath}.backup.${timestamp}`;

    // Redact sensitive fields
    const redactedConfig = redactSensitiveFields(config);

    // Write to temp file first (atomic operation)
    const tempPath = `${backupPath}.tmp`;
    await fs.writeFile(
      tempPath,
      JSON.stringify(redactedConfig, null, 2),
      { mode: 0o600 } // Owner read/write only
    );

    // Validate JSON structure
    const written = await fs.readFile(tempPath, 'utf8');
    JSON.parse(written); // Throws if invalid

    // Atomic rename
    await fs.rename(tempPath, backupPath);

    // Verify permissions
    const stats = await fs.stat(backupPath);
    const permissions = (stats.mode & parseInt('777', 8)).toString(8);
    
    if (permissions !== '600') {
      // Fix permissions if not correct
      await fs.chmod(backupPath, 0o600);
    }

    spinner.succeed(`Step 2/5: Secure backup created`);
    console.log(chalk.gray(`  Location: ${backupPath}`));

    logger.info('Backup created', { backupPath, permissions: '0600' });

    return backupPath;
  } catch (error) {
    spinner.fail('Step 2/5: Backup creation failed');
    throw error;
  }
}

/**
 * Phase 3: Remove old accounts from configuration
 */
async function removeOldAccounts(
  configManager: ConfigurationManager,
  oldAccounts: OldKiroAccount[]
): Promise<void> {
  const spinner = ora('Step 3/5: Removing old accounts...').start();

  try {
    const config = configManager.getConfig();

    // Filter out old accounts (preserve all other accounts and settings)
    config.accounts = config.accounts.filter(account => !isOldKiroAccount(account));

    // Save config atomically
    await saveConfigAtomic(configManager, config);

    spinner.succeed(`Step 3/5: Removed ${oldAccounts.length} old account${oldAccounts.length > 1 ? 's' : ''}`);

    logger.info('Old accounts removed', { count: oldAccounts.length });
  } catch (error) {
    spinner.fail('Step 3/5: Account removal failed');
    throw error;
  }
}

/**
 * Phase 4: Guide user through re-authentication
 */
async function guideReAuthentication(oldAccountCount: number): Promise<number> {
  console.log(chalk.blue('\nStep 4/5: Re-authentication required'));
  console.log(chalk.gray(`  You need to add ${oldAccountCount} account${oldAccountCount > 1 ? 's' : ''} using the new OAuth flow.\n`));

  const { shouldAddNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldAddNow',
      message: 'Would you like to add accounts now?',
      default: true,
    },
  ]);

  if (!shouldAddNow) {
    console.log(chalk.yellow('\nTo add accounts later, run:'));
    console.log(chalk.gray('  claudeflow login --provider aws --region us-east-1\n'));
    return 0;
  }

  let successCount = 0;

  for (let i = 0; i < oldAccountCount; i++) {
    console.log(chalk.blue(`\nAdding account ${i + 1}/${oldAccountCount}...`));

    try {
      await loginCommand({});
      successCount++;
    } catch (error) {
      console.error(chalk.red(`Failed to add account ${i + 1}:`), error instanceof Error ? error.message : String(error));
      console.log(chalk.yellow('You can add this account later using: claudeflow login\n'));
    }
  }

  return successCount;
}

/**
 * Phase 5: Post-migration validation
 */
async function validatePostMigration(newAccountCount: number): Promise<void> {
  const spinner = ora('Step 5/5: Validating new configuration...').start();

  try {
    const configManager = new ConfigurationManager();
    const config = configManager.getConfig();

    // Count new Kiro OAuth accounts
    const kiroOAuthAccounts = config.accounts.filter(
      account => account.provider === 'kiro-oauth'
    );

    spinner.succeed('Step 5/5: Validation complete');

    if (kiroOAuthAccounts.length === 0 && newAccountCount > 0) {
      console.log(chalk.yellow('\n⚠ Warning: No new accounts were added successfully.'));
      console.log(chalk.yellow('  You can add accounts later using: claudeflow login\n'));
    }

    logger.info('Post-migration validation complete', {
      newAccountCount: kiroOAuthAccounts.length,
    });
  } catch (error) {
    spinner.fail('Step 5/5: Validation failed');
    throw error;
  }
}

/**
 * Display migration summary
 */
function displayMigrationSummary(result: MigrationResult): void {
  console.log(chalk.green('\n✓ Migration completed successfully!\n'));
  console.log(chalk.blue('Summary:'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log(`${chalk.bold('Old accounts removed:')} ${result.oldAccountCount}`);
  console.log(`${chalk.bold('New accounts added:')} ${result.newAccountCount}`);
  console.log(`${chalk.bold('Backup location:')} ${result.backupPath}`);
  console.log(chalk.gray('─'.repeat(60)));

  console.log(chalk.green('\nNext steps:'));
  console.log(chalk.gray('  • Start daemon: claudeflow daemon start'));
  console.log(chalk.gray('  • Check health: claudeflow health'));
  console.log(chalk.gray('  • View accounts: claudeflow account list\n'));

  if (result.newAccountCount < result.oldAccountCount) {
    console.log(chalk.yellow('⚠ Note: Fewer accounts were added than removed.'));
    console.log(chalk.yellow('  You can add more accounts using: claudeflow login\n'));
  }
}

/**
 * Check if account is old Kiro account (9router-based)
 */
function isOldKiroAccount(account: any): account is OldKiroAccount {
  return account.provider === 'kiro' && account.kiroConfig !== undefined;
}

/**
 * Redact sensitive fields from configuration
 * 
 * Security: Removes sessionToken and combo fields to prevent credential exposure
 */
function redactSensitiveFields(config: any): any {
  const redacted = JSON.parse(JSON.stringify(config));

  for (const account of redacted.accounts) {
    if (account.kiroConfig) {
      // Redact sensitive fields
      if (account.kiroConfig.sessionToken) {
        account.kiroConfig.sessionToken = 'REDACTED - not needed for rollback';
      }
      if (account.kiroConfig.combo) {
        account.kiroConfig.combo = 'REDACTED - not needed for rollback';
      }
    }
  }

  return redacted;
}

/**
 * Save configuration atomically
 * 
 * Security: Uses atomic write (temp file + rename) to prevent corruption
 */
async function saveConfigAtomic(
  configManager: ConfigurationManager,
  config: any
): Promise<void> {
  const configPath = configManager.getConfigPath();
  const tempPath = `${configPath}.tmp.${Date.now()}`;

  try {
    // Write to temp file with secure permissions
    await fs.writeFile(
      tempPath,
      JSON.stringify(config, null, 2),
      { mode: 0o600 }
    );

    // Validate JSON structure
    const written = await fs.readFile(tempPath, 'utf8');
    JSON.parse(written); // Throws if invalid

    // Atomic rename (overwrites original)
    await fs.rename(tempPath, configPath);

    logger.info('Config saved atomically', { configPath });
  } catch (error) {
    // Cleanup temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
