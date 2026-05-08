/**
 * Tests for ProxyDaemon
 *
 * Tests PID file management, process detection, and graceful shutdown.
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5
 */

import { ProxyDaemon } from './ProxyDaemon.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('ProxyDaemon', () => {
  let daemon: ProxyDaemon;
  let testPidFile: string;

  beforeEach(() => {
    testPidFile = path.join(os.tmpdir(), `claudeflow-test-${Date.now()}.pid`);
    daemon = new ProxyDaemon({ pidFilePath: testPidFile });
  });

  afterEach(async () => {
    try {
      await fs.unlink(testPidFile);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PID File Management', () => {
    it('should create PID file on start', async () => {
      await daemon.start();

      const content = await fs.readFile(testPidFile, 'utf-8');
      expect(content).toBe(process.pid.toString());

      await daemon.stop();
    });

    it('should remove PID file on stop', async () => {
      await daemon.start();
      await daemon.stop();

      await expect(fs.readFile(testPidFile, 'utf-8')).rejects.toThrow();
    });

    it('should create PID file with restricted permissions (0600)', async () => {
      await daemon.start();

      const stat = await fs.stat(testPidFile);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);

      await daemon.stop();
    });

    it('should create parent directory if it does not exist', async () => {
      const nestedPidFile = path.join(
        os.tmpdir(),
        `claudeflow-test-nested-${Date.now()}`,
        'proxy.pid'
      );
      const nestedDaemon = new ProxyDaemon({ pidFilePath: nestedPidFile });

      await nestedDaemon.start();

      const content = await fs.readFile(nestedPidFile, 'utf-8');
      expect(content).toBe(process.pid.toString());

      await nestedDaemon.stop();

      // Cleanup nested directory
      try {
        await fs.rmdir(path.dirname(nestedPidFile));
      } catch {
        // Ignore
      }
    });
  });

  describe('Process Detection', () => {
    it('should report not running when no PID file exists', async () => {
      const running = await daemon.isRunning();
      expect(running).toBe(false);
    });

    it('should report running after start', async () => {
      await daemon.start();

      const running = await daemon.isRunning();
      expect(running).toBe(true);

      await daemon.stop();
    });

    it('should report not running after stop', async () => {
      await daemon.start();
      await daemon.stop();

      const running = await daemon.isRunning();
      expect(running).toBe(false);
    });

    it('should detect stale PID file and clean up', async () => {
      // Write a PID file with a non-existent PID
      const stalePid = 999999999;
      await fs.writeFile(testPidFile, stalePid.toString());

      const running = await daemon.isRunning();
      expect(running).toBe(false);

      // PID file should be cleaned up
      await expect(fs.readFile(testPidFile, 'utf-8')).rejects.toThrow();
    });

    it('should handle invalid PID file content', async () => {
      await fs.writeFile(testPidFile, 'not-a-number');

      const running = await daemon.isRunning();
      expect(running).toBe(false);
    });

    it('should handle empty PID file', async () => {
      await fs.writeFile(testPidFile, '');

      const running = await daemon.isRunning();
      expect(running).toBe(false);
    });
  });

  describe('Daemon Start', () => {
    it('should throw error if already running', async () => {
      await daemon.start();

      await expect(daemon.start()).rejects.toThrow('Daemon already running');

      await daemon.stop();
    });

    it('should throw error if PID file exists and process is alive', async () => {
      // Write current PID to simulate another instance
      await fs.writeFile(testPidFile, process.pid.toString());

      await expect(daemon.start()).rejects.toThrow('Daemon already running');

      // Clean up
      await fs.unlink(testPidFile);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should run shutdown handlers on stop', async () => {
      const handlerCalls: string[] = [];

      daemon.onShutdown(async () => {
        handlerCalls.push('handler1');
      });

      daemon.onShutdown(async () => {
        handlerCalls.push('handler2');
      });

      await daemon.start();
      await daemon.stop();

      expect(handlerCalls).toEqual(['handler1', 'handler2']);
    });

    it('should continue if a shutdown handler fails', async () => {
      const handlerCalls: string[] = [];

      daemon.onShutdown(async () => {
        handlerCalls.push('handler1');
        throw new Error('Handler failed');
      });

      daemon.onShutdown(async () => {
        handlerCalls.push('handler2');
      });

      await daemon.start();
      await daemon.stop();

      // Both handlers should be called (first fails, second still runs)
      expect(handlerCalls).toContain('handler1');
      expect(handlerCalls).toContain('handler2');
    });

    it('should handle stop when not started', async () => {
      // Should not throw
      await daemon.stop();
    });

    it('should prevent double stop', async () => {
      await daemon.start();

      // Call stop twice concurrently
      await Promise.all([daemon.stop(), daemon.stop()]);

      // Should not throw and PID file should be cleaned up
      await expect(fs.readFile(testPidFile, 'utf-8')).rejects.toThrow();
    });
  });

  describe('Daemon Status', () => {
    it('should return correct status when not running', async () => {
      const status = await daemon.getStatus();

      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
      expect(status.uptime).toBeUndefined();
      expect(status.pidFile).toBe(testPidFile);
    });

    it('should return correct status when running', async () => {
      await daemon.start();

      const status = await daemon.getStatus();

      expect(status.running).toBe(true);
      expect(status.pid).toBe(process.pid);
      expect(status.uptime).toBeGreaterThan(0);
      expect(status.pidFile).toBe(testPidFile);

      await daemon.stop();
    });
  });
});
