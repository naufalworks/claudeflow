#!/usr/bin/env node

/**
 * ClaudeFlow CLI Entry Point
 * 
 * Command-line interface for managing ClaudeFlow instances
 */

import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

/**
 * CLI Version
 */
const CLI_VERSION = '0.1.0';

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Set up program metadata
    program
      .name('claudeflow')
      .description('Intelligent API router for Anthropic Claude models')
      .version(CLI_VERSION, '-v, --version', 'Display CLI version')
      .helpOption('-h, --help', 'Display help information');

    // Global options
    program
      .option('--debug', 'Enable debug mode')
      .option('--profile <name>', 'Use specific configuration profile');

    // Setup commands (will be added in later tasks)
    await setupCommands(program);

    // Parse arguments
    await program.parseAsync(process.argv);

    // Show help if no command provided
    if (!process.argv.slice(2).length) {
      program.outputHelp();
    }
  } catch (error) {
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Setup all CLI commands
 */
async function setupCommands(program: Command): Promise<void> {
  // Import commands dynamically using ES module imports
  const commands = await import('../commands/index.js');
  
  const {
    loginEnhancedCommand,
    tokenExportCommand,
    tokenImportCommand,
    accountRemoveCommand,
    accountListCommand,
    accountRefreshCommand,
    accountTestCommand,
    accountSetPriorityCommand,
    anthropicAddCommand,
    proxyAddCommand,
    comboCreateCommand,
    comboListCommand,
    comboShowCommand,
    comboDeleteCommand,
    comboAddAccountCommand,
    comboRemoveAccountCommand,
    daemonStartCommand,
    daemonStopCommand,
    daemonRestartCommand,
    daemonStatusCommand,
    autostartEnableCommand,
    autostartDisableCommand,
    autostartStatusCommand,
    logsCommand,
    healthCheckCommand,
    healthTestCommand,
    quotaShowCommand,
    quotaWatchCommand,
    analyticsShowCommand,
    analyticsExportCommand,
    configShowCommand,
    configSetCommand,
    configResetCommand,
    profileCreateCommand,
    profileListCommand,
    profileSwitchCommand,
    profileDeleteCommand,
    backupCreateCommand,
    backupListCommand,
    backupRestoreCommand,
    backupExportCommand,
    backupImportCommand,
    setupCommand,
    sessionStatusCommand,
    migrateCommand,
    mitmInstallCommand,
    mitmUninstallCommand,
    mitmStartCommand,
    mitmStopCommand,
    mitmStatusCommand,
  } = commands;

  // Login command (enhanced with multiple methods)
  program
    .command('login')
    .description('Login to Kiro account (Builder ID, SSO, Token Import)')
    .option('--method <method>', 'Login method: builder-id, sso, token-import, manual-token')
    .option('--region <region>', 'AWS region')
    .option('--start-url <url>', 'AWS SSO start URL (for custom IDC)')
    .option('--token <token>', 'Access token for non-interactive login')
    .option('--sso-url <url>', 'SSO URL for enterprise login')
    .action(async (options) => {
      try {
        await loginEnhancedCommand(options);
      } catch (error) {
        console.error(chalk.red('✗ Login failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Token command with subcommands
  const tokenCmd = program
    .command('token')
    .description('Export and import Kiro tokens');

  tokenCmd
    .command('export <accountId>')
    .description('Export Kiro session token')
    .option('--output <file>', 'Output file path')
    .option('--json', 'Output as JSON')
    .action(async (accountId: string, options) => {
      try {
        await tokenExportCommand(accountId, options);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  tokenCmd
    .command('import')
    .description('Import Kiro session token')
    .option('--input <file>', 'Input file path')
    .option('--json <data>', 'JSON data string')
    .action(async (options) => {
      try {
        await tokenImportCommand(options);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Account command with subcommands
  const accountCmd = program
    .command('account')
    .description('Manage Kiro accounts');

  accountCmd
    .command('list')
    .description('List all Kiro accounts')
    .option('--json', 'Output in JSON format')
    .action(async (options) => {
      try {
        await accountListCommand(options);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  accountCmd
    .command('remove <accountId>')
    .description('Remove a Kiro account')
    .action(async (accountId: string) => {
      try {
        await accountRemoveCommand(accountId);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  accountCmd
    .command('refresh <accountId>')
    .description('Manually refresh account token')
    .action(async (accountId: string) => {
      try {
        await accountRefreshCommand(accountId);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  accountCmd
    .command('test <accountId>')
    .description('Test account connectivity')
    .action(async (accountId: string) => {
      try {
        await accountTestCommand(accountId);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  accountCmd
    .command('set-priority <accountId> <priority>')
    .description('Set account routing priority (0-100)')
    .action(async (accountId: string, priority: string) => {
      try {
        await accountSetPriorityCommand(accountId, parseInt(priority, 10));
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Add Anthropic account command
  program
    .command('add-anthropic')
    .description('Add direct Anthropic API account (RECOMMENDED)')
    .option('--api-key <key>', 'Anthropic API key (sk-ant-...)')
    .option('--skip-validation', 'Skip API key validation')
    .action(async (options) => {
      try {
        await anthropicAddCommand(options);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Add proxy account command
  program
    .command('add-proxy')
    .description('Add Anthropic-compatible proxy (MITM only, NOT 9router)')
    .option('--base-url <url>', 'Proxy base URL')
    .option('--api-key <key>', 'Proxy API key')
    .option('--skip-validation', 'Skip proxy validation (not recommended)')
    .action(async (options) => {
      try {
        await proxyAddCommand(options);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Combo command with subcommands
  const comboCmd = program
    .command('combo')
    .description('Manage account combos');

  comboCmd
    .command('create')
    .description('Create a new combo')
    .action(async () => {
      try {
        await comboCreateCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  comboCmd
    .command('list')
    .description('List all combos')
    .action(async () => {
      try {
        await comboListCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  comboCmd
    .command('show <comboName>')
    .description('Show detailed combo information')
    .action(async (comboName: string) => {
      try {
        await comboShowCommand(comboName);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  comboCmd
    .command('delete <comboName>')
    .description('Delete a combo')
    .action(async (comboName: string) => {
      try {
        await comboDeleteCommand(comboName);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  comboCmd
    .command('add-account <comboName> <accountId>')
    .description('Add an account to a combo')
    .action(async (comboName: string, accountId: string) => {
      try {
        await comboAddAccountCommand(comboName, accountId);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  comboCmd
    .command('remove-account <comboName> <accountId>')
    .description('Remove an account from a combo')
    .action(async (comboName: string, accountId: string) => {
      try {
        await comboRemoveAccountCommand(comboName, accountId);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Daemon command with subcommands
  const daemonCmd = program
    .command('daemon')
    .description('Manage ClaudeFlow daemon');

  daemonCmd
    .command('start')
    .description('Start ClaudeFlow daemon')
    .option('--mitm', 'Start with MITM proxy on port 443')
    .action(async (options) => {
      try {
        await daemonStartCommand(options);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  daemonCmd
    .command('stop')
    .description('Stop ClaudeFlow daemon')
    .action(async () => {
      try {
        await daemonStopCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  daemonCmd
    .command('restart')
    .description('Restart ClaudeFlow daemon')
    .action(async () => {
      try {
        await daemonRestartCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  daemonCmd
    .command('status')
    .description('Show daemon status')
    .action(async () => {
      try {
        await daemonStatusCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Autostart command with subcommands
  const autostartCmd = program
    .command('autostart')
    .description('Manage daemon auto-start on system boot');

  autostartCmd
    .command('enable')
    .description('Enable auto-start on system boot')
    .action(async () => {
      try {
        await autostartEnableCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  autostartCmd
    .command('disable')
    .description('Disable auto-start on system boot')
    .action(async () => {
      try {
        await autostartDisableCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  autostartCmd
    .command('status')
    .description('Check auto-start status')
    .action(async () => {
      try {
        await autostartStatusCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Logs command
  program
    .command('logs')
    .description('View daemon logs')
    .option('-f, --follow', 'Follow log output in real-time')
    .option('-n, --lines <number>', 'Number of lines to display', '50')
    .option('-l, --level <level>', 'Filter by log level (debug, info, warn, error)')
    .option('--clear', 'Clear all logs')
    .action(async (options) => {
      try {
        const lines = parseInt(options.lines, 10);
        await logsCommand({
          follow: options.follow,
          lines: isNaN(lines) ? 50 : lines,
          level: options.level,
          clear: options.clear,
        });
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Health command with subcommands
  const healthCmd = program
    .command('health')
    .description('Check system health');

  healthCmd
    .command('check')
    .description('Check health of all components')
    .action(async () => {
      try {
        await healthCheckCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  healthCmd
    .command('test')
    .description('Run end-to-end test')
    .action(async () => {
      try {
        await healthTestCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Make 'health' without subcommand default to 'check'
  healthCmd.action(async () => {
    try {
      await healthCheckCommand();
    } catch (error) {
      console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

  // Quota command with subcommands
  const quotaCmd = program
    .command('quota')
    .description('View quota usage');

  quotaCmd
    .command('show')
    .description('Show current quota usage')
    .option('-a, --account <accountId>', 'Show quota for specific account')
    .action(async (options) => {
      try {
        await quotaShowCommand({ account: options.account });
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  quotaCmd
    .command('watch')
    .description('Watch quota usage in real-time')
    .option('-a, --account <accountId>', 'Watch quota for specific account')
    .action(async (options) => {
      try {
        await quotaWatchCommand({ account: options.account });
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Make 'quota' without subcommand default to 'show'
  quotaCmd.action(async () => {
    try {
      await quotaShowCommand({});
    } catch (error) {
      console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

  // Analytics command with subcommands
  const analyticsCmd = program
    .command('analytics')
    .description('View analytics and metrics');

  analyticsCmd
    .command('show')
    .description('Show analytics report')
    .option('-d, --detailed', 'Show detailed metrics')
    .option('-r, --range <range>', 'Time range (24h, 7d, 30d)', '24h')
    .action(async (options) => {
      try {
        await analyticsShowCommand({
          detailed: options.detailed,
          range: options.range,
        });
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  analyticsCmd
    .command('export')
    .description('Export analytics data')
    .requiredOption('-f, --format <format>', 'Export format (json, csv)')
    .requiredOption('-o, --output <path>', 'Output file path')
    .option('-r, --range <range>', 'Time range (24h, 7d, 30d)', '24h')
    .action(async (options) => {
      try {
        await analyticsExportCommand({
          format: options.format,
          output: options.output,
          range: options.range,
        });
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Make 'analytics' without subcommand default to 'show'
  analyticsCmd.action(async () => {
    try {
      await analyticsShowCommand({});
    } catch (error) {
      console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

  // Config command with subcommands
  const configCmd = program
    .command('config')
    .description('Manage configuration');

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      try {
        await configShowCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  configCmd
    .command('set <key> <value>')
    .description('Set configuration value')
    .action(async (key: string, value: string) => {
      try {
        await configSetCommand(key, value);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  configCmd
    .command('reset')
    .description('Reset configuration to defaults')
    .action(async () => {
      try {
        await configResetCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Make 'config' without subcommand default to 'show'
  configCmd.action(async () => {
    try {
      await configShowCommand();
    } catch (error) {
      console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

  // Profile command with subcommands
  const profileCmd = program
    .command('profile')
    .description('Manage configuration profiles');

  profileCmd
    .command('create <name>')
    .description('Create a new profile')
    .action(async (name: string) => {
      try {
        await profileCreateCommand(name);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  profileCmd
    .command('list')
    .description('List all profiles')
    .action(async () => {
      try {
        await profileListCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  profileCmd
    .command('switch <name>')
    .description('Switch to a different profile')
    .action(async (name: string) => {
      try {
        await profileSwitchCommand(name);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  profileCmd
    .command('delete <name>')
    .description('Delete a profile')
    .action(async (name: string) => {
      try {
        await profileDeleteCommand(name);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Make 'profile' without subcommand default to 'list'
  profileCmd.action(async () => {
    try {
      await profileListCommand();
    } catch (error) {
      console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

  // Backup command with subcommands
  const backupCmd = program
    .command('backup')
    .description('Manage configuration backups');

  backupCmd
    .command('create')
    .description('Create a new backup')
    .action(async () => {
      try {
        await backupCreateCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  backupCmd
    .command('list')
    .description('List all backups')
    .action(async () => {
      try {
        await backupListCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  backupCmd
    .command('restore <timestamp>')
    .description('Restore from a backup')
    .action(async (timestamp: string) => {
      try {
        await backupRestoreCommand(timestamp);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  backupCmd
    .command('export <timestamp> <output>')
    .description('Export a backup to a file')
    .action(async (timestamp: string, output: string) => {
      try {
        await backupExportCommand(timestamp, output);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  backupCmd
    .command('import <input>')
    .description('Import a backup from a file')
    .action(async (input: string) => {
      try {
        await backupImportCommand(input);
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Make 'backup' without subcommand default to 'list'
  backupCmd.action(async () => {
    try {
      await backupListCommand();
    } catch (error) {
      console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

  // Version command
  program
    .command('version')
    .description('Display ClaudeFlow CLI version')
    .action(() => {
      console.log(chalk.blue('ClaudeFlow CLI'), chalk.gray(`v${CLI_VERSION}`));
      console.log(chalk.gray('Intelligent API router for Anthropic Claude models'));
    });

  // Setup command
  program
    .command('setup')
    .description('Interactive setup wizard for first-time configuration')
    .action(async () => {
      try {
        await setupCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Session command
  program
    .command('session')
    .description('Display session status for all accounts')
    .action(async () => {
      try {
        await sessionStatusCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Migrate command with subcommands
  const migrateCmd = program
    .command('migrate')
    .description('Migrate from old authentication systems');

  migrateCmd
    .command('from-9router')
    .description('Migrate from 9router to Kiro OAuth')
    .action(async () => {
      try {
        await migrateCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // MITM command with subcommands
  const mitmCmd = program
    .command('mitm')
    .description('Manage MITM proxy for intercepting Kiro CLI/IDE');

  mitmCmd
    .command('install')
    .description('Install MITM proxy (CA certificate + hosts file)')
    .action(async () => {
      try {
        await mitmInstallCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  mitmCmd
    .command('uninstall')
    .description('Uninstall MITM proxy (remove CA + restore hosts)')
    .action(async () => {
      try {
        await mitmUninstallCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  mitmCmd
    .command('start')
    .description('Start MITM proxy server on port 443')
    .action(async () => {
      try {
        await mitmStartCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  mitmCmd
    .command('stop')
    .description('Stop MITM proxy server')
    .action(async () => {
      try {
        await mitmStopCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  mitmCmd
    .command('status')
    .description('Check MITM proxy status')
    .action(async () => {
      try {
        await mitmStatusCommand();
      } catch (error) {
        console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Make 'mitm' without subcommand default to 'status'
  mitmCmd.action(async () => {
    try {
      await mitmStatusCommand();
    } catch (error) {
      console.error(chalk.red('✗ Command failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
}



// Run main function
main().catch((error) => {
  console.error(chalk.red('✗ Fatal error:'), error);
  process.exit(1);
});
