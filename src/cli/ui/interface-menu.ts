/**
 * Interface Menu (9router-style)
 *
 * Starts server in background, then shows interactive menu
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import figlet from 'figlet';
import ora from 'ora';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import open from 'open';
import { daemonStartCommand } from '../commands/daemon.js';

let serverProcess: ChildProcess | null = null;
let webProcess: ChildProcess | null = null;
let serverPort = 20129;
let webPort = 3001;

/**
 * Start server in background (non-daemon mode)
 */
async function startServer(): Promise<void> {
  const spinner = ora('Starting ClaudeFlow services...').start();

  try {
    // Start API server
    const scriptPath = join(process.cwd(), 'dist', 'index.js');
    serverProcess = spawn('node', [scriptPath], {
      detached: false,
      stdio: 'ignore',
      env: { ...process.env },
    });

    spinner.text = 'Starting API server...';
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if API server is responding
    const apiResponse = await fetch(`http://localhost:${serverPort}/health`).catch(() => null);
    if (!apiResponse?.ok) {
      spinner.warn('API server started but health check failed');
    }

    // Start Web UI
    spinner.text = 'Starting Web UI...';
    const webPath = join(process.cwd(), 'web');
    webProcess = spawn('npm', ['run', 'dev'], {
      detached: false,
      stdio: 'ignore',
      cwd: webPath,
      env: { ...process.env },
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    spinner.succeed('Services started successfully!');
    console.log(chalk.gray(`  • API: http://localhost:${serverPort}`));
    console.log(chalk.gray(`  • Web UI: http://localhost:${webPort}`));
  } catch (error) {
    spinner.fail('Failed to start services');
    throw error;
  }
}

/**
 * Stop server
 */
function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (webProcess) {
    webProcess.kill();
    webProcess = null;
  }
}

/**
 * Show interface menu
 */
async function showInterfaceMenu(): Promise<void> {
  while (true) {
    console.log('\n');
    console.log(chalk.cyan('═'.repeat(50)));
    console.log(chalk.bold(`  ClaudeFlow v0.1.0`));
    console.log(chalk.green(`  🚀 API: http://localhost:${serverPort}`));
    console.log(chalk.green(`  🌐 Web UI: http://localhost:${webPort}`));
    console.log(chalk.cyan('═'.repeat(50)));
    console.log('');
    console.log('  1. 🌐 Web UI (Open in Browser)');
    console.log('  2. 💻 Terminal UI (Interactive CLI)');
    console.log('  3. 🔔 Hide to Background (Daemon)');
    console.log('  4. 🚪 Exit');
    console.log('');

    const { choice } = await inquirer.prompt([
      {
        type: 'input',
        name: 'choice',
        message: 'Select option (1-4):',
        validate: (input: string) => {
          const num = parseInt(input);
          if (isNaN(num) || num < 1 || num > 4) {
            return 'Please enter a number between 1 and 4';
          }
          return true;
        },
      },
    ]);

    const action = parseInt(choice);

    switch (action) {
      case 1:
        await handleWebUI();
        break;
      case 2:
        await handleTerminalUI();
        break;
      case 3:
        await handleBackground();
        return; // Exit after going to background
      case 4:
        await handleExit();
        return;
    }
  }
}

/**
 * Handle Web UI option
 */
async function handleWebUI(): Promise<void> {
  console.log(chalk.blue('\n🌐 Opening Web UI in browser...\n'));

  try {
    await open(`http://localhost:${webPort}`);
    console.log(chalk.green('✓ Browser opened!'));
    console.log(chalk.gray(`Web UI: http://localhost:${webPort}`));
    console.log(chalk.gray(`API: http://localhost:${serverPort}`));
  } catch (error) {
    console.log(chalk.yellow('⚠ Could not open browser automatically'));
    console.log(chalk.gray(`Please open: http://localhost:${webPort}`));
  }

  // Wait for user to press Enter
  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: 'Press Enter to return to menu...',
    },
  ]);
}

/**
 * Handle Terminal UI option
 */
async function handleTerminalUI(): Promise<void> {
  console.log(chalk.blue('\n💻 Terminal UI\n'));

  const { submenu } = await inquirer.prompt([
    {
      type: 'list',
      name: 'submenu',
      message: 'Select an option:',
      choices: [
        { name: '📋 Accounts - Manage accounts', value: 'accounts' },
        { name: '🔐 Login - Add Kiro account', value: 'login' },
        { name: '🚀 Daemon - Manage daemon', value: 'daemon' },
        { name: '🔒 MITM - Setup proxy', value: 'mitm' },
        { name: '📊 Analytics - View analytics', value: 'analytics' },
        { name: '⚙️  Settings - Configure ClaudeFlow', value: 'settings' },
        new inquirer.Separator(),
        { name: '⬅  Back to Interface Menu', value: 'back' },
      ],
    },
  ]);

  if (submenu === 'back') {
    return;
  }

  // Show command hint
  console.log(chalk.gray(`\nRun: claudeflow ${submenu} --help\n`));

  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: 'Press Enter to return to menu...',
    },
  ]);
}

/**
 * Handle Hide to Background option
 */
async function handleBackground(): Promise<void> {
  console.log(chalk.blue('\n🔔 Hiding to background...\n'));

  // Stop the foreground server
  stopServer();

  // Start daemon
  console.log(chalk.gray('Starting daemon process...\n'));
  await daemonStartCommand();

  console.log(chalk.green('\n✓ ClaudeFlow is now running in background!'));
  console.log(chalk.gray('\nManage daemon:'));
  console.log(chalk.gray('  • Status: claudeflow daemon status'));
  console.log(chalk.gray('  • Logs: claudeflow logs -f'));
  console.log(chalk.gray('  • Stop: claudeflow daemon stop'));
  console.log(chalk.gray('  • Web UI: http://localhost:3001\n'));
}

/**
 * Handle Exit option
 */
async function handleExit(): Promise<void> {
  console.log(chalk.blue('\n🚪 Shutting down...\n'));

  const spinner = ora('Stopping server...').start();
  stopServer();

  // Wait a moment for cleanup
  await new Promise((resolve) => setTimeout(resolve, 1000));

  spinner.succeed('Server stopped');
  console.log(chalk.gray('\nGoodbye! 👋\n'));
}

/**
 * Main entry point - start server and show menu
 */
export async function startServerAndShowMenu(): Promise<void> {
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

  // Start server in background
  await startServer();

  // Show interface menu
  await showInterfaceMenu();

  // Cleanup on exit
  process.on('exit', () => {
    stopServer();
  });

  process.on('SIGINT', () => {
    stopServer();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopServer();
    process.exit(0);
  });
}
