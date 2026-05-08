/**
 * Daemon Command
 * 
 * Manage ClaudeFlow daemon process
 */

import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { DaemonService } from '../services/daemon-service.js';
import { ConfigurationManager } from '../../config/manager.js';
import { logger } from '../utils/logger.js';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format uptime to human-readable format
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Daemon start command
 */
export async function daemonStartCommand(options: { mitm?: boolean } = {}): Promise<void> {
  try {
    logger.info('Starting daemon start command', { mitm: options.mitm });

    // Initialize services
    const configManager = new ConfigurationManager();
    const configPath = process.env.CLAUDEFLOW_CONFIG || join(homedir(), '.claudeflow', 'config.json');
    await configManager.loadConfig(configPath);

    const config = configManager.getConfig();

    // Get script path (built ClaudeFlow server)
    const scriptPath = join(process.cwd(), 'dist', 'index.js');
    const configDir = join(homedir(), '.claudeflow');

    const daemonService = new DaemonService(scriptPath, configDir);

    // Start daemon
    const spinner = ora('Starting ClaudeFlow daemon...').start();

    try {
      await daemonService.start();
      spinner.succeed('Daemon started successfully!');

      // If MITM flag is set, start MITM proxy
      if (options.mitm) {
        console.log(chalk.blue('\n🔒 Starting MITM proxy...'));

        // Import MITM command dynamically
        const { mitmStartCommand } = await import('./mitm.js');
        await mitmStartCommand({ daemon: true });
      }

      // Wait a moment for daemon to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get status
      const status = await daemonService.status();

      console.log(chalk.green('\n✓ ClaudeFlow daemon is running'));
      console.log(chalk.blue('\nDaemon Status:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('PID:')} ${status.pid || 'N/A'}`);
      console.log(`${chalk.bold('Status:')} ${chalk.green(status.status || 'online')}`);
      console.log(`${chalk.bold('Port:')} ${config.server.port}`);
      console.log(`${chalk.bold('Host:')} ${config.server.host}`);
      if (options.mitm) {
        console.log(`${chalk.bold('MITM Proxy:')} ${chalk.green('Running on port 443')}`);
      }
      console.log(chalk.gray('─'.repeat(50)));

      console.log(chalk.gray('\nNext steps:'));
      console.log(chalk.gray('  • Check status: claudeflow daemon status'));
      console.log(chalk.gray('  • View logs: claudeflow logs'));
      console.log(chalk.gray('  • Check health: claudeflow health'));
      if (options.mitm) {
        console.log(chalk.gray('  • Check MITM status: claudeflow mitm status'));
      }

      logger.info('Daemon start command completed successfully');
    } catch (error) {
      spinner.fail('Failed to start daemon');
      throw error;
    }
  } catch (error) {
    logger.error('Daemon start command failed', error);
    
    if (error instanceof Error) {
      if (error.message.includes('already running')) {
        console.error(chalk.yellow('\n⚠ Daemon is already running'));
        console.log(chalk.gray('Check status with: claudeflow daemon status'));
      } else if (error.message.includes('not found')) {
        console.error(chalk.red('\n✗ ClaudeFlow server not found'));
        console.log(chalk.gray('Build the project first with: npm run build'));
      } else {
        console.error(chalk.red('\n✗ Error:'), error.message);
      }
    }
    
    process.exit(1);
  }
}

/**
 * Daemon stop command
 */
export async function daemonStopCommand(): Promise<void> {
  try {
    logger.info('Starting daemon stop command');

    // Initialize services
    const configDir = join(homedir(), '.claudeflow');
    const daemonService = new DaemonService(undefined, configDir);

    // Stop daemon
    const spinner = ora('Stopping ClaudeFlow daemon...').start();

    try {
      await daemonService.stop();
      spinner.succeed('Daemon stopped successfully!');

      console.log(chalk.green('\n✓ ClaudeFlow daemon has been stopped'));

      logger.info('Daemon stop command completed successfully');
    } catch (error) {
      spinner.fail('Failed to stop daemon');
      throw error;
    }
  } catch (error) {
    logger.error('Daemon stop command failed', error);
    
    if (error instanceof Error) {
      if (error.message.includes('not running')) {
        console.error(chalk.yellow('\n⚠ Daemon is not running'));
      } else {
        console.error(chalk.red('\n✗ Error:'), error.message);
      }
    }
    
    process.exit(1);
  }
}

/**
 * Daemon restart command
 */
export async function daemonRestartCommand(): Promise<void> {
  try {
    logger.info('Starting daemon restart command');

    // Initialize services
    const configManager = new ConfigurationManager();
    const configPath = process.env.CLAUDEFLOW_CONFIG || join(homedir(), '.claudeflow', 'config.json');
    await configManager.loadConfig(configPath);

    const config = configManager.getConfig();
    const configDir = join(homedir(), '.claudeflow');

    const daemonService = new DaemonService(undefined, configDir);

    // Restart daemon
    const spinner = ora('Restarting ClaudeFlow daemon...').start();

    try {
      await daemonService.restart();
      spinner.succeed('Daemon restarted successfully!');

      // Wait a moment for daemon to initialize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get status
      const status = await daemonService.status();

      console.log(chalk.green('\n✓ ClaudeFlow daemon has been restarted'));
      console.log(chalk.blue('\nDaemon Status:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('PID:')} ${status.pid || 'N/A'}`);
      console.log(`${chalk.bold('Status:')} ${chalk.green(status.status || 'online')}`);
      console.log(`${chalk.bold('Port:')} ${config.server.port}`);
      console.log(chalk.gray('─'.repeat(50)));

      logger.info('Daemon restart command completed successfully');
    } catch (error) {
      spinner.fail('Failed to restart daemon');
      throw error;
    }
  } catch (error) {
    logger.error('Daemon restart command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Daemon status command
 */
export async function daemonStatusCommand(): Promise<void> {
  try {
    logger.info('Starting daemon status command');

    // Initialize services
    const configManager = new ConfigurationManager();
    const configPath = process.env.CLAUDEFLOW_CONFIG || join(homedir(), '.claudeflow', 'config.json');
    await configManager.loadConfig(configPath);

    const config = configManager.getConfig();
    const configDir = join(homedir(), '.claudeflow');

    const daemonService = new DaemonService(undefined, configDir);

    // Get status
    const status = await daemonService.status();

    if (!status.isRunning) {
      console.log(chalk.yellow('\n⚠ ClaudeFlow daemon is not running'));
      console.log(chalk.gray('Start the daemon with: claudeflow daemon start'));
      return;
    }

    // Create status table
    const table = new Table({
      head: [chalk.cyan('Property'), chalk.cyan('Value')],
      colWidths: [20, 40],
    });

    table.push(
      ['Status', chalk.green('● Running')],
      ['PID', status.pid?.toString() || 'N/A'],
      ['Uptime', status.uptime ? formatUptime(status.uptime) : 'N/A'],
      ['Memory Usage', status.memoryUsage ? formatBytes(status.memoryUsage) : 'N/A'],
      ['Port', config.server.port.toString()],
      ['Host', config.server.host],
      ['Log Level', config.server.logLevel],
      ['Auto Restart', 'Enabled']
    );

    console.log(chalk.blue.bold('\n📊 Daemon Status\n'));
    console.log(table.toString());

    // Check auto-start status
    const autoStartEnabled = await daemonService.isAutoStartEnabled();
    console.log(chalk.bold('\nAuto-start on boot:'), autoStartEnabled ? chalk.green('Enabled') : chalk.gray('Disabled'));

    if (!autoStartEnabled) {
      console.log(chalk.gray('Enable with: claudeflow autostart enable'));
    }

    logger.info('Daemon status command completed successfully');
  } catch (error) {
    logger.error('Daemon status command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
