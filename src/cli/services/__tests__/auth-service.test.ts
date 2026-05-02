/**
 * AuthService Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AuthService } from '../auth-service.js';
import { ConfigService } from '../config-service.js';
import { RedisClientWrapper } from '../../../infrastructure/redis.js';
import { KiroAuthManager } from '../../../accounts/kiro-auth-manager.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { KiroSession, KiroAccount } from '../../../accounts/kiro-auth-manager.js';

// Mock KiroAuthManager
jest.mock('../../../accounts/kiro-auth-manager.js');

describe('AuthService', () => {
  let authService: AuthService;
  let configService: ConfigService;
  let redisClient: RedisClientWrapper;
  let tempDir: string;
  let mockKiroAuthManager: jest.Mocked<KiroAuthManager>;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await mkdtemp(join(tmpdir(), 'claudeflow-test-'));
    
    // Create mock Redis client
    redisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      keys: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    // Create ConfigService
    configService = new ConfigService(tempDir);
    await configService.initialize();

    // Create AuthService
    authService = new AuthService(configService, redisClient);

    // Get mocked KiroAuthManager instance
    mockKiroAuthManager = (authService as any).kiroAuthManager as jest.Mocked<KiroAuthManager>;
  });

  afterEach(async () => {
    // Stop refresh worker if running
    if (authService.isRefreshWorkerRunning()) {
      await authService.stopSessionRefreshWorker();
    }

    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should load accounts from config into KiroAuthManager', async () => {
      // Add test account to config
      await configService.addAccount({
        id: 'test-account',
        machineId: 'machine-123',
        apiKey: 'sk-test-key',
        mitmRouterUrl: 'http://localhost:20128',
      });

      // Mock addAccount method
      mockKiroAuthManager.addAccount = jest.fn();

      // Initialize AuthService
      await authService.initialize();

      // Verify addAccount was called
      expect(mockKiroAuthManager.addAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-account',
          machineId: 'machine-123',
          apiKey: 'sk-test-key',
        })
      );
    });

    it('should load combos from config into KiroAuthManager', async () => {
      // Add test accounts
      await configService.addAccount({
        id: 'account-1',
        machineId: 'machine-1',
        apiKey: 'sk-key-1',
        mitmRouterUrl: 'http://localhost:20128',
      });
      await configService.addAccount({
        id: 'account-2',
        machineId: 'machine-2',
        apiKey: 'sk-key-2',
        mitmRouterUrl: 'http://localhost:20128',
      });

      // Add test combo
      await configService.addCombo({
        name: 'test-combo',
        accounts: ['account-1', 'account-2'],
        strategy: 'round-robin',
        currentIndex: 0,
      });

      // Mock methods
      mockKiroAuthManager.addAccount = jest.fn();
      mockKiroAuthManager.addCombo = jest.fn();
      mockKiroAuthManager.initializeCombosFromRedis = jest.fn().mockResolvedValue(undefined);

      // Initialize AuthService
      await authService.initialize();

      // Verify addCombo was called
      expect(mockKiroAuthManager.addCombo).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-combo',
          accounts: ['account-1', 'account-2'],
        })
      );

      // Verify initializeCombosFromRedis was called
      expect(mockKiroAuthManager.initializeCombosFromRedis).toHaveBeenCalled();
    });
  });

  describe('authenticate', () => {
    it('should authenticate account and return session', async () => {
      const mockSession: KiroSession = {
        accountId: 'test-account',
        sessionToken: 'session-token-123',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockKiroAuthManager.authenticateAccount = jest.fn().mockResolvedValue(mockSession);

      const session = await authService.authenticate('machine-123', 'sk-test-key');

      expect(session).toEqual(mockSession);
      expect(mockKiroAuthManager.authenticateAccount).toHaveBeenCalledWith(
        'machine-123',
        'sk-test-key',
        'http://3.68.219.151:20128'
      );
    });

    it('should use custom MITM router URL if provided', async () => {
      const mockSession: KiroSession = {
        accountId: 'test-account',
        sessionToken: 'session-token-123',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockKiroAuthManager.authenticateAccount = jest.fn().mockResolvedValue(mockSession);

      await authService.authenticate('machine-123', 'sk-test-key', 'http://custom:20128');

      expect(mockKiroAuthManager.authenticateAccount).toHaveBeenCalledWith(
        'machine-123',
        'sk-test-key',
        'http://custom:20128'
      );
    });

    it('should throw error on authentication failure', async () => {
      mockKiroAuthManager.authenticateAccount = jest.fn().mockRejectedValue(
        new Error('Authentication failed')
      );

      await expect(
        authService.authenticate('machine-123', 'invalid-key')
      ).rejects.toThrow('Authentication failed');
    });
  });

  describe('refreshSession', () => {
    it('should refresh session and update config', async () => {
      // Add test account
      await configService.addAccount({
        id: 'test-account',
        machineId: 'machine-123',
        apiKey: 'sk-test-key',
        mitmRouterUrl: 'http://localhost:20128',
      });

      const mockSession: KiroSession = {
        accountId: 'test-account',
        sessionToken: 'new-session-token',
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockKiroAuthManager.refreshSession = jest.fn().mockResolvedValue(mockSession);

      const session = await authService.refreshSession('test-account');

      expect(session).toEqual(mockSession);
      expect(mockKiroAuthManager.refreshSession).toHaveBeenCalledWith('test-account');

      // Verify config was updated
      const account = await configService.getAccount('test-account');
      expect(account?.sessionToken).toBe('new-session-token');
      expect(account?.sessionExpiry).toBeDefined();
    });

    it('should throw error on refresh failure', async () => {
      mockKiroAuthManager.refreshSession = jest.fn().mockRejectedValue(
        new Error('Refresh failed')
      );

      await expect(authService.refreshSession('test-account')).rejects.toThrow('Refresh failed');
    });
  });

  describe('getSessionStatus', () => {
    it('should return invalid status for non-existent account', async () => {
      mockKiroAuthManager.getAccount = jest.fn().mockReturnValue(null);

      const status = await authService.getSessionStatus('non-existent');

      expect(status.isValid).toBe(false);
      expect(status.needsRefresh).toBe(true);
    });

    it('should return invalid status for account without session expiry', async () => {
      const mockAccount: KiroAccount = {
        id: 'test-account',
        machineId: 'machine-123',
        apiKey: 'sk-test-key',
        mitmRouterUrl: 'http://localhost:20128',
        lastUsed: new Date(),
        requestCount: 0,
      };

      mockKiroAuthManager.getAccount = jest.fn().mockReturnValue(mockAccount);

      const status = await authService.getSessionStatus('test-account');

      expect(status.isValid).toBe(false);
      expect(status.needsRefresh).toBe(true);
    });

    it('should return valid status for account with valid session', async () => {
      const mockAccount: KiroAccount = {
        id: 'test-account',
        machineId: 'machine-123',
        apiKey: 'sk-test-key',
        mitmRouterUrl: 'http://localhost:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000), // 1 hour from now
      };

      mockKiroAuthManager.getAccount = jest.fn().mockReturnValue(mockAccount);

      const status = await authService.getSessionStatus('test-account');

      expect(status.isValid).toBe(true);
      expect(status.needsRefresh).toBe(false);
      expect(status.expiresAt).toBeDefined();
    });

    it('should return needsRefresh for session expiring soon', async () => {
      const mockAccount: KiroAccount = {
        id: 'test-account',
        machineId: 'machine-123',
        apiKey: 'sk-test-key',
        mitmRouterUrl: 'http://localhost:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes from now
      };

      mockKiroAuthManager.getAccount = jest.fn().mockReturnValue(mockAccount);

      const status = await authService.getSessionStatus('test-account');

      expect(status.isValid).toBe(true);
      expect(status.needsRefresh).toBe(true);
    });

    it('should return invalid status for expired session', async () => {
      const mockAccount: KiroAccount = {
        id: 'test-account',
        machineId: 'machine-123',
        apiKey: 'sk-test-key',
        mitmRouterUrl: 'http://localhost:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() - 1000), // Expired 1 second ago
      };

      mockKiroAuthManager.getAccount = jest.fn().mockReturnValue(mockAccount);

      const status = await authService.getSessionStatus('test-account');

      expect(status.isValid).toBe(false);
      expect(status.expiresIn).toBe('expired');
    });
  });

  describe('getAllSessionStatuses', () => {
    it('should return statuses for all accounts', async () => {
      const mockAccounts: KiroAccount[] = [
        {
          id: 'account-1',
          machineId: 'machine-1',
          apiKey: 'sk-key-1',
          mitmRouterUrl: 'http://localhost:20128',
          lastUsed: new Date(),
          requestCount: 0,
          sessionExpiry: new Date(Date.now() + 3600000),
        },
        {
          id: 'account-2',
          machineId: 'machine-2',
          apiKey: 'sk-key-2',
          mitmRouterUrl: 'http://localhost:20128',
          lastUsed: new Date(),
          requestCount: 0,
          sessionExpiry: new Date(Date.now() + 1800000),
        },
      ];

      mockKiroAuthManager.getAccounts = jest.fn().mockReturnValue(mockAccounts);
      mockKiroAuthManager.getAccount = jest.fn((id: string) => 
        mockAccounts.find(a => a.id === id) || null
      );

      const statuses = await authService.getAllSessionStatuses();

      expect(statuses).toHaveLength(2);
      expect(statuses[0].accountId).toBe('account-1');
      expect(statuses[1].accountId).toBe('account-2');
    });
  });

  describe('session refresh worker', () => {
    it('should start session refresh worker', async () => {
      mockKiroAuthManager.getAccounts = jest.fn().mockReturnValue([]);

      await authService.startSessionRefreshWorker();

      expect(authService.isRefreshWorkerRunning()).toBe(true);
    });

    it('should not start worker if already running', async () => {
      mockKiroAuthManager.getAccounts = jest.fn().mockReturnValue([]);

      await authService.startSessionRefreshWorker();
      await authService.startSessionRefreshWorker();

      expect(authService.isRefreshWorkerRunning()).toBe(true);
    });

    it('should stop session refresh worker', async () => {
      mockKiroAuthManager.getAccounts = jest.fn().mockReturnValue([]);

      await authService.startSessionRefreshWorker();
      await authService.stopSessionRefreshWorker();

      expect(authService.isRefreshWorkerRunning()).toBe(false);
    });

    it('should not throw error when stopping non-running worker', async () => {
      await expect(authService.stopSessionRefreshWorker()).resolves.not.toThrow();
    });
  });

  describe('getKiroAuthManager', () => {
    it('should return KiroAuthManager instance', () => {
      const manager = authService.getKiroAuthManager();
      expect(manager).toBeDefined();
    });
  });
});
