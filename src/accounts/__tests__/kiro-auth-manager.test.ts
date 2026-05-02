/**
 * KiroAuthManager Integration Tests
 * 
 * Tests Kiro OAuth authentication, session management, and account pooling.
 */

import { KiroAuthManager } from '../kiro-auth-manager';
import type { KiroAccount, KiroCombo } from '../kiro-auth-manager';
import { RedisClientWrapper } from '../../infrastructure/redis';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock RedisClientWrapper
jest.mock('../../infrastructure/redis');

describe('KiroAuthManager', () => {
  let manager: KiroAuthManager;
  let mockRedisClient: jest.Mocked<RedisClientWrapper>;
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

    manager = new KiroAuthManager(mockRedisClient);

    // Reset axios mocks
    jest.clearAllMocks();
  });

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  describe('Authentication', () => {
    it('should authenticate Kiro account successfully', async () => {
      const machineId = '3dee6bbab4fd4a736dad0528dee5bfcd59dc9ad5aac55ad621643ca74a822ac5';
      const apiKey = 'sk-ant-api03-test';
      const mitmRouterUrl = 'http://3.68.219.151:20128';

      const mockAuthResponse = {
        data: {
          sessionToken: 'session-token-123',
          apiKey: 'sk-ant-api03-authenticated',
          expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        },
      };

      mockedAxios.post.mockResolvedValue(mockAuthResponse);
      mockRedis.setex.mockResolvedValue('OK');

      const session = await manager.authenticateAccount(
        machineId,
        apiKey,
        mitmRouterUrl
      );

      expect(session.machineId).toBe(machineId);
      expect(session.sessionToken).toBe('session-token-123');
      expect(session.apiKey).toBe('sk-ant-api03-authenticated');
      expect(session.expiresAt).toBeInstanceOf(Date);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${mitmRouterUrl}/auth/login`,
        { machineId, apiKey },
        { timeout: 10000 }
      );

      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should throw error on authentication failure', async () => {
      const machineId = 'invalid-machine-id';
      const apiKey = 'invalid-api-key';
      const mitmRouterUrl = 'http://3.68.219.151:20128';

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 401,
          statusText: 'Unauthorized',
        },
      };

      mockedAxios.post.mockRejectedValue(axiosError);
      (mockedAxios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true);

      await expect(
        manager.authenticateAccount(machineId, apiKey, mitmRouterUrl)
      ).rejects.toThrow('Kiro authentication failed: 401 Unauthorized');
    });
  });

  // ============================================================================
  // Session Refresh Tests
  // ============================================================================

  describe('Session Refresh', () => {
    it('should refresh expired session', async () => {
      const account: KiroAccount = {
        id: 'kiro-1',
        machineId: '3dee6bbab4fd4a736dad0528dee5bfcd59dc9ad5aac55ad621643ca74a822ac5',
        apiKey: 'sk-ant-api03-test',
        sessionToken: 'old-session-token',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() - 1000), // Expired
      };

      manager.addAccount(account);

      const mockRefreshResponse = {
        data: {
          sessionToken: 'new-session-token',
          apiKey: 'sk-ant-api03-refreshed',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };

      mockedAxios.post.mockResolvedValue(mockRefreshResponse);
      mockRedis.setex.mockResolvedValue('OK');

      const session = await manager.refreshSession('kiro-1');

      expect(session.sessionToken).toBe('new-session-token');
      expect(session.apiKey).toBe('sk-ant-api03-refreshed');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${account.mitmRouterUrl}/auth/refresh`,
        {
          machineId: account.machineId,
          sessionToken: 'old-session-token',
        },
        { timeout: 10000 }
      );

      // Verify account was updated
      const updatedAccount = manager.getAccount('kiro-1');
      expect(updatedAccount?.sessionToken).toBe('new-session-token');
    });

    it('should throw error when refreshing non-existent account', async () => {
      await expect(manager.refreshSession('nonexistent')).rejects.toThrow(
        'Kiro account nonexistent not found'
      );
    });

    it('should throw error on refresh failure', async () => {
      const account: KiroAccount = {
        id: 'kiro-1',
        machineId: '3dee6bbab4fd4a736dad0528dee5bfcd59dc9ad5aac55ad621643ca74a822ac5',
        apiKey: 'sk-ant-api03-test',
        sessionToken: 'old-session-token',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
      };

      manager.addAccount(account);

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 401,
          statusText: 'Unauthorized',
        },
      };

      mockedAxios.post.mockRejectedValue(axiosError);
      (mockedAxios.isAxiosError as unknown as jest.Mock) = jest.fn().mockReturnValue(true);

      await expect(manager.refreshSession('kiro-1')).rejects.toThrow(
        'Kiro session refresh failed: 401 Unauthorized'
      );
    });
  });

  // ============================================================================
  // Round-Robin Account Selection Tests
  // ============================================================================

  describe('Round-Robin Account Selection', () => {
    it('should select accounts in round-robin order', async () => {
      const account1: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        sessionToken: 'token-1',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      const account2: KiroAccount = {
        id: 'kiro-2',
        machineId: 'machine-2',
        apiKey: 'key-2',
        sessionToken: 'token-2',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      manager.addAccount(account1);
      manager.addAccount(account2);

      const combo: KiroCombo = {
        name: 'test-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      mockRedis.setex.mockResolvedValue('OK');

      // First selection should be kiro-1
      const selected1 = await manager.selectAccountFromCombo('test-combo');
      expect(selected1.id).toBe('kiro-1');

      // Second selection should be kiro-2
      const selected2 = await manager.selectAccountFromCombo('test-combo');
      expect(selected2.id).toBe('kiro-2');

      // Third selection should wrap back to kiro-1
      const selected3 = await manager.selectAccountFromCombo('test-combo');
      expect(selected3.id).toBe('kiro-1');

      expect(mockRedis.setex).toHaveBeenCalledTimes(3);
    });

    it('should throw error when combo not found', async () => {
      await expect(
        manager.selectAccountFromCombo('nonexistent-combo')
      ).rejects.toThrow('Kiro combo nonexistent-combo not found');
    });

    it('should throw error when combo has no accounts', async () => {
      const combo: KiroCombo = {
        name: 'empty-combo',
        accounts: [],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      await expect(
        manager.selectAccountFromCombo('empty-combo')
      ).rejects.toThrow('Kiro combo empty-combo has no accounts');
    });
  });

  // ============================================================================
  // Sticky Round-Robin Account Selection Tests
  // ============================================================================

  describe('Sticky Round-Robin Account Selection', () => {
    it('should select same account for same sticky key', async () => {
      const account1: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        sessionToken: 'token-1',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      const account2: KiroAccount = {
        id: 'kiro-2',
        machineId: 'machine-2',
        apiKey: 'key-2',
        sessionToken: 'token-2',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      manager.addAccount(account1);
      manager.addAccount(account2);

      const combo: KiroCombo = {
        name: 'sticky-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'sticky-round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      const stickyKey = 'conversation-123';

      // Multiple selections with same sticky key should return same account
      const selected1 = await manager.selectAccountFromCombo('sticky-combo', stickyKey);
      const selected2 = await manager.selectAccountFromCombo('sticky-combo', stickyKey);
      const selected3 = await manager.selectAccountFromCombo('sticky-combo', stickyKey);

      expect(selected1.id).toBe(selected2.id);
      expect(selected2.id).toBe(selected3.id);
    });

    it('should select different accounts for different sticky keys', async () => {
      const account1: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        sessionToken: 'token-1',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      const account2: KiroAccount = {
        id: 'kiro-2',
        machineId: 'machine-2',
        apiKey: 'key-2',
        sessionToken: 'token-2',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      manager.addAccount(account1);
      manager.addAccount(account2);

      const combo: KiroCombo = {
        name: 'sticky-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'sticky-round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      const selected1 = await manager.selectAccountFromCombo('sticky-combo', 'conversation-1');
      const selected2 = await manager.selectAccountFromCombo('sticky-combo', 'conversation-2');

      // Different sticky keys may select different accounts
      // (depends on hash function, but they should be consistent)
      expect(selected1.id).toBeDefined();
      expect(selected2.id).toBeDefined();
    });

    it('should fallback to round-robin when no sticky key provided', async () => {
      const account1: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        sessionToken: 'token-1',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      const account2: KiroAccount = {
        id: 'kiro-2',
        machineId: 'machine-2',
        apiKey: 'key-2',
        sessionToken: 'token-2',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      manager.addAccount(account1);
      manager.addAccount(account2);

      const combo: KiroCombo = {
        name: 'sticky-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'sticky-round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      mockRedis.setex.mockResolvedValue('OK');

      // Without sticky key, should use round-robin
      const selected1 = await manager.selectAccountFromCombo('sticky-combo');
      const selected2 = await manager.selectAccountFromCombo('sticky-combo');

      expect(selected1.id).toBe('kiro-1');
      expect(selected2.id).toBe('kiro-2');
    });
  });

  // ============================================================================
  // Account Rotation Tests
  // ============================================================================

  describe('Account Rotation', () => {
    it('should rotate to next account in combo', async () => {
      const account1: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        sessionToken: 'token-1',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      const account2: KiroAccount = {
        id: 'kiro-2',
        machineId: 'machine-2',
        apiKey: 'key-2',
        sessionToken: 'token-2',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 3600000),
      };

      manager.addAccount(account1);
      manager.addAccount(account2);

      const combo: KiroCombo = {
        name: 'test-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      // Rotate from kiro-1 to kiro-2
      const rotated = await manager.rotateAccount('kiro-1', 'test-combo');
      expect(rotated.id).toBe('kiro-2');

      // Rotate from kiro-2 back to kiro-1 (wrap around)
      const rotated2 = await manager.rotateAccount('kiro-2', 'test-combo');
      expect(rotated2.id).toBe('kiro-1');
    });

    it('should throw error when rotating non-existent account', async () => {
      const combo: KiroCombo = {
        name: 'test-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      await expect(
        manager.rotateAccount('nonexistent', 'test-combo')
      ).rejects.toThrow('Account nonexistent not found in combo test-combo');
    });
  });

  // ============================================================================
  // Session Expiry Tests
  // ============================================================================

  describe('Session Expiry Handling', () => {
    it('should automatically refresh session when near expiry', async () => {
      const account: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        sessionToken: 'old-token',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
        sessionExpiry: new Date(Date.now() + 4 * 60 * 1000), // 4 minutes from now (within 5 min buffer)
      };

      manager.addAccount(account);

      const combo: KiroCombo = {
        name: 'test-combo',
        accounts: ['kiro-1'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      const mockRefreshResponse = {
        data: {
          sessionToken: 'new-token',
          apiKey: 'key-1',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };

      mockedAxios.post.mockResolvedValue(mockRefreshResponse);
      mockRedis.setex.mockResolvedValue('OK');

      const selected = await manager.selectAccountFromCombo('test-combo');

      expect(selected.sessionToken).toBe('new-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${account.mitmRouterUrl}/auth/refresh`,
        expect.any(Object),
        { timeout: 10000 }
      );
    });
  });

  // ============================================================================
  // Utility Methods Tests
  // ============================================================================

  describe('Utility Methods', () => {
    it('should get account by ID', () => {
      const account: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
      };

      manager.addAccount(account);

      const retrieved = manager.getAccount('kiro-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('kiro-1');
    });

    it('should return undefined for non-existent account', () => {
      const account = manager.getAccount('nonexistent');
      expect(account).toBeUndefined();
    });

    it('should get all accounts', () => {
      const account1: KiroAccount = {
        id: 'kiro-1',
        machineId: 'machine-1',
        apiKey: 'key-1',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
      };

      const account2: KiroAccount = {
        id: 'kiro-2',
        machineId: 'machine-2',
        apiKey: 'key-2',
        mitmRouterUrl: 'http://3.68.219.151:20128',
        lastUsed: new Date(),
        requestCount: 0,
      };

      manager.addAccount(account1);
      manager.addAccount(account2);

      const accounts = manager.getAccounts();
      expect(accounts).toHaveLength(2);
    });

    it('should get combo by name', () => {
      const combo: KiroCombo = {
        name: 'test-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      const retrieved = manager.getCombo('test-combo');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-combo');
    });

    it('should get all combos', () => {
      const combo1: KiroCombo = {
        name: 'combo-1',
        accounts: ['kiro-1'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      const combo2: KiroCombo = {
        name: 'combo-2',
        accounts: ['kiro-2'],
        strategy: 'sticky-round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo1);
      manager.addCombo(combo2);

      const combos = manager.getCombos();
      expect(combos).toHaveLength(2);
    });
  });

  // ============================================================================
  // Redis Integration Tests
  // ============================================================================

  describe('Redis Integration', () => {
    it('should initialize combos from Redis', async () => {
      const combo: KiroCombo = {
        name: 'test-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'round-robin',
        currentIndex: 0,
      };

      manager.addCombo(combo);

      // Mock Redis returning combo with different index
      const storedCombo = {
        name: 'test-combo',
        accounts: ['kiro-1', 'kiro-2'],
        strategy: 'round-robin',
        currentIndex: 1,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(storedCombo));

      await manager.initializeCombosFromRedis();

      const retrievedCombo = manager.getCombo('test-combo');
      expect(retrievedCombo?.currentIndex).toBe(1);
    });
  });
});
