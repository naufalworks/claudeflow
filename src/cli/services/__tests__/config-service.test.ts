/**
 * ConfigService Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ConfigService } from '../config-service.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CLIConfig, KiroAccountConfig, KiroComboConfig } from '../../types/cli.types.js';

describe('ConfigService', () => {
  let configService: ConfigService;
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await mkdtemp(join(tmpdir(), 'claudeflow-test-'));
    configService = new ConfigService(tempDir);
    await configService.initialize();
  });

  afterEach(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create config directory structure', async () => {
      const config = await configService.getConfig();
      expect(config).toBeDefined();
      expect(config.version).toBe('0.1.0');
      expect(config.activeProfile).toBe('default');
    });

    it('should create subdirectories (logs, profiles, backups)', async () => {
      const { existsSync } = await import('fs');
      expect(existsSync(join(tempDir, 'logs'))).toBe(true);
      expect(existsSync(join(tempDir, 'profiles'))).toBe(true);
      expect(existsSync(join(tempDir, 'backups'))).toBe(true);
    });
  });

  describe('load and save', () => {
    it('should load default config on first run', async () => {
      const config = await configService.load();
      expect(config.version).toBe('0.1.0');
      expect(config.accounts).toEqual([]);
      expect(config.combos).toEqual([]);
    });

    it('should save and load config', async () => {
      const config = await configService.getConfig();
      config.daemon.port = 4000;
      await configService.save(config);

      const loadedConfig = await configService.load();
      expect(loadedConfig.daemon.port).toBe(4000);
    });

    it('should reject invalid config', async () => {
      const invalidConfig = {
        version: '0.1.0',
        // Missing required fields
      } as any;

      await expect(configService.save(invalidConfig)).rejects.toThrow('Invalid configuration');
    });
  });

  describe('update', () => {
    it('should update config with partial updates', async () => {
      await configService.update({
        daemon: {
          port: 5000,
          host: 'localhost',
          logLevel: 'debug',
          autoRestart: true,
        },
      });

      const config = await configService.getConfig();
      expect(config.daemon.port).toBe(5000);
      expect(config.daemon.logLevel).toBe('debug');
    });

    it('should preserve other fields when updating', async () => {
      await configService.update({
        preferences: {
          colorOutput: false,
          progressBars: true,
          autoUpdate: false,
        },
      });

      const config = await configService.getConfig();
      expect(config.preferences.colorOutput).toBe(false);
      expect(config.daemon.port).toBe(3000); // Should remain default
    });
  });

  describe('reset', () => {
    it('should reset config to defaults', async () => {
      await configService.update({
        daemon: {
          port: 5000,
          host: 'localhost',
          logLevel: 'debug',
          autoRestart: true,
        },
      });

      await configService.reset();

      const config = await configService.getConfig();
      expect(config.daemon.port).toBe(3000);
      expect(config.daemon.logLevel).toBe('info');
    });
  });

  describe('account management', () => {
    const testAccount: KiroAccountConfig = {
      id: 'test-account-1',
      machineId: 'machine-123',
      apiKey: 'sk-test-key',
      mitmRouterUrl: 'http://localhost:20128',
    };

    it('should add account', async () => {
      await configService.addAccount(testAccount);

      const config = await configService.getConfig();
      expect(config.accounts).toHaveLength(1);
      expect(config.accounts[0].id).toBe('test-account-1');
    });

    it('should reject duplicate account ID', async () => {
      await configService.addAccount(testAccount);

      await expect(configService.addAccount(testAccount)).rejects.toThrow(
        'Account with ID \'test-account-1\' already exists'
      );
    });

    it('should remove account', async () => {
      await configService.addAccount(testAccount);
      await configService.removeAccount('test-account-1');

      const config = await configService.getConfig();
      expect(config.accounts).toHaveLength(0);
    });

    it('should throw error when removing non-existent account', async () => {
      await expect(configService.removeAccount('non-existent')).rejects.toThrow(
        'Account \'non-existent\' not found'
      );
    });

    it('should update account', async () => {
      await configService.addAccount(testAccount);
      await configService.updateAccount('test-account-1', {
        sessionToken: 'new-token',
        sessionExpiry: Date.now() + 3600000,
      });

      const account = await configService.getAccount('test-account-1');
      expect(account?.sessionToken).toBe('new-token');
      expect(account?.sessionExpiry).toBeDefined();
    });

    it('should get account by ID', async () => {
      await configService.addAccount(testAccount);

      const account = await configService.getAccount('test-account-1');
      expect(account).toBeDefined();
      expect(account?.machineId).toBe('machine-123');
    });
  });

  describe('combo management', () => {
    const testAccount1: KiroAccountConfig = {
      id: 'account-1',
      machineId: 'machine-1',
      apiKey: 'sk-key-1',
      mitmRouterUrl: 'http://localhost:20128',
    };

    const testAccount2: KiroAccountConfig = {
      id: 'account-2',
      machineId: 'machine-2',
      apiKey: 'sk-key-2',
      mitmRouterUrl: 'http://localhost:20128',
    };

    const testCombo: KiroComboConfig = {
      name: 'test-combo',
      accounts: ['account-1', 'account-2'],
      strategy: 'round-robin',
      currentIndex: 0,
    };

    beforeEach(async () => {
      await configService.addAccount(testAccount1);
      await configService.addAccount(testAccount2);
    });

    it('should add combo', async () => {
      await configService.addCombo(testCombo);

      const config = await configService.getConfig();
      expect(config.combos).toHaveLength(1);
      expect(config.combos[0].name).toBe('test-combo');
    });

    it('should reject duplicate combo name', async () => {
      await configService.addCombo(testCombo);

      await expect(configService.addCombo(testCombo)).rejects.toThrow(
        'Combo with name \'test-combo\' already exists'
      );
    });

    it('should reject combo with non-existent account', async () => {
      const invalidCombo: KiroComboConfig = {
        name: 'invalid-combo',
        accounts: ['non-existent'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      await expect(configService.addCombo(invalidCombo)).rejects.toThrow(
        'Account \'non-existent\' not found'
      );
    });

    it('should remove combo', async () => {
      await configService.addCombo(testCombo);
      await configService.removeCombo('test-combo');

      const config = await configService.getConfig();
      expect(config.combos).toHaveLength(0);
    });

    it('should update combo', async () => {
      await configService.addCombo(testCombo);
      await configService.updateCombo('test-combo', {
        strategy: 'sticky-round-robin',
        currentIndex: 1,
      });

      const combo = await configService.getCombo('test-combo');
      expect(combo?.strategy).toBe('sticky-round-robin');
      expect(combo?.currentIndex).toBe(1);
    });

    it('should get combo by name', async () => {
      await configService.addCombo(testCombo);

      const combo = await configService.getCombo('test-combo');
      expect(combo).toBeDefined();
      expect(combo?.accounts).toHaveLength(2);
    });

    it('should remove account from combos when account is deleted', async () => {
      await configService.addCombo(testCombo);
      await configService.removeAccount('account-1');

      const combo = await configService.getCombo('test-combo');
      expect(combo?.accounts).toHaveLength(1);
      expect(combo?.accounts[0]).toBe('account-2');
    });
  });

  describe('profile management', () => {
    it('should save profile', async () => {
      const config = await configService.getConfig();
      config.daemon.port = 4000;

      await configService.saveProfile('test-profile', config);

      const profiles = await configService.listProfiles();
      expect(profiles).toContain('test-profile');
    });

    it('should load profile', async () => {
      const config = await configService.getConfig();
      config.daemon.port = 4000;
      await configService.saveProfile('test-profile', config);

      const loadedProfile = await configService.loadProfile('test-profile');
      expect(loadedProfile.daemon.port).toBe(4000);
    });

    it('should throw error when loading non-existent profile', async () => {
      await expect(configService.loadProfile('non-existent')).rejects.toThrow(
        'Profile \'non-existent\' does not exist'
      );
    });

    it('should list all profiles', async () => {
      const config = await configService.getConfig();
      await configService.saveProfile('profile-1', config);
      await configService.saveProfile('profile-2', config);

      const profiles = await configService.listProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles).toContain('profile-1');
      expect(profiles).toContain('profile-2');
    });

    it('should switch profile', async () => {
      const config = await configService.getConfig();
      config.daemon.port = 5000;
      await configService.saveProfile('new-profile', config);

      await configService.switchProfile('new-profile');

      const currentConfig = await configService.getConfig();
      expect(currentConfig.activeProfile).toBe('new-profile');
      expect(currentConfig.daemon.port).toBe(5000);
    });

    it('should delete profile', async () => {
      const config = await configService.getConfig();
      await configService.saveProfile('delete-me', config);

      await configService.deleteProfile('delete-me');

      const profiles = await configService.listProfiles();
      expect(profiles).not.toContain('delete-me');
    });

    it('should prevent deleting active profile', async () => {
      const config = await configService.getConfig();
      await configService.saveProfile('active-profile', config);
      await configService.switchProfile('active-profile');

      await expect(configService.deleteProfile('active-profile')).rejects.toThrow(
        'Cannot delete active profile'
      );
    });
  });

  describe('getConfigDir and getConfigPath', () => {
    it('should return config directory path', () => {
      expect(configService.getConfigDir()).toBe(tempDir);
    });

    it('should return config file path', () => {
      expect(configService.getConfigPath()).toBe(join(tempDir, 'config.json'));
    });
  });
});
