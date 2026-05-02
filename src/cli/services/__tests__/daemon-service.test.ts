/**
 * DaemonService Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DaemonService } from '../daemon-service.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock PM2
jest.mock('pm2');

describe('DaemonService', () => {
  let daemonService: DaemonService;
  let tempDir: string;
  let mockPM2: any;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await mkdtemp(join(tmpdir(), 'claudeflow-test-'));
    
    // Create mock script path
    const scriptPath = join(tempDir, 'index.js');
    
    // Create DaemonService
    daemonService = new DaemonService(scriptPath, tempDir);

    // Get mocked PM2
    const pm2Module = await import('pm2');
    mockPM2 = pm2Module.default;

    // Setup default PM2 mocks
    mockPM2.connect = jest.fn((callback: (err: Error | null) => void) => {
      callback(null);
    });

    mockPM2.disconnect = jest.fn();

    mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
      callback(null, []);
    });
  });

  afterEach(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('start', () => {
    it('should start daemon successfully', async () => {
      mockPM2.start = jest.fn((config: any, callback: (err: Error | null) => void) => {
        callback(null);
      });

      await expect(daemonService.start()).resolves.not.toThrow();

      expect(mockPM2.connect).toHaveBeenCalled();
      expect(mockPM2.start).toHaveBeenCalled();
      expect(mockPM2.disconnect).toHaveBeenCalled();
    });

    it('should throw error if daemon is already running', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, [{
          pm2_env: { status: 'online' },
          pid: 12345,
        }]);
      });

      await expect(daemonService.start()).rejects.toThrow('Daemon is already running');
    });

    it('should throw error if script does not exist', async () => {
      const nonExistentScript = join(tempDir, 'non-existent.js');
      const service = new DaemonService(nonExistentScript, tempDir);

      await expect(service.start()).rejects.toThrow('ClaudeFlow server script not found');
    });

    it('should throw error on PM2 connection failure', async () => {
      mockPM2.connect = jest.fn((callback: (err: Error | null) => void) => {
        callback(new Error('Connection failed'));
      });

      await expect(daemonService.start()).rejects.toThrow('Connection failed');
    });

    it('should throw error on PM2 start failure', async () => {
      mockPM2.start = jest.fn((config: any, callback: (err: Error | null) => void) => {
        callback(new Error('Start failed'));
      });

      await expect(daemonService.start()).rejects.toThrow('Start failed');
    });
  });

  describe('stop', () => {
    it('should stop daemon successfully', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, [{
          pm2_env: { status: 'online' },
          pid: 12345,
        }]);
      });

      mockPM2.stop = jest.fn((name: string, callback: (err: Error | null) => void) => {
        callback(null);
      });

      mockPM2.delete = jest.fn((name: string, callback: (err: Error | null) => void) => {
        callback(null);
      });

      await expect(daemonService.stop()).resolves.not.toThrow();

      expect(mockPM2.stop).toHaveBeenCalled();
      expect(mockPM2.delete).toHaveBeenCalled();
    });

    it('should throw error if daemon is not running', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, []);
      });

      await expect(daemonService.stop()).rejects.toThrow('Daemon is not running');
    });

    it('should throw error on PM2 stop failure', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, [{
          pm2_env: { status: 'online' },
          pid: 12345,
        }]);
      });

      mockPM2.stop = jest.fn((name: string, callback: (err: Error | null) => void) => {
        callback(new Error('Stop failed'));
      });

      await expect(daemonService.stop()).rejects.toThrow('Stop failed');
    });
  });

  describe('restart', () => {
    it('should restart daemon successfully', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, [{
          pm2_env: { status: 'online' },
          pid: 12345,
        }]);
      });

      mockPM2.restart = jest.fn((name: string, callback: (err: Error | null) => void) => {
        callback(null);
      });

      await expect(daemonService.restart()).resolves.not.toThrow();

      expect(mockPM2.restart).toHaveBeenCalled();
    });

    it('should start daemon if not running', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, []);
      });

      mockPM2.start = jest.fn((config: any, callback: (err: Error | null) => void) => {
        callback(null);
      });

      await expect(daemonService.restart()).resolves.not.toThrow();

      expect(mockPM2.start).toHaveBeenCalled();
    });

    it('should throw error on PM2 restart failure', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, [{
          pm2_env: { status: 'online' },
          pid: 12345,
        }]);
      });

      mockPM2.restart = jest.fn((name: string, callback: (err: Error | null) => void) => {
        callback(new Error('Restart failed'));
      });

      await expect(daemonService.restart()).rejects.toThrow('Restart failed');
    });
  });

  describe('status', () => {
    it('should return running status', async () => {
      const uptime = Date.now() - 3600000; // 1 hour ago

      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, [{
          pid: 12345,
          pm2_env: {
            status: 'online',
            pm_uptime: uptime,
          },
          monit: {
            memory: 100 * 1024 * 1024, // 100 MB
          },
        }]);
      });

      const status = await daemonService.status();

      expect(status.isRunning).toBe(true);
      expect(status.pid).toBe(12345);
      expect(status.status).toBe('online');
      expect(status.memoryUsage).toBe(100 * 1024 * 1024);
      expect(status.uptime).toBeGreaterThan(0);
    });

    it('should return not running status', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(null, []);
      });

      const status = await daemonService.status();

      expect(status.isRunning).toBe(false);
      expect(status.pid).toBeUndefined();
    });

    it('should throw error on PM2 describe failure', async () => {
      mockPM2.describe = jest.fn((name: string, callback: (err: Error | null, list: any[]) => void) => {
        callback(new Error('Describe failed'), []);
      });

      await expect(daemonService.status()).rejects.toThrow('Describe failed');
    });
  });

  describe('auto-start', () => {
    it('should enable auto-start on macOS', async () => {
      // Mock platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      await expect(daemonService.enableAutoStart()).resolves.not.toThrow();

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('should disable auto-start on macOS', async () => {
      // Mock platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      await expect(daemonService.disableAutoStart()).resolves.not.toThrow();

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('should check auto-start status on macOS', async () => {
      // Mock platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      const isEnabled = await daemonService.isAutoStartEnabled();
      expect(typeof isEnabled).toBe('boolean');

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('should throw error for unsupported platform', async () => {
      // Mock platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        configurable: true,
      });

      await expect(daemonService.enableAutoStart()).rejects.toThrow(
        'Auto-start not supported on platform: freebsd'
      );

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('should throw error for Windows (not implemented)', async () => {
      // Mock platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      await expect(daemonService.enableAutoStart()).rejects.toThrow(
        'Auto-start on Windows is not yet implemented'
      );

      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });
});
