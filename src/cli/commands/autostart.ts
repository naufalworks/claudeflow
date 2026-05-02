/**
 * Autostart Command
 * 
 * Configure auto-start on system boot
 */

import chalk from 'chalk';
import ora from 'ora';
import { platform } from 'os';
import { DaemonService } from '../services/daemon-service.js';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';

/**
 * Get platform-specific instructions
 */
function getPlatformInstructions(): string {
  const os = platform();

  if (os === 'darwin') {
    return `
${chalk.bold('macOS (launchd):')}
The service file has been created at:
  ~/Library/LaunchAgents/com.claudeflow.daemon.plist

To manually load the service:
  ${chalk.cyan('launchctl load ~/Library/LaunchAgents/com.claudeflow.daemon.plist')}

To manually unload the service:
  ${chalk.cyan('launchctl unload ~/Library/LaunchAgents/com.claudeflow.daemon.plist')}

The daemon will start automatically on next login.`;
  } else if (os === 'linux') {
    return `
${chalk.bold('Linux (systemd):')}
The service file has been created at:
  ~/.config/systemd/user/claudeflow.service

To manually enable and start the service:
  ${chalk.cyan('systemctl --user enable claudeflow.service')}
  ${chalk.cyan('systemctl --user start claudeflow.service')}

To manually disable and stop the service:
  ${chalk.cyan('systemctl --user disable claudeflow.service')}
  ${chalk.cyan('systemctl --user stop claudeflow.service')}

The daemon will start automatically on next boot.`;
  } else if (os === 'win32') {
    return `
${chalk.bold('Windows:')}
Auto-start on Windows is not yet implemented.
You can manually start the daemon with:
  ${chalk.cyan('claudeflow daemon start')}`;
  } else {
    return `
${chalk.bold('Unsupported Platform:')}
Auto-start is not supported on this platform.
You can manually start the daemon with:
  ${chalk.cyan('claudeflow daemon start')}`;
  }
}

/**
 * Autostart enable command
 */
export async function autostartEnableCommand(): Promise<void> {
  try {
    logger.info('Starting autostart enable command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const daemonService = new DaemonService(undefined, configService.getConfigDir());

    // Check if already enabled
    const isEnabled = await daemonService.isAutoStartEnabled();
    if (isEnabled) {
      console.log(chalk.yellow('\n⚠ Auto-start is already enabled'));
      console.log(chalk.gray('Disable with: claudeflow autostart disable'));
      return;
    }

    // Enable auto-start
    const spinner = ora('Enabling auto-start...').start();

    try {
      await daemonService.enableAutoStart();
      spinner.succeed('Auto-start enabled successfully!');

      console.log(chalk.green('\n✓ Auto-start has been enabled'));
      console.log(chalk.gray('ClaudeFlow daemon will start automatically on system boot'));

      // Show platform-specific instructions
      console.log(getPlatformInstructions());

      logger.info('Autostart enable command completed successfully');
    } catch (error) {
      spinner.fail('Failed to enable auto-start');
      throw error;
    }
  } catch (error) {
    logger.error('Autostart enable command failed', error);

    if (error instanceof Error) {
      if (error.message.includes('not supported')) {
        console.error(chalk.yellow('\n⚠ Auto-start is not supported on this platform'));
        console.log(chalk.gray('You can manually start the daemon with: claudeflow daemon start'));
      } else if (error.message.includes('not yet implemented')) {
        console.error(chalk.yellow('\n⚠ Auto-start is not yet implemented for Windows'));
        console.log(chalk.gray('You can manually start the daemon with: claudeflow daemon start'));
      } else {
        console.error(chalk.red('\n✗ Error:'), error.message);
      }
    }

    process.exit(1);
  }
}

/**
 * Autostart disable command
 */
export async function autostartDisableCommand(): Promise<void> {
  try {
    logger.info('Starting autostart disable command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const daemonService = new DaemonService(undefined, configService.getConfigDir());

    // Check if already disabled
    const isEnabled = await daemonService.isAutoStartEnabled();
    if (!isEnabled) {
      console.log(chalk.yellow('\n⚠ Auto-start is already disabled'));
      return;
    }

    // Disable auto-start
    const spinner = ora('Disabling auto-start...').start();

    try {
      await daemonService.disableAutoStart();
      spinner.succeed('Auto-start disabled successfully!');

      console.log(chalk.green('\n✓ Auto-start has been disabled'));
      console.log(chalk.gray('ClaudeFlow daemon will no longer start automatically on system boot'));
      console.log(chalk.gray('You can still start it manually with: claudeflow daemon start'));

      logger.info('Autostart disable command completed successfully');
    } catch (error) {
      spinner.fail('Failed to disable auto-start');
      throw error;
    }
  } catch (error) {
    logger.error('Autostart disable command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Autostart status command
 */
export async function autostartStatusCommand(): Promise<void> {
  try {
    logger.info('Starting autostart status command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const daemonService = new DaemonService(undefined, configService.getConfigDir());

    // Get auto-start status
    const isEnabled = await daemonService.isAutoStartEnabled();

    console.log(chalk.blue.bold('\n📊 Auto-start Status\n'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`${chalk.bold('Platform:')} ${platform()}`);
    console.log(`${chalk.bold('Status:')} ${isEnabled ? chalk.green('Enabled') : chalk.gray('Disabled')}`);
    console.log(chalk.gray('─'.repeat(50)));

    if (isEnabled) {
      console.log(chalk.green('\n✓ ClaudeFlow daemon will start automatically on system boot'));
      console.log(chalk.gray('Disable with: claudeflow autostart disable'));
    } else {
      console.log(chalk.gray('\nAuto-start is disabled'));
      console.log(chalk.gray('Enable with: claudeflow autostart enable'));
    }

    // Show platform-specific information
    if (isEnabled) {
      console.log(getPlatformInstructions());
    }

    logger.info('Autostart status command completed successfully');
  } catch (error) {
    logger.error('Autostart status command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
