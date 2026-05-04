/**
 * Combo Command
 * 
 * Manage Kiro account combos (create/list/show/delete/add-account/remove-account)
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import Table from 'cli-table3';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';
import type { KiroComboConfig } from '../types/cli.types.js';

/**
 * Combo create command
 */
export async function comboCreateCommand(): Promise<void> {
  try {
    logger.info('Starting combo create command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    if (config.accounts.length === 0) {
      console.error(chalk.red('✗ No accounts configured'));
      console.log(chalk.gray('Add an account first with: claudeflow account add'));
      process.exit(1);
    }

    // Prompt for combo details
    console.log(chalk.blue.bold('\n➕ Create Combo\n'));
    console.log(chalk.gray('A combo groups multiple accounts for load balancing.\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Combo name:',
        validate: (input: string) => {
          if (!input || input.trim().length === 0) {
            return 'Combo name is required';
          }
          if (input.length < 2) {
            return 'Combo name must be at least 2 characters';
          }
          // Check if combo already exists
          if (config.combos.some((c) => c.name === input.trim())) {
            return `Combo '${input.trim()}' already exists`;
          }
          return true;
        },
      },
      {
        type: 'checkbox',
        name: 'accounts',
        message: 'Select accounts to include:',
        choices: config.accounts.map((account) => {
          const displayName = account.provider === 'kiro' 
            ? `${account.id} (${account.kiroConfig.machineId})`
            : `${account.id} (${account.provider})`;
          return {
            name: displayName,
            value: account.id,
          };
        }),
        validate: (input: string[]) => {
          if (input.length === 0) {
            return 'Select at least one account';
          }
          return true;
        },
      },
      {
        type: 'list',
        name: 'strategy',
        message: 'Load balancing strategy:',
        choices: [
          {
            name: 'Round Robin - Rotate through accounts sequentially',
            value: 'round-robin',
          },
          {
            name: 'Sticky Round Robin - Consistent account per conversation',
            value: 'sticky-round-robin',
          },
        ],
        default: 'round-robin',
      },
    ]);

    // Create combo
    const combo: KiroComboConfig = {
      name: answers.name.trim(),
      accounts: answers.accounts,
      strategy: answers.strategy,
      currentIndex: 0,
    };

    await configService.addCombo(combo);

    console.log(chalk.green('\n✓ Combo created successfully!'));
    console.log(chalk.blue('\nCombo Details:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`${chalk.bold('Name:')} ${combo.name}`);
    console.log(`${chalk.bold('Strategy:')} ${combo.strategy}`);
    console.log(`${chalk.bold('Accounts:')} ${combo.accounts.length}`);
    combo.accounts.forEach((accountId, index) => {
      console.log(`  ${index + 1}. ${accountId}`);
    });
    console.log(chalk.gray('─'.repeat(50)));

    logger.info('Combo create command completed successfully', { comboName: combo.name });
  } catch (error) {
    logger.error('Combo create command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Combo list command
 */
export async function comboListCommand(): Promise<void> {
  try {
    logger.info('Starting combo list command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    if (config.combos.length === 0) {
      console.log(chalk.yellow('\nNo combos configured'));
      console.log(chalk.gray('Create a combo with: claudeflow combo create'));
      return;
    }

    // Create table
    const table = new Table({
      head: [
        chalk.cyan('Combo Name'),
        chalk.cyan('Strategy'),
        chalk.cyan('Accounts'),
        chalk.cyan('Current Index'),
      ],
      colWidths: [25, 25, 15, 18],
    });

    // Add rows
    for (const combo of config.combos) {
      const strategyText = combo.strategy === 'round-robin'
        ? 'Round Robin'
        : 'Sticky Round Robin';

      table.push([
        combo.name,
        strategyText,
        combo.accounts.length.toString(),
        combo.currentIndex.toString(),
      ]);
    }

    console.log(chalk.blue.bold('\n📋 Kiro Combos\n'));
    console.log(table.toString());
    console.log(chalk.gray(`\nTotal: ${config.combos.length} combo(s)`));

    logger.info('Combo list command completed successfully');
  } catch (error) {
    logger.error('Combo list command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Combo show command
 */
export async function comboShowCommand(comboName: string): Promise<void> {
  try {
    logger.info('Starting combo show command', { comboName });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Find combo
    const combo = config.combos.find((c) => c.name === comboName);
    if (!combo) {
      console.error(chalk.red(`✗ Combo '${comboName}' not found`));
      process.exit(1);
    }

    // Display combo details
    console.log(chalk.blue.bold(`\n📄 Combo Details: ${comboName}\n`));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.bold('Configuration:'));
    console.log(`  Name:           ${combo.name}`);
    console.log(`  Strategy:       ${combo.strategy === 'round-robin' ? 'Round Robin' : 'Sticky Round Robin'}`);
    console.log(`  Current Index:  ${combo.currentIndex}`);
    console.log(`  Account Count:  ${combo.accounts.length}`);

    console.log(chalk.bold('\nAccounts:'));
    combo.accounts.forEach((accountId, index) => {
      const account = config.accounts.find((a) => a.id === accountId);
      const isCurrent = index === combo.currentIndex;
      const marker = isCurrent ? chalk.green('→') : ' ';
      let accountInfo: string;
      if (account) {
        if (account.provider === 'kiro') {
          accountInfo = `${accountId} (${account.kiroConfig.machineId})`;
        } else {
          accountInfo = `${accountId} (${account.provider})`;
        }
      } else {
        accountInfo = `${accountId} ${chalk.red('(not found)')}`;
      }
      console.log(`  ${marker} ${index + 1}. ${accountInfo}`);
    });

    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.bold('\nStrategy Explanation:'));
    if (combo.strategy === 'round-robin') {
      console.log(chalk.gray('  Round Robin: Requests are distributed sequentially across all accounts.'));
      console.log(chalk.gray('  Each request uses the next account in the list.'));
    } else {
      console.log(chalk.gray('  Sticky Round Robin: Requests with the same conversation ID use the same account.'));
      console.log(chalk.gray('  Different conversations are distributed across accounts.'));
    }

    logger.info('Combo show command completed successfully', { comboName });
  } catch (error) {
    logger.error('Combo show command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Combo delete command
 */
export async function comboDeleteCommand(comboName: string): Promise<void> {
  try {
    logger.info('Starting combo delete command', { comboName });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Check if combo exists
    const combo = await configService.getCombo(comboName);
    if (!combo) {
      console.error(chalk.red(`✗ Combo '${comboName}' not found`));
      process.exit(1);
    }

    // Confirm deletion
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete combo '${comboName}'?`,
        default: false,
      },
    ]);

    if (!answers.confirm) {
      console.log(chalk.yellow('✗ Combo deletion cancelled'));
      return;
    }

    // Delete combo
    await configService.removeCombo(comboName);

    console.log(chalk.green(`✓ Combo '${comboName}' deleted successfully`));
    logger.info('Combo delete command completed successfully', { comboName });
  } catch (error) {
    logger.error('Combo delete command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Combo add-account command
 */
export async function comboAddAccountCommand(comboName: string, accountId: string): Promise<void> {
  try {
    logger.info('Starting combo add-account command', { comboName, accountId });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();

    // Check if combo exists
    const combo = await configService.getCombo(comboName);
    if (!combo) {
      console.error(chalk.red(`✗ Combo '${comboName}' not found`));
      process.exit(1);
    }

    // Check if account exists
    const account = config.accounts.find((a) => a.id === accountId);
    if (!account) {
      console.error(chalk.red(`✗ Account '${accountId}' not found`));
      process.exit(1);
    }

    // Check if account is already in combo
    if (combo.accounts.includes(accountId)) {
      console.error(chalk.yellow(`⚠ Account '${accountId}' is already in combo '${comboName}'`));
      process.exit(1);
    }

    // Add account to combo
    combo.accounts.push(accountId);
    await configService.updateCombo(comboName, { accounts: combo.accounts });

    console.log(chalk.green(`✓ Account '${accountId}' added to combo '${comboName}'`));
    console.log(chalk.gray(`Total accounts in combo: ${combo.accounts.length}`));

    logger.info('Combo add-account command completed successfully', { comboName, accountId });
  } catch (error) {
    logger.error('Combo add-account command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Combo remove-account command
 */
export async function comboRemoveAccountCommand(comboName: string, accountId: string): Promise<void> {
  try {
    logger.info('Starting combo remove-account command', { comboName, accountId });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Check if combo exists
    const combo = await configService.getCombo(comboName);
    if (!combo) {
      console.error(chalk.red(`✗ Combo '${comboName}' not found`));
      process.exit(1);
    }

    // Check if account is in combo
    if (!combo.accounts.includes(accountId)) {
      console.error(chalk.yellow(`⚠ Account '${accountId}' is not in combo '${comboName}'`));
      process.exit(1);
    }

    // Check if this is the last account
    if (combo.accounts.length === 1) {
      console.error(chalk.red(`✗ Cannot remove last account from combo '${comboName}'`));
      console.log(chalk.gray('Delete the combo instead with: claudeflow combo delete ' + comboName));
      process.exit(1);
    }

    // Remove account from combo
    const updatedAccounts = combo.accounts.filter((id) => id !== accountId);
    await configService.updateCombo(comboName, { accounts: updatedAccounts });

    console.log(chalk.green(`✓ Account '${accountId}' removed from combo '${comboName}'`));
    console.log(chalk.gray(`Remaining accounts in combo: ${updatedAccounts.length}`));

    logger.info('Combo remove-account command completed successfully', { comboName, accountId });
  } catch (error) {
    logger.error('Combo remove-account command failed', error);
    console.error(chalk.red('✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
