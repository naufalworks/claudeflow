/**
 * Backup Command
 * 
 * Manage configuration backups
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { ConfigService } from '../services/config-service.js';
import { FileManager } from '../utils/file-manager.js';
import { logger } from '../utils/logger.js';

/**
 * Format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format date
 */
function formatDate(date: Date): string {
  return date.toLocaleString();
}

/**
 * Backup create command
 */
export async function backupCreateCommand(): Promise<void> {
  try {
    logger.info('Starting backup create command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const fileManager = new FileManager(configService.getConfigDir());

    // Create backup
    console.log(chalk.blue('\n💾 Creating backup...\n'));

    const backupPath = await fileManager.createBackup();

    console.log(chalk.green('✓ Backup created successfully'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.bold('Location:')} ${backupPath}`);
    console.log(chalk.gray('─'.repeat(60)));

    logger.info('Backup create command completed successfully', { path: backupPath });
  } catch (error) {
    logger.error('Backup create command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Backup list command
 */
export async function backupListCommand(): Promise<void> {
  try {
    logger.info('Starting backup list command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const fileManager = new FileManager(configService.getConfigDir());

    // List backups
    const backups = await fileManager.listBackups();

    if (backups.length === 0) {
      console.log(chalk.yellow('\n⚠ No backups found'));
      console.log(chalk.gray('Create a backup with: claudeflow backup create'));
      return;
    }

    console.log(chalk.blue.bold('\n💾 Backups\n'));

    const table = new Table({
      head: [chalk.cyan('Timestamp'), chalk.cyan('Size'), chalk.cyan('Path')],
      colWidths: [25, 15, 50],
    });

    for (const backup of backups) {
      table.push([
        formatDate(backup.timestamp),
        formatFileSize(backup.size),
        backup.id,
      ]);
    }

    console.log(table.toString());

    console.log(chalk.gray(`\nTotal backups: ${backups.length}`));
    console.log(chalk.gray('Restore a backup: claudeflow backup restore <timestamp>'));

    logger.info('Backup list command completed successfully', { count: backups.length });
  } catch (error) {
    logger.error('Backup list command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Backup restore command
 */
export async function backupRestoreCommand(timestamp: string): Promise<void> {
  try {
    logger.info('Starting backup restore command', { timestamp });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const fileManager = new FileManager(configService.getConfigDir());

    // Confirm with user
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to restore from this backup? Current configuration will be overwritten.',
        default: false,
      },
    ]);

    if (!answers.confirm) {
      console.log(chalk.yellow('\n⚠ Restore cancelled'));
      return;
    }

    // Restore backup
    console.log(chalk.blue('\n💾 Restoring backup...\n'));

    await fileManager.restoreBackup(timestamp);

    console.log(chalk.green('✓ Backup restored successfully'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Configuration has been restored'));
    console.log(chalk.gray('Restart daemon if running: claudeflow daemon restart'));
    console.log(chalk.gray('─'.repeat(60)));

    logger.info('Backup restore command completed successfully', { timestamp });
  } catch (error) {
    logger.error('Backup restore command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Backup export command
 */
export async function backupExportCommand(timestamp: string, output: string): Promise<void> {
  try {
    logger.info('Starting backup export command', { timestamp, output });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const fileManager = new FileManager(configService.getConfigDir());

    // Export backup
    console.log(chalk.blue('\n💾 Exporting backup...\n'));

    await fileManager.exportBackup(timestamp, output);

    console.log(chalk.green('✓ Backup exported successfully'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.bold('Location:')} ${output}`);
    console.log(chalk.gray('─'.repeat(60)));

    logger.info('Backup export command completed successfully', { timestamp, output });
  } catch (error) {
    logger.error('Backup export command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Backup import command
 */
export async function backupImportCommand(input: string): Promise<void> {
  try {
    logger.info('Starting backup import command', { input });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const fileManager = new FileManager(configService.getConfigDir());

    // Confirm with user
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to import this backup? Current configuration will be overwritten.',
        default: false,
      },
    ]);

    if (!answers.confirm) {
      console.log(chalk.yellow('\n⚠ Import cancelled'));
      return;
    }

    // Import backup
    console.log(chalk.blue('\n💾 Importing backup...\n'));

    await fileManager.importBackup(input);

    console.log(chalk.green('✓ Backup imported successfully'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Configuration has been imported'));
    console.log(chalk.gray('Restart daemon if running: claudeflow daemon restart'));
    console.log(chalk.gray('─'.repeat(60)));

    logger.info('Backup import command completed successfully', { input });
  } catch (error) {
    logger.error('Backup import command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
