/**
 * DaemonService
 * 
 * Manages ClaudeFlow daemon process using PM2
 */

import pm2 from 'pm2';
import { existsSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir, platform } from 'os';
import { logger } from '../utils/logger.js';
import type { DaemonStatus } from '../types/cli.types.js';

/**
 * PM2 Process Description
 */
interface PM2ProcessDescription {
  name?: string;
  pid?: number;
  pm_id?: number;
  monit?: {
    memory?: number;
    cpu?: number;
  };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    unstable_restarts?: number;
    created_at?: number;
  };
}

/**
 * DaemonService
 * 
 * Manages ClaudeFlow daemon lifecycle with PM2
 */
export class DaemonService {
  private readonly DAEMON_NAME = 'claudeflow';
  private readonly SCRIPT_PATH: string;
  private readonly CONFIG_DIR: string;

  constructor(scriptPath?: string, configDir?: string) {
    // Default to the built index.js in dist/
    this.SCRIPT_PATH = scriptPath || join(process.cwd(), 'dist', 'index.js');
    this.CONFIG_DIR = configDir || join(homedir(), '.claudeflow');
  }

  /**
   * Connect to PM2
   */
  private async connectPM2(): Promise<void> {
    return new Promise((resolve, reject) => {
      pm2.connect((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Disconnect from PM2
   */
  private async disconnectPM2(): Promise<void> {
    return new Promise((resolve) => {
      pm2.disconnect();
      resolve();
    });
  }

  /**
   * Start daemon
   */
  async start(): Promise<void> {
    logger.info('Starting ClaudeFlow daemon');

    try {
      // Check if script exists
      if (!existsSync(this.SCRIPT_PATH)) {
        throw new Error(`ClaudeFlow server script not found at ${this.SCRIPT_PATH}`);
      }

      // Connect to PM2
      await this.connectPM2();

      try {
        // Check if daemon is already running
        const status = await this.getStatus();
        if (status.isRunning) {
          logger.warn('Daemon is already running', { pid: status.pid });
          throw new Error('Daemon is already running');
        }

        // Start daemon with PM2
        await new Promise<void>((resolve, reject) => {
          pm2.start(
            {
              name: this.DAEMON_NAME,
              script: this.SCRIPT_PATH,
              cwd: process.cwd(),
              instances: 1,
              autorestart: true,
              watch: false,
              max_memory_restart: '1G',
              env: {
                NODE_ENV: 'production',
                CONFIG_PATH: join(this.CONFIG_DIR, 'config.json'),
              },
              error_file: join(this.CONFIG_DIR, 'logs', 'daemon-error.log'),
              out_file: join(this.CONFIG_DIR, 'logs', 'daemon.log'),
              log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            } as any, // PM2 types are incomplete, using any for the config object
            (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            }
          );
        });

        logger.info('Daemon started successfully');
      } finally {
        await this.disconnectPM2();
      }
    } catch (error) {
      logger.error('Failed to start daemon', error);
      throw error;
    }
  }

  /**
   * Stop daemon
   */
  async stop(): Promise<void> {
    logger.info('Stopping ClaudeFlow daemon');

    try {
      await this.connectPM2();

      try {
        // Check if daemon is running
        const status = await this.getStatus();
        if (!status.isRunning) {
          logger.warn('Daemon is not running');
          throw new Error('Daemon is not running');
        }

        // Stop daemon
        await new Promise<void>((resolve, reject) => {
          pm2.stop(this.DAEMON_NAME, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        // Delete daemon from PM2
        await new Promise<void>((resolve, reject) => {
          pm2.delete(this.DAEMON_NAME, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        logger.info('Daemon stopped successfully');
      } finally {
        await this.disconnectPM2();
      }
    } catch (error) {
      logger.error('Failed to stop daemon', error);
      throw error;
    }
  }

  /**
   * Restart daemon
   */
  async restart(): Promise<void> {
    logger.info('Restarting ClaudeFlow daemon');

    try {
      await this.connectPM2();

      try {
        // Check if daemon is running
        const status = await this.getStatus();
        if (!status.isRunning) {
          logger.warn('Daemon is not running, starting instead');
          await this.disconnectPM2();
          await this.start();
          return;
        }

        // Restart daemon
        await new Promise<void>((resolve, reject) => {
          pm2.restart(this.DAEMON_NAME, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        logger.info('Daemon restarted successfully');
      } finally {
        await this.disconnectPM2();
      }
    } catch (error) {
      logger.error('Failed to restart daemon', error);
      throw error;
    }
  }

  /**
   * Get daemon status
   */
  async status(): Promise<DaemonStatus> {
    try {
      await this.connectPM2();

      try {
        return await this.getStatus();
      } finally {
        await this.disconnectPM2();
      }
    } catch (error) {
      logger.error('Failed to get daemon status', error);
      throw error;
    }
  }

  /**
   * Get daemon status (internal, assumes PM2 is connected)
   */
  private async getStatus(): Promise<DaemonStatus> {
    return new Promise((resolve, reject) => {
      pm2.describe(this.DAEMON_NAME, (err, processDescriptionList) => {
        if (err) {
          reject(err);
          return;
        }

        if (!processDescriptionList || processDescriptionList.length === 0) {
          resolve({
            isRunning: false,
          });
          return;
        }

        const proc = processDescriptionList[0] as PM2ProcessDescription;
        const isRunning = proc.pm2_env?.status === 'online';

        const status: DaemonStatus = {
          isRunning,
          pid: proc.pid,
          uptime: proc.pm2_env?.pm_uptime
            ? Date.now() - proc.pm2_env.pm_uptime
            : undefined,
          memoryUsage: proc.monit?.memory,
          status: proc.pm2_env?.status,
        };

        resolve(status);
      });
    });
  }

  /**
   * Enable auto-start on system boot
   */
  async enableAutoStart(): Promise<void> {
    logger.info('Enabling auto-start');

    const os = platform();

    try {
      if (os === 'darwin') {
        await this.enableAutoStartMacOS();
      } else if (os === 'linux') {
        await this.enableAutoStartLinux();
      } else if (os === 'win32') {
        await this.enableAutoStartWindows();
      } else {
        throw new Error(`Auto-start not supported on platform: ${os}`);
      }

      logger.info('Auto-start enabled successfully');
    } catch (error) {
      logger.error('Failed to enable auto-start', error);
      throw error;
    }
  }

  /**
   * Disable auto-start on system boot
   */
  async disableAutoStart(): Promise<void> {
    logger.info('Disabling auto-start');

    const os = platform();

    try {
      if (os === 'darwin') {
        await this.disableAutoStartMacOS();
      } else if (os === 'linux') {
        await this.disableAutoStartLinux();
      } else if (os === 'win32') {
        await this.disableAutoStartWindows();
      } else {
        throw new Error(`Auto-start not supported on platform: ${os}`);
      }

      logger.info('Auto-start disabled successfully');
    } catch (error) {
      logger.error('Failed to disable auto-start', error);
      throw error;
    }
  }

  /**
   * Check if auto-start is enabled
   */
  async isAutoStartEnabled(): Promise<boolean> {
    const os = platform();

    try {
      if (os === 'darwin') {
        return await this.isAutoStartEnabledMacOS();
      } else if (os === 'linux') {
        return await this.isAutoStartEnabledLinux();
      } else if (os === 'win32') {
        return await this.isAutoStartEnabledWindows();
      } else {
        return false;
      }
    } catch (error) {
      logger.error('Failed to check auto-start status', error);
      return false;
    }
  }

  /**
   * Enable auto-start on macOS (launchd)
   */
  private async enableAutoStartMacOS(): Promise<void> {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.claudeflow.daemon.plist');

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claudeflow.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${this.SCRIPT_PATH}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(this.CONFIG_DIR, 'logs', 'daemon.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(this.CONFIG_DIR, 'logs', 'daemon-error.log')}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>CONFIG_PATH</key>
        <string>${join(this.CONFIG_DIR, 'config.json')}</string>
    </dict>
</dict>
</plist>`;

    await writeFile(plistPath, plistContent, { mode: 0o644 });
  }

  /**
   * Disable auto-start on macOS
   */
  private async disableAutoStartMacOS(): Promise<void> {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.claudeflow.daemon.plist');

    if (existsSync(plistPath)) {
      await unlink(plistPath);
    }
  }

  /**
   * Check if auto-start is enabled on macOS
   */
  private async isAutoStartEnabledMacOS(): Promise<boolean> {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.claudeflow.daemon.plist');
    return existsSync(plistPath);
  }

  /**
   * Enable auto-start on Linux (systemd)
   */
  private async enableAutoStartLinux(): Promise<void> {
    const servicePath = join(homedir(), '.config', 'systemd', 'user', 'claudeflow.service');

    const serviceContent = `[Unit]
Description=ClaudeFlow Daemon
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${this.SCRIPT_PATH}
Restart=always
RestartSec=10
Environment="NODE_ENV=production"
Environment="CONFIG_PATH=${join(this.CONFIG_DIR, 'config.json')}"
StandardOutput=append:${join(this.CONFIG_DIR, 'logs', 'daemon.log')}
StandardError=append:${join(this.CONFIG_DIR, 'logs', 'daemon-error.log')}

[Install]
WantedBy=default.target`;

    await writeFile(servicePath, serviceContent, { mode: 0o644 });
  }

  /**
   * Disable auto-start on Linux
   */
  private async disableAutoStartLinux(): Promise<void> {
    const servicePath = join(homedir(), '.config', 'systemd', 'user', 'claudeflow.service');

    if (existsSync(servicePath)) {
      await unlink(servicePath);
    }
  }

  /**
   * Check if auto-start is enabled on Linux
   */
  private async isAutoStartEnabledLinux(): Promise<boolean> {
    const servicePath = join(homedir(), '.config', 'systemd', 'user', 'claudeflow.service');
    return existsSync(servicePath);
  }

  /**
   * Enable auto-start on Windows (not implemented)
   */
  private async enableAutoStartWindows(): Promise<void> {
    throw new Error('Auto-start on Windows is not yet implemented');
  }

  /**
   * Disable auto-start on Windows (not implemented)
   */
  private async disableAutoStartWindows(): Promise<void> {
    throw new Error('Auto-start on Windows is not yet implemented');
  }

  /**
   * Check if auto-start is enabled on Windows (not implemented)
   */
  private async isAutoStartEnabledWindows(): Promise<boolean> {
    return false;
  }
}
