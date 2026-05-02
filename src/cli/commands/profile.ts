/**
 * Profile Command
 * 
 * Manage configuration profiles
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';

/**
 * Profile create command
 */
export async function profileCreateCommand(name: string): Promise<void> {
  try {
    logger.info('Starting profile create command', { name });

    // Validate profile name
    if (!name || name.trim() === '') {
      throw new Error('Profile name cannot be empty');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('Profile name can only contain letters, numbers, hyphens, and underscores');
    }

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Check if profile already exists
    const profiles = await configService.listProfiles();
    if (profiles.includes(name)) {
      throw new Error(`Profile '${name}' already exists`);
    }

    // Get current config
    const currentConfig = await configService.getConfig();

    // Save as new profile
    await configService.saveProfile(name, currentConfig);

    console.log(chalk.green(`\n✓ Profile '${name}' created`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Based on current configuration'));
    console.log(chalk.gray(`Switch to this profile: claudeflow profile switch ${name}`));

    logger.info('Profile create command completed successfully', { name });
  } catch (error) {
    logger.error('Profile create command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Profile list command
 */
export async function profileListCommand(): Promise<void> {
  try {
    logger.info('Starting profile list command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const profiles = await configService.listProfiles();
    const currentConfig = await configService.getConfig();
    const activeProfile = currentConfig.activeProfile;

    if (profiles.length === 0) {
      console.log(chalk.yellow('\n⚠ No profiles found'));
      console.log(chalk.gray('Create a profile with: claudeflow profile create <name>'));
      return;
    }

    console.log(chalk.blue.bold('\n📋 Configuration Profiles\n'));

    const table = new Table({
      head: [chalk.cyan('Profile'), chalk.cyan('Status')],
      colWidths: [30, 20],
    });

    for (const profile of profiles) {
      const status = profile === activeProfile
        ? chalk.green('● Active')
        : chalk.gray('○ Inactive');
      
      table.push([profile, status]);
    }

    console.log(table.toString());

    console.log(chalk.gray(`\nActive profile: ${chalk.bold(activeProfile)}`));
    console.log(chalk.gray(`Total profiles: ${profiles.length}`));

    logger.info('Profile list command completed successfully', { count: profiles.length });
  } catch (error) {
    logger.error('Profile list command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Profile switch command
 */
export async function profileSwitchCommand(name: string): Promise<void> {
  try {
    logger.info('Starting profile switch command', { name });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Check if profile exists
    const profiles = await configService.listProfiles();
    if (!profiles.includes(name)) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    // Load profile
    const profileConfig = await configService.loadProfile(name);

    // Update active profile
    profileConfig.activeProfile = name;

    // Save as current config
    await configService.save(profileConfig);

    console.log(chalk.green(`\n✓ Switched to profile '${name}'`));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('Configuration reloaded from profile'));
    console.log(chalk.gray('Restart daemon if running: claudeflow daemon restart'));

    logger.info('Profile switch command completed successfully', { name });
  } catch (error) {
    logger.error('Profile switch command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Profile delete command
 */
export async function profileDeleteCommand(name: string): Promise<void> {
  try {
    logger.info('Starting profile delete command', { name });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Check if profile exists
    const profiles = await configService.listProfiles();
    if (!profiles.includes(name)) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    // Check if it's the active profile
    const currentConfig = await configService.getConfig();
    if (currentConfig.activeProfile === name) {
      throw new Error('Cannot delete the active profile. Switch to another profile first.');
    }

    // Confirm with user
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete profile '${name}'? This cannot be undone.`,
        default: false,
      },
    ]);

    if (!answers.confirm) {
      console.log(chalk.yellow('\n⚠ Delete cancelled'));
      return;
    }

    // Delete profile
    await configService.deleteProfile(name);

    console.log(chalk.green(`\n✓ Profile '${name}' deleted`));

    logger.info('Profile delete command completed successfully', { name });
  } catch (error) {
    logger.error('Profile delete command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
