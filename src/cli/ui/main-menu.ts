/**
 * Interactive Main Menu
 *
 * Beautiful interactive menu for ClaudeFlow
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import figlet from 'figlet';
import { daemonStartCommand, daemonStopCommand, daemonRestartCommand, daemonStatusCommand } from '../commands/daemon.js';
import { autostartEnableCommand, autostartDisableCommand, autostartStatusCommand } from '../commands/autostart.js';

async function showDaemonMenu(): Promise<void> {
  const { daemonAction } = await inquirer.prompt([{
    type: 'list',
    name: 'daemonAction',
    message: 'Daemon management:',
    choices: [
      { name: '▶  Start daemon (background)', value: 'start' },
      { name: '⏹  Stop daemon', value: 'stop' },
      { name: '🔄 Restart daemon', value: 'restart' },
      { name: '📊 Status', value: 'status' },
      new inquirer.Separator(),
      { name: '🔁 Enable auto-start on login', value: 'autostart-enable' },
      { name: '⏏  Disable auto-start on login', value: 'autostart-disable' },
      { name: '📋 Auto-start status', value: 'autostart-status' },
      new inquirer.Separator(),
      { name: '⬅  Back', value: 'back' },
    ],
  }]);

  switch (daemonAction) {
    case 'start':
      await daemonStartCommand();
      break;
    case 'stop':
      await daemonStopCommand();
      break;
    case 'restart':
      await daemonRestartCommand();
      break;
    case 'status':
      await daemonStatusCommand();
      break;
    case 'autostart-enable':
      await autostartEnableCommand();
      break;
    case 'autostart-disable':
      await autostartDisableCommand();
      break;
    case 'autostart-status':
      await autostartStatusCommand();
      break;
    case 'back':
      break;
  }
}
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
          name: '🚀 Start in Background - Run as daemon',
          value: 'daemon',
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
          name: '🔒 MITM - Setup proxy for Kiro CLI/IDE',
          value: 'mitm',
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
    case 'login':
      console.log(chalk.blue('\n🔐 Starting login...\n'));
      console.log(chalk.gray('Run: claudeflow login'));
      break;
    case 'accounts':
      console.log(chalk.blue('\n📋 Account management\n'));
      console.log(chalk.gray('Run: claudeflow account list'));
      break;
    case 'daemon':
      await showDaemonMenu();
      break;
    case 'mitm':
      console.log(chalk.blue('\n🔒 MITM proxy\n'));
      console.log(chalk.gray('Run: claudeflow mitm status'));
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
