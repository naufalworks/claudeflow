/**
 * Config Command
 * 
 * Manage ClaudeFlow configuration
 */

import chalk from 'chalk';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';
import inquirer from 'inquirer';

/**
 * Config show command
 */
export async function configShowCommand(): Promise<void> {
  try {
    logger.info('Starting config show command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Display configuration
    console.log(chalk.blue.bold('\n⚙️  Configuration\n'));
    console.log(chalk.gray('─'.repeat(60)));

    // Mask sensitive data
    const displayConfig = JSON.parse(JSON.stringify(config));
    
    // Mask API keys
    if (displayConfig.infrastructure.voyageApiKey) {
      const key = displayConfig.infrastructure.voyageApiKey;
      displayConfig.infrastructure.voyageApiKey = key.length > 8
        ? `${key.substring(0, 4)}****${key.substring(key.length - 4)}`
        : '****';
    }

    // Mask account API keys
    for (const account of displayConfig.accounts) {
      if (account.apiKey) {
        const key = account.apiKey;
        account.apiKey = key.length > 8
          ? `${key.substring(0, 4)}****${key.substring(key.length - 4)}`
          : '****';
      }
      if (account.sessionToken) {
        account.sessionToken = '****';
      }
    }

    console.log(JSON.stringify(displayConfig, null, 2));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.gray('\nConfiguration file:'), configService.getConfigPath());
    console.log(chalk.gray('Active profile:'), config.activeProfile);

    logger.info('Config show command completed successfully');
  } catch (error) {
    logger.error('Config show command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Config set command
 */
export async function configSetCommand(key: string, value: string): Promise<void> {
  try {
    logger.info('Starting config set command', { key });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Parse the key path (e.g., "daemon.port" -> ["daemon", "port"])
    const keyParts = key.split('.');

    if (keyParts.length === 0) {
      throw new Error('Invalid key format. Use dot notation (e.g., daemon.port)');
    }

    // Get current config
    const config = await configService.getConfig();

    // Navigate to the nested property
    let current: any = config;
    for (let i = 0; i < keyParts.length - 1; i++) {
      if (!(keyParts[i] in current)) {
        throw new Error(`Invalid key path: ${keyParts.slice(0, i + 1).join('.')}`);
      }
      current = current[keyParts[i]];
    }

    const finalKey = keyParts[keyParts.length - 1];

    if (!(finalKey in current)) {
      throw new Error(`Invalid key: ${key}`);
    }

    // Parse value based on current type
    let parsedValue: any = value;
    const currentValue = current[finalKey];

    if (typeof currentValue === 'number') {
      parsedValue = parseFloat(value);
      if (isNaN(parsedValue)) {
        throw new Error(`Value must be a number for key: ${key}`);
      }
    } else if (typeof currentValue === 'boolean') {
      parsedValue = value.toLowerCase() === 'true';
    }

    // Set the value
    current[finalKey] = parsedValue;

    // Save configuration
    await configService.save(config);

    console.log(chalk.green('\n✓ Configuration updated'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.bold(key)}: ${chalk.cyan(String(parsedValue))}`);
    console.log(chalk.gray('─'.repeat(60)));

    logger.info('Config set command completed successfully', { key, value: parsedValue });
  } catch (error) {
    logger.error('Config set command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Config reset command
 */
export async function configResetCommand(): Promise<void> {
  try {
    logger.info('Starting config reset command');

    // Confirm with user
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to reset configuration to defaults? This cannot be undone.',
        default: false,
      },
    ]);

    if (!answers.confirm) {
      console.log(chalk.yellow('\n⚠ Reset cancelled'));
      return;
    }

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Reset configuration
    await configService.reset();

    console.log(chalk.green('\n✓ Configuration reset to defaults'));
    console.log(chalk.gray('\nYou may need to reconfigure:'));
    console.log(chalk.gray('  • Accounts (claudeflow account add)'));
    console.log(chalk.gray('  • Infrastructure URLs (claudeflow config set)'));
    console.log(chalk.gray('  • Daemon settings (claudeflow config set)'));

    logger.info('Config reset command completed successfully');
  } catch (error) {
    logger.error('Config reset command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
