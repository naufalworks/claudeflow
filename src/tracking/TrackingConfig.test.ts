/**
 * Tests for Tracking Configuration Manager
 *
 * Tests configuration loading, validation, defaults, and path resolution.
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5
 */

import { TrackingConfigManager } from './TrackingConfig.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('TrackingConfigManager', () => {
  let manager: TrackingConfigManager;
  let testConfigPath: string;

  beforeEach(() => {
    testConfigPath = path.join(os.tmpdir(), `claudeflow-test-config-${Date.now()}.json`);
    manager = new TrackingConfigManager(testConfigPath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testConfigPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Default Configuration', () => {
    it('should return defaults when no config file exists', async () => {
      const config = await manager.load();

      expect(config.usageTracking.enabled).toBe(true);
      expect(config.usageTracking.databasePath).toContain('.claudeflow/usage.db');
      expect(config.realTimeUpdates.port).toBe(8080);
      expect(config.quotaManagement.checkInterval).toBe(60);
      expect(config.auditLogging.rotationInterval).toBe('daily');
    });

    it('should return defaults from static method', () => {
      const defaults = TrackingConfigManager.getDefaults();

      expect(defaults.usageTracking.enabled).toBe(true);
      expect(defaults.realTimeUpdates.enabled).toBe(true);
      expect(defaults.quotaManagement.enabled).toBe(true);
      expect(defaults.auditLogging.enabled).toBe(true);
    });
  });

  describe('Configuration Loading', () => {
    it('should load tracking config from file', async () => {
      const fileConfig = {
        tracking: {
          usageTracking: {
            enabled: false,
            databasePath: '/custom/path/usage.db',
          },
          realTimeUpdates: {
            port: 9090,
          },
        },
      };

      await fs.writeFile(testConfigPath, JSON.stringify(fileConfig, null, 2));

      const config = await manager.load();

      expect(config.usageTracking.enabled).toBe(false);
      expect(config.usageTracking.databasePath).toBe('/custom/path/usage.db');
      expect(config.realTimeUpdates.port).toBe(9090);
      // Unset fields should use defaults
      expect(config.realTimeUpdates.batchInterval).toBe(100);
    });

    it('should use defaults when tracking section is missing', async () => {
      await fs.writeFile(testConfigPath, JSON.stringify({ server: { port: 3000 } }));

      const config = await manager.load();

      expect(config.usageTracking.enabled).toBe(true);
      expect(config.realTimeUpdates.port).toBe(8080);
    });

    it('should use defaults for invalid config values', async () => {
      const invalidConfig = {
        tracking: {
          usageTracking: {
            enabled: 'not-a-boolean',
            port: -1,
          },
        },
      };

      await fs.writeFile(testConfigPath, JSON.stringify(invalidConfig));

      const config = await manager.load();

      // Should fall back to defaults
      expect(config.usageTracking.enabled).toBe(true);
    });

    it('should handle malformed JSON', async () => {
      await fs.writeFile(testConfigPath, '{ invalid json }');

      const config = await manager.load();

      // Should fall back to defaults
      expect(config.usageTracking.enabled).toBe(true);
    });
  });

  describe('Path Resolution', () => {
    it('should resolve tilde in databasePath to home directory', async () => {
      const config = await manager.load();

      expect(config.usageTracking.databasePath).toContain(os.homedir());
      expect(config.usageTracking.databasePath).not.toContain('~');
    });

    it('should resolve tilde in logDir to home directory', async () => {
      const config = await manager.load();

      expect(config.auditLogging.logDir).toContain(os.homedir());
      expect(config.auditLogging.logDir).not.toContain('~');
    });

    it('should keep absolute paths unchanged', async () => {
      const fileConfig = {
        tracking: {
          usageTracking: {
            databasePath: '/absolute/path/usage.db',
          },
        },
      };

      await fs.writeFile(testConfigPath, JSON.stringify(fileConfig));

      const config = await manager.load();

      expect(config.usageTracking.databasePath).toBe('/absolute/path/usage.db');
    });
  });

  describe('Configuration Update', () => {
    it('should update partial configuration', async () => {
      await manager.load();

      const updated = manager.update({
        usageTracking: { enabled: false },
      });

      expect(updated.usageTracking.enabled).toBe(false);
      // Other fields should remain unchanged
      expect(updated.realTimeUpdates.port).toBe(8080);
    });

    it('should reject invalid configuration updates', async () => {
      await manager.load();

      expect(() =>
        manager.update({
          realTimeUpdates: { port: 99999 }, // Out of range
        })
      ).toThrow();
    });
  });

  describe('Configuration Save', () => {
    it('should save configuration to file', async () => {
      await manager.load();

      manager.update({
        usageTracking: { retentionDays: 60 },
      });

      await manager.save();

      // Read back and verify
      const content = await fs.readFile(testConfigPath, 'utf-8');
      const saved = JSON.parse(content);

      expect(saved.tracking.usageTracking.retentionDays).toBe(60);
    });

    it('should preserve existing config sections when saving', async () => {
      // Create initial config with non-tracking data
      await fs.writeFile(testConfigPath, JSON.stringify({ server: { port: 3000 }, tracking: {} }));

      await manager.load();
      await manager.save();

      const content = await fs.readFile(testConfigPath, 'utf-8');
      const saved = JSON.parse(content);

      // Non-tracking data should be preserved
      expect(saved.server.port).toBe(3000);
      expect(saved.tracking).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the configuration', async () => {
      await manager.load();

      const config1 = manager.getConfig();
      const config2 = manager.getConfig();

      // Should be equal but not the same reference
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });
});
