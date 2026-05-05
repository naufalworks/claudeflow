/**
 * MITM CLI Commands
 *
 * Commands for managing MITM proxy:
 * - install: Setup CA certificate and hosts file
 * - uninstall: Remove CA certificate and restore hosts file
 * - start: Start MITM proxy server
 * - stop: Stop MITM proxy server
 * - status: Check MITM proxy status
 */

import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { CertificateManager } from '../../mitm/certificate-manager.js';
import { HostsManager } from '../../mitm/hosts-manager.js';
import { ProxyServer } from '../../mitm/proxy-server.js';
import { ConfigurationManager } from '../../config/manager.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const MITM_PID_FILE = path.join(os.homedir(), '.claudeflow', 'mitm.pid');

/**
 * MITM install command
 *
 * Setup CA certificate and hosts file for MITM proxy
 */
export async function mitmInstallCommand(): Promise<void> {
  try {
    logger.info('Starting MITM install command');

    const certManager = new CertificateManager();
    const hostsManager = new HostsManager();

    console.log(chalk.blue.bold('\n🔒 ClaudeFlow MITM Proxy Setup\n'));
    console.log(chalk.yellow('⚠️  This will:'));
    console.log(chalk.yellow('  1. Generate a self-signed CA certificate'));
    console.log(chalk.yellow('  2. Install the CA to your system trust store (requires sudo)'));
    console.log(chalk.yellow('  3. Modify /etc/hosts to redirect Kiro domains (requires sudo)'));
    console.log(chalk.yellow('  4. Flush DNS cache\n'));

    // Check if OpenSSL is available
    const spinner = ora('Checking OpenSSL...').start();
    const hasOpenSSL = await certManager.verifyOpenSSL();
    if (!hasOpenSSL) {
      spinner.fail('OpenSSL not found');
      console.error(chalk.red('\n✗ OpenSSL is required but not found'));
      console.log(chalk.gray('\nInstall OpenSSL:'));
      console.log(chalk.gray('  macOS: brew install openssl'));
      console.log(chalk.gray('  Linux: sudo apt-get install openssl'));
      console.log(chalk.gray('  Windows: Download from https://slproweb.com/products/Win32OpenSSL.html'));
      process.exit(1);
    }
    spinner.succeed('OpenSSL found');

    // Check if already installed
    const isCAInstalled = await certManager.isCAInstalled();
    const isHostsInstalled = await hostsManager.isInstalled();

    if (isCAInstalled && isHostsInstalled) {
      console.log(chalk.yellow('\n⚠️  MITM proxy is already installed'));
      console.log(chalk.gray('Run: claudeflow mitm uninstall (to remove)'));
      console.log(chalk.gray('Run: claudeflow mitm start (to start proxy)'));
      return;
    }

    // Generate certificates
    const certSpinner = ora('Generating certificates...').start();
    try {
      const certsExist = await certManager.certificatesExist();
      if (!certsExist) {
        await certManager.generateCertificates();
        certSpinner.succeed('Certificates generated');
      } else {
        certSpinner.succeed('Certificates already exist');
      }
    } catch (error) {
      certSpinner.fail('Failed to generate certificates');
      throw error;
    }

    // Install CA certificate
    if (!isCAInstalled) {
      const caSpinner = ora('Installing CA certificate (requires sudo)...').start();
      try {
        await certManager.installCA();
        caSpinner.succeed('CA certificate installed');
      } catch (error) {
        caSpinner.fail('Failed to install CA certificate');
        throw error;
      }
    } else {
      console.log(chalk.green('✓ CA certificate already installed'));
    }

    // Modify hosts file
    if (!isHostsInstalled) {
      const hostsSpinner = ora('Modifying /etc/hosts (requires sudo)...').start();
      try {
        await hostsManager.install();
        hostsSpinner.succeed('/etc/hosts modified');
      } catch (error) {
        hostsSpinner.fail('Failed to modify /etc/hosts');
        throw error;
      }
    } else {
      console.log(chalk.green('✓ /etc/hosts already modified'));
    }

    // Flush DNS cache
    const dnsSpinner = ora('Flushing DNS cache...').start();
    try {
      await hostsManager.flushDNS();
      dnsSpinner.succeed('DNS cache flushed');
    } catch (error) {
      dnsSpinner.warn('Failed to flush DNS cache (non-critical)');
    }

    console.log(chalk.green('\n✓ MITM proxy installed successfully!\n'));
    console.log(chalk.blue('Next steps:'));
    console.log(chalk.gray('  1. Start the proxy: claudeflow mitm start'));
    console.log(chalk.gray('  2. Or start daemon with MITM: claudeflow daemon start --mitm'));
    console.log(chalk.gray('  3. Use Kiro CLI/IDE normally - requests will be intercepted\n'));

    logger.info('MITM install command completed successfully');
  } catch (error) {
    logger.error('MITM install command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * MITM uninstall command
 *
 * Remove CA certificate and restore hosts file
 */
export async function mitmUninstallCommand(): Promise<void> {
  try {
    logger.info('Starting MITM uninstall command');

    const certManager = new CertificateManager();
    const hostsManager = new HostsManager();

    console.log(chalk.blue.bold('\n🔓 ClaudeFlow MITM Proxy Removal\n'));

    // Check if installed
    const isCAInstalled = await certManager.isCAInstalled();
    const isHostsInstalled = await hostsManager.isInstalled();

    if (!isCAInstalled && !isHostsInstalled) {
      console.log(chalk.yellow('⚠️  MITM proxy is not installed'));
      return;
    }

    // Check if proxy is running
    const isRunning = await isMITMRunning();
    if (isRunning) {
      console.log(chalk.red('\n✗ MITM proxy is currently running'));
      console.log(chalk.gray('Stop it first: claudeflow mitm stop'));
      process.exit(1);
    }

    // Uninstall CA certificate
    if (isCAInstalled) {
      const caSpinner = ora('Removing CA certificate (requires sudo)...').start();
      try {
        await certManager.uninstallCA();
        caSpinner.succeed('CA certificate removed');
      } catch (error) {
        caSpinner.fail('Failed to remove CA certificate');
        throw error;
      }
    }

    // Restore hosts file
    if (isHostsInstalled) {
      const hostsSpinner = ora('Restoring /etc/hosts (requires sudo)...').start();
      try {
        await hostsManager.uninstall();
        hostsSpinner.succeed('/etc/hosts restored');
      } catch (error) {
        hostsSpinner.fail('Failed to restore /etc/hosts');
        throw error;
      }
    }

    // Remove certificate files
    const certSpinner = ora('Removing certificate files...').start();
    try {
      await certManager.removeCertificates();
      certSpinner.succeed('Certificate files removed');
    } catch (error) {
      certSpinner.warn('Failed to remove certificate files (non-critical)');
    }

    // Flush DNS cache
    const dnsSpinner = ora('Flushing DNS cache...').start();
    try {
      await hostsManager.flushDNS();
      dnsSpinner.succeed('DNS cache flushed');
    } catch (error) {
      dnsSpinner.warn('Failed to flush DNS cache (non-critical)');
    }

    console.log(chalk.green('\n✓ MITM proxy uninstalled successfully!\n'));

    logger.info('MITM uninstall command completed successfully');
  } catch (error) {
    logger.error('MITM uninstall command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * MITM start command
 *
 * Start MITM proxy server on port 443
 */
export async function mitmStartCommand(options: { daemon?: boolean } = {}): Promise<void> {
  try {
    logger.info('Starting MITM start command', { daemon: options.daemon });

    // Check if already running
    const isRunning = await isMITMRunning();
    if (isRunning) {
      console.log(chalk.yellow('⚠️  MITM proxy is already running'));
      console.log(chalk.gray('Run: claudeflow mitm status (to check status)'));
      console.log(chalk.gray('Run: claudeflow mitm stop (to stop)'));
      return;
    }

    // Check if installed
    const certManager = new CertificateManager();
    const hostsManager = new HostsManager();

    const isCAInstalled = await certManager.isCAInstalled();
    const isHostsInstalled = await hostsManager.isInstalled();

    if (!isCAInstalled || !isHostsInstalled) {
      console.log(chalk.red('\n✗ MITM proxy is not installed'));
      console.log(chalk.gray('Run: claudeflow mitm install'));
      process.exit(1);
    }

    // Check if certificates exist
    const certsExist = await certManager.certificatesExist();
    if (!certsExist) {
      console.log(chalk.red('\n✗ Certificates not found'));
      console.log(chalk.gray('Run: claudeflow mitm install'));
      process.exit(1);
    }

    // Initialize services
    const configManager = new ConfigurationManager();
    const keychainStore = new KeychainStore();

    // Load config
    const configPath = process.env.CLAUDEFLOW_CONFIG || `${process.env.HOME}/.claudeflow/config.json`;
    await configManager.loadConfig(configPath);

    const config = configManager.getConfig();
    const kiroAccounts = config.accounts.filter(a => a.provider === 'kiro-oauth');

    if (kiroAccounts.length === 0) {
      console.log(chalk.red('\n✗ No Kiro OAuth accounts configured'));
      console.log(chalk.gray('Add accounts with: claudeflow login'));
      process.exit(1);
    }

    console.log(chalk.blue.bold('\n🚀 Starting MITM Proxy\n'));
    console.log(chalk.gray(`Accounts: ${kiroAccounts.length}`));
    console.log(chalk.gray(`Port: 443 (requires sudo)\n`));

    // Create proxy server
    const proxyServer = new ProxyServer({
      port: 443,
      host: '0.0.0.0',
      certManager,
      configManager,
      keychainStore,
    });

    // Start server
    const spinner = ora('Starting proxy server (requires sudo)...').start();
    try {
      await proxyServer.start();
      spinner.succeed('MITM proxy started');

      // Save PID
      await saveMITMPid(process.pid);

      console.log(chalk.green('\n✓ MITM proxy is running!\n'));
      console.log(chalk.blue('Intercepting domains:'));
      console.log(chalk.gray('  • q.us-east-1.amazonaws.com'));
      console.log(chalk.gray('  • q.us-west-2.amazonaws.com'));
      console.log(chalk.gray('  • q.eu-west-1.amazonaws.com'));
      console.log(chalk.gray('  • q.ap-southeast-1.amazonaws.com\n'));
      console.log(chalk.blue('Now you can use:'));
      console.log(chalk.gray('  • Kiro CLI'));
      console.log(chalk.gray('  • Kiro IDE'));
      console.log(chalk.gray('  • Any tool that calls Kiro API\n'));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

      // Handle graceful shutdown
      const cleanup = async () => {
        console.log('\n🛑 Stopping MITM proxy...');
        await proxyServer.stop();
        await removeMITMPid();
        process.exit(0);
      };

      process.on('SIGTERM', cleanup);
      process.on('SIGINT', cleanup);

      // Keep process alive
      if (!options.daemon) {
        await new Promise(() => {}); // Never resolves
      }
    } catch (error) {
      spinner.fail('Failed to start MITM proxy');
      throw error;
    }

    logger.info('MITM start command completed successfully');
  } catch (error) {
    logger.error('MITM start command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));

    if (error instanceof Error && error.message.includes('EACCES')) {
      console.log(chalk.yellow('\n⚠️  Port 443 requires root/admin privileges'));
      console.log(chalk.gray('Run with sudo: sudo claudeflow mitm start'));
    }

    process.exit(1);
  }
}

/**
 * MITM stop command
 *
 * Stop MITM proxy server
 */
export async function mitmStopCommand(): Promise<void> {
  try {
    logger.info('Starting MITM stop command');

    // Check if running
    const isRunning = await isMITMRunning();
    if (!isRunning) {
      console.log(chalk.yellow('⚠️  MITM proxy is not running'));
      return;
    }

    // Read PID
    const pid = await readMITMPid();
    if (!pid) {
      console.log(chalk.yellow('⚠️  MITM proxy PID not found'));
      await removeMITMPid();
      return;
    }

    // Kill process
    const spinner = ora('Stopping MITM proxy...').start();
    try {
      process.kill(pid, 'SIGTERM');

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Remove PID file
      await removeMITMPid();

      spinner.succeed('MITM proxy stopped');
      console.log(chalk.green('\n✓ MITM proxy stopped successfully\n'));
    } catch (error) {
      spinner.fail('Failed to stop MITM proxy');
      throw error;
    }

    logger.info('MITM stop command completed successfully');
  } catch (error) {
    logger.error('MITM stop command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * MITM status command
 *
 * Check MITM proxy status
 */
export async function mitmStatusCommand(): Promise<void> {
  try {
    logger.info('Starting MITM status command');

    const certManager = new CertificateManager();
    const hostsManager = new HostsManager();

    console.log(chalk.blue.bold('\n📊 MITM Proxy Status\n'));

    // Create status table
    const table = new Table({
      head: [chalk.cyan('Component'), chalk.cyan('Status')],
      colWidths: [30, 20],
    });

    // Check CA installation
    const isCAInstalled = await certManager.isCAInstalled();
    table.push([
      'CA Certificate',
      isCAInstalled ? chalk.green('✓ Installed') : chalk.red('✗ Not installed'),
    ]);

    // Check certificates exist
    const certsExist = await certManager.certificatesExist();
    table.push([
      'Certificate Files',
      certsExist ? chalk.green('✓ Exist') : chalk.red('✗ Missing'),
    ]);

    // Check hosts file
    const isHostsInstalled = await hostsManager.isInstalled();
    table.push([
      '/etc/hosts Modified',
      isHostsInstalled ? chalk.green('✓ Yes') : chalk.red('✗ No'),
    ]);

    // Check if running
    const isRunning = await isMITMRunning();
    table.push([
      'Proxy Server',
      isRunning ? chalk.green('✓ Running') : chalk.yellow('○ Stopped'),
    ]);

    console.log(table.toString());

    // Overall status
    const isFullyInstalled = isCAInstalled && certsExist && isHostsInstalled;

    if (isFullyInstalled && isRunning) {
      console.log(chalk.green('\n✓ MITM proxy is fully operational\n'));
    } else if (isFullyInstalled && !isRunning) {
      console.log(chalk.yellow('\n⚠️  MITM proxy is installed but not running\n'));
      console.log(chalk.gray('Start it with: claudeflow mitm start\n'));
    } else {
      console.log(chalk.red('\n✗ MITM proxy is not fully installed\n'));
      console.log(chalk.gray('Install it with: claudeflow mitm install\n'));
    }

    logger.info('MITM status command completed successfully');
  } catch (error) {
    logger.error('MITM status command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Helper: Check if MITM proxy is running
 */
async function isMITMRunning(): Promise<boolean> {
  try {
    const pid = await readMITMPid();
    if (!pid) {
      return false;
    }

    // Check if process exists
    try {
      process.kill(pid, 0); // Signal 0 checks if process exists
      return true;
    } catch {
      // Process doesn't exist, clean up PID file
      await removeMITMPid();
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Helper: Save MITM PID
 */
async function saveMITMPid(pid: number): Promise<void> {
  const dir = path.dirname(MITM_PID_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(MITM_PID_FILE, pid.toString(), 'utf8');
}

/**
 * Helper: Read MITM PID
 */
async function readMITMPid(): Promise<number | null> {
  try {
    const content = await fs.readFile(MITM_PID_FILE, 'utf8');
    return parseInt(content.trim(), 10);
  } catch {
    return null;
  }
}

/**
 * Helper: Remove MITM PID file
 */
async function removeMITMPid(): Promise<void> {
  try {
    await fs.unlink(MITM_PID_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}
