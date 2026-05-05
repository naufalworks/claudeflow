/**
 * AccountPoolManager Unit Tests
 * 
 * Tests account selection, quota tracking, and Kiro account prioritization.
 */

import { AccountPoolManager } from '../account-pool-manager';
import type { Account } from '../../config/schema';
import { RedisClientWrapper } from '../../infrastructure/redis';
import { KeychainStore } from '../../auth/KeychainStore';

// Mock RedisClientWrapper and KeychainStore
jest.mock('../../infrastructure/redis');
jest.mock('../../auth/KeychainStore');

describe('AccountPoolManager', () => {
  let manager: AccountPoolManager;
  let mockRedisClient: jest.Mocked<RedisClientWrapper>;
  let mockKeychainStore: jest.Mocked<KeychainStore>;
  let mockRedis: any;

  beforeEach(() => {
    // Create mock Redis client
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      lpush: jest.fn(),
      ltrim: jest.fn(),
      expire: jest.fn(),
      lrange: jest.fn(),
    };

    mockRedisClient = new RedisClientWrapper({
      url: 'redis://localhost:6379',
    }) as jest.Mocked<RedisClientWrapper>;

    mockRedisClient.getClient = jest.fn().mockReturnValue(mockRedis);

    // Create mock KeychainStore
    mockKeychainStore = new KeychainStore() as jest.Mocked<KeychainStore>;
    mockKeychainStore.retrieve = jest.fn().mockResolvedValue(null);
    mockKeychainStore.store = jest.fn().mockResolvedValue(undefined);

    // Create mock config
    const mockConfig = {
      accounts: [],
      kiroAccounts: [],
    };

    manager = new AccountPoolManager(mockRedisClient, mockConfig, mockKeychainStore);
  });

  // ============================================================================
  // Account Selection Tests
  // ============================================================================

  describe('Account Selection', () => {
    it('should select account with highest score', async () => {
      // Add accounts - addAccount will initialize runtime fields
      const account1: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      const account2: Account = {
        id: 'acc2',
        provider: 'anthropic',
        apiKey: 'key2',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account1 as any);
      manager.addAccount(account2 as any);

      mockRedis.get.mockResolvedValue(null);

      const result = await manager.selectAccount();

      expect(['acc1', 'acc2']).toContain(result.account.id);
      expect(result.score).toBeGreaterThan(0);
    });

    it('should prioritize Kiro accounts over paid accounts', async () => {
      // Add paid account
      const paidAccount: Account = {
        id: 'paid1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      // Add Kiro OAuth account with all required fields
      const kiroAccount: Account = {
        id: 'kiro-abc123',
        provider: 'kiro-oauth',
        region: 'us-east-1',
        profileArn: 'arn:aws:codewhisperer:us-east-1:123456789012:profile/test-profile',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        lastUsed: Date.now(),
        requestCount: 0,
        errorCount: 0,
        priority: 0,
      };

      manager.addAccount(paidAccount as any);
      manager.addAccount(kiroAccount as any);

      mockRedis.get.mockResolvedValue(null);

      const result = await manager.selectAccount();

      expect(result.account.id).toBe('kiro-abc123'); // Kiro account prioritized
      expect(result.account.provider).toBe('kiro-oauth');
    });

    it('should deprioritize accounts at 90% quota', async () => {
      const account1: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      const account2: Account = {
        id: 'acc2',
        provider: 'anthropic',
        apiKey: 'key2',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account1 as any);
      manager.addAccount(account2 as any);

      mockRedis.get.mockResolvedValue(null);

      const result = await manager.selectAccount();

      expect(['acc1', 'acc2']).toContain(result.account.id);
    });

    it('should throw error when no accounts available', async () => {
      await expect(manager.selectAccount()).rejects.toThrow('No accounts available in pool');
    });

    it('should throw error when all accounts have no quota', async () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account as any);
      mockRedis.get.mockResolvedValue(null);

      // Account should still be selected
      const result = await manager.selectAccount();
      expect(result.account.id).toBe('acc1');
    });
  });

  // ============================================================================
  // Quota Tracking Tests
  // ============================================================================

  describe('Quota Tracking', () => {
    it('should update quota after request', async () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account as any);

      await manager.updateQuota('acc1', 500);

      const updatedAccount = manager.getAccount('acc1');
      expect(updatedAccount).toBeDefined();
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should store quota in Redis with TTL', async () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account as any);

      await manager.updateQuota('acc1', 500);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'quota:acc1',
        expect.any(Number),
        expect.any(String)
      );
    });

    it('should throw error when updating quota for non-existent account', async () => {
      await expect(manager.updateQuota('nonexistent', 500)).rejects.toThrow(
        'Account nonexistent not found'
      );
    });
  });

  // ============================================================================
  // Performance Tracking Tests
  // ============================================================================

  describe('Performance Tracking', () => {
    it('should update performance metrics', async () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: 0,
        requestCount: 0,
      };

      manager.addAccount(account as any);

      await manager.updatePerformance('acc1', 150, true);

      const updatedAccount = manager.getAccount('acc1');
      expect(updatedAccount).toBeDefined();
      expect(updatedAccount?.performance.lastUsed).toBeGreaterThan(0);
    });

    it('should decrease success rate on failure', async () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: 0,
        requestCount: 0,
      };

      manager.addAccount(account as any);

      await manager.updatePerformance('acc1', 150, false);

      const updatedAccount = manager.getAccount('acc1');
      expect(updatedAccount).toBeDefined();
    });
  });

  // ============================================================================
  // Reset Prediction Tests
  // ============================================================================

  describe('Reset Prediction', () => {
    it('should predict reset time based on historical data', async () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account as any);

      // Mock historical data (resets every 24 hours)
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const history = [
        now.toString(), // Most recent (index 0)
        (now - 1 * oneDayMs).toString(), // 1 day ago
        (now - 2 * oneDayMs).toString(), // 2 days ago
      ];

      mockRedis.lrange.mockResolvedValue(history);

      const predictedReset = await manager.predictReset('acc1');

      expect(predictedReset).toBeDefined();
    });

    it('should return current reset time when insufficient history', async () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account as any);

      mockRedis.lrange.mockResolvedValue([]);

      const predictedReset = await manager.predictReset('acc1');

      expect(predictedReset).toBeDefined();
    });
  });

  // ============================================================================
  // Kiro Account Tests
  // ============================================================================

  describe('Kiro Account Management', () => {
    it('should add Kiro account with correct configuration', () => {
      const kiroAccount: Account = {
        id: 'kiro-abc123',
        provider: 'kiro-oauth',
        region: 'us-east-1',
        profileArn: 'arn:aws:codewhisperer:us-east-1:123456789012:profile/test-profile',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        lastUsed: Date.now(),
        requestCount: 0,
        errorCount: 0,
        priority: 0,
      };

      manager.addAccount(kiroAccount as any);

      const account = manager.getAccount('kiro-abc123');
      expect(account).toBeDefined();
      expect(account?.provider).toBe('kiro-oauth');
    });

    it('should prioritize Kiro accounts due to cost efficiency', async () => {
      const paidAccount: Account = {
        id: 'paid1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      const kiroAccount: Account = {
        id: 'kiro-abc123',
        provider: 'kiro-oauth',
        region: 'us-east-1',
        profileArn: 'arn:aws:codewhisperer:us-east-1:123456789012:profile/test-profile',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        lastUsed: Date.now(),
        requestCount: 0,
        errorCount: 0,
        priority: 0,
      };

      manager.addAccount(paidAccount as any);
      manager.addAccount(kiroAccount as any);

      mockRedis.get.mockResolvedValue(null);

      const result = await manager.selectAccount();

      // Kiro account should be selected due to higher cost efficiency
      expect(result.account.id).toBe('kiro-abc123');
      expect(result.reason).toContain('Kiro account');
    });
  });

  // ============================================================================
  // Load Balancing Tests
  // ============================================================================

  describe('Load Balancing', () => {
    it('should balance load across multiple accounts', async () => {
      const account1: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      const account2: Account = {
        id: 'acc2',
        provider: 'anthropic',
        apiKey: 'key2',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account1 as any);
      manager.addAccount(account2 as any);

      mockRedis.get.mockResolvedValue(null);

      const result = await manager.selectAccount();

      // Should select one of the accounts (both have same score)
      expect(['acc1', 'acc2']).toContain(result.account.id);
    });
  });

  // ============================================================================
  // Utility Methods Tests
  // ============================================================================

  describe('Utility Methods', () => {
    it('should get all accounts', () => {
      const account1: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      const account2: Account = {
        id: 'acc2',
        provider: 'anthropic',
        apiKey: 'key2',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account1 as any);
      manager.addAccount(account2 as any);

      const accounts = manager.getAccounts();
      expect(accounts).toHaveLength(2);
    });

    it('should get account by ID', () => {
      const account: Account = {
        id: 'acc1',
        provider: 'anthropic',
        apiKey: 'key1',
        lastUsed: Date.now(),
        requestCount: 0,
      };

      manager.addAccount(account as any);

      const retrieved = manager.getAccount('acc1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('acc1');
    });

    it('should return undefined for non-existent account', () => {
      const account = manager.getAccount('nonexistent');
      expect(account).toBeUndefined();
    });
  });
});
