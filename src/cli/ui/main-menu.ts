/**
 * Interactive Main Menu
 *
 * Beautiful interactive menu for ClaudeFlow
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import figlet from 'figlet';
import { dashboardCommand } from '../commands/dashboard.js';

export async function showMainMenu(): Promise<void> {
  // Show banner
  console.clear();
  console.log(
    chalk.blue(
      figlet.textSync('ClaudeFlow', {
        font: 'Standard',
        horizontalLayout: 'default',
      })
    )
  );
  console.log(chalk.gray('  Intelligent API Router for Claude Models\n'));

  // Show menu
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        {
          name: '📊 Dashboard - View real-time status (Recommended)',
          value: 'dashboard',
        },
        {
          name: '🔐 Login - Add Kiro account',
          value: 'login',
        },
        {
          name: '📋 Accounts - Manage accounts',
          value: 'accounts',
        },
        {
          name: '🚀 Daemon - Start/stop API router',
          value: 'daemon',
        },
        {
          name: '🔒 MITM - Setup proxy for Kiro CLI/IDE',
          value: 'mitm',
        },
        {
          name: '⚙️  Settings - Configure ClaudeFlow',
          value: 'settings',
        },
        {
          name: '❓ Help - View documentation',
          value: 'help',
        },
        {
          name: '🚪 Exit',
          value: 'exit',
        },
      ],
    },
  ]);

  // Handle action
  switch (action) {
    case 'dashboard':
      await dashboardCommand();
      break;
    case 'login':
      console.log(chalk.blue('\n🔐 Starting login...\n'));
      console.log(chalk.gray('Run: claudeflow login'));
      break;
    case 'accounts':
      console.log(chalk.blue('\n📋 Account management\n'));
      console.log(chalk.gray('Run: claudeflow account list'));
      break;
    case 'daemon':
      console.log(chalk.blue('\n🚀 Daemon management\n'));
      console.log(chalk.gray('Run: claudeflow daemon status'));
      break;
    case 'mitm':
      console.log(chalk.blue('\n🔒 MITM proxy\n'));
      console.log(chalk.gray('Run: claudeflow mitm status'));
      break;
    case 'settings':
      console.log(chalk.blue('\n⚙️  Settings\n'));
      console.log(chalk.gray('Run: claudeflow config show'));
      break;
    case 'help':
      console.log(chalk.blue('\n❓ Help\n'));
      console.log(chalk.gray('Run: claudeflow --help'));
      break;
    case 'exit':
      console.log(chalk.gray('\nGoodbye! 👋\n'));
      process.exit(0);
      break;
  }
}
