/**
 * ProxyDaemon - Background daemon process manager
 *
 * Manages the ClaudeFlow proxy as a background daemon with:
 * - PID file management (exclusive creation to prevent races)
 * - Process detection (isRunning with PID validation)
 * - Graceful shutdown with configurable timeout
 * - Signal handlers (SIGTERM, SIGINT)
 * - Directory creation for PID file
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DaemonConfig, DaemonStatus } from './ProxyDaemon.types.js';

const DEFAULT_CONFIG: DaemonConfig = {
  pidFilePath: path.join(os.homedir(), '.claudeflow', 'proxy.pid'),
  shutdownTimeout: 10000, // 10 seconds
};

export class ProxyDaemon {
  private config: DaemonConfig;
  private shutdownHandlers: (() => Promise<void>)[];
  private startTime: number | null;
  private shuttingDown: boolean;

  constructor(config: Partial<DaemonConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.shutdownHandlers = [];
    this.startTime = null;
    this.shuttingDown = false;
  }

  /**
   * Start the daemon process
   * Requirements: 14.1, 14.2, 14.3
   */
  async start(): Promise<void> {
    // Check if already running
    if (await this.isRunning()) {
      throw new Error('Daemon already running');
    }

    // Ensure PID directory exists
    const dir = path.dirname(this.config.pidFilePath);
    await fs.mkdir(dir, { recursive: true });

    // Write PID file with exclusive creation to prevent race conditions
    await this.writePidFile();

    this.startTime = Date.now();

    // Setup signal handlers
    this.setupSignalHandlers();

    console.log(`ProxyDaemon started with PID ${process.pid}`);
  }

  /**
   * Stop the daemon gracefully
   * Requirements: 14.4, 14.5
   */
  async stop(): Promise<void> {
    if (this.shuttingDown) {
      console.log('Already shutting down, ignoring stop request');
      return;
    }

    this.shuttingDown = true;
    console.log('ProxyDaemon stopping...');

    // Run all shutdown handlers with timeout
    const handlerPromises = this.shutdownHandlers.map((handler) =>
      Promise.race([
        handler().catch((error) => {
          console.error('Shutdown handler failed:', error);
        }),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            console.warn('Shutdown handler timed out');
            resolve();
          }, this.config.shutdownTimeout)
        ),
      ])
    );

    await Promise.all(handlerPromises);

    // Remove PID file
    await this.removePidFile();

    this.startTime = null;
    console.log('ProxyDaemon stopped');
  }

  /**
   * Check if daemon is already running
   * Requirements: 14.1
   */
  async isRunning(): Promise<boolean> {
    try {
      const pid = await this.readPidFile();
      if (pid === null) {
        return false;
      }

      // Validate PID is a positive integer
      if (!Number.isInteger(pid) || pid <= 0) {
        // Invalid PID file, clean it up
        await this.removePidFile();
        return false;
      }

      // Check if process is actually running
      // process.kill(pid, 0) doesn't send a signal, just checks existence
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        // Process not running, clean up stale PID file
        await this.removePidFile();
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get daemon status
   */
  async getStatus(): Promise<DaemonStatus> {
    const running = await this.isRunning();
    const pid = running ? await this.readPidFile() : undefined;

    return {
      running,
      pid: pid ?? undefined,
      pidFile: this.config.pidFilePath,
      uptime: this.startTime ? Date.now() - this.startTime : undefined,
    };
  }

  /**
   * Register a shutdown handler
   */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Write PID file with exclusive creation
   * @private
   */
  private async writePidFile(): Promise<void> {
    const pid = process.pid.toString();

    try {
      // Use exclusive flag 'wx' to prevent race conditions
      const handle = await fs.open(this.config.pidFilePath, 'wx', 0o600);
      await handle.writeFile(pid);
      await handle.close();
    } catch (error) {
      // If file already exists, check if the process is still running
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const running = await this.isRunning();
        if (running) {
          throw new Error('Daemon already running (PID file exists and process is alive)');
        }
        // Stale PID file, remove and retry
        await this.removePidFile();
        const handle = await fs.open(this.config.pidFilePath, 'wx', 0o600);
        await handle.writeFile(pid);
        await handle.close();
      } else {
        throw error;
      }
    }
  }

  /**
   * Read PID from file
   * @private
   */
  private async readPidFile(): Promise<number | null> {
    try {
      const content = await fs.readFile(this.config.pidFilePath, 'utf-8');
      const pid = parseInt(content.trim(), 10);

      if (Number.isNaN(pid)) {
        return null;
      }

      return pid;
    } catch {
      return null;
    }
  }

  /**
   * Remove PID file
   * @private
   */
  private async removePidFile(): Promise<void> {
    try {
      await fs.unlink(this.config.pidFilePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error('Failed to remove PID file:', error);
      }
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   * Requirements: 14.4
   * @private
   */
  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down...`);
      try {
        await this.stop();
      } catch (error) {
        console.error('Error during shutdown:', error);
      }
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  }
}
