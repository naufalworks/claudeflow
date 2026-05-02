/**
 * KiroAuthManager
 * 
 * Manages Kiro OAuth authentication and account pooling.
 * Handles session management, account rotation, and combo strategies.
 */

import axios from 'axios';
import type { RedisClientWrapper } from '../infrastructure/redis';

/**
 * Kiro session information
 */
export interface KiroSession {
  accountId: string;
  machineId: string;
  sessionToken: string;
  apiKey: string;
  expiresAt: Date;
}

/**
 * Kiro account information
 */
export interface KiroAccount {
  id: string;
  machineId: string;
  apiKey: string;
  sessionToken?: string;
  combo?: string;
  mitmRouterUrl: string;
  lastUsed: Date;
  requestCount: number;
  sessionExpiry?: Date;
}

/**
 * Kiro combo configuration
 */
export interface KiroCombo {
  name: string;
  accounts: string[];
  strategy: 'round-robin' | 'sticky-round-robin';
  currentIndex: number;
}

/**
 * Kiro authentication response
 */
interface KiroAuthResponse {
  sessionToken: string;
  apiKey: string;
  expiresAt: string;
}

/**
 * KiroAuthManager class
 */
export class KiroAuthManager {
  private accounts: Map<string, KiroAccount>;
  private combos: Map<string, KiroCombo>;
  private redisClient: RedisClientWrapper;
  private readonly SESSION_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

  constructor(redisClient: RedisClientWrapper) {
    this.accounts = new Map();
    this.combos = new Map();
    this.redisClient = redisClient;
  }

  /**
   * Add Kiro account to the manager
   * 
   * @param account - Kiro account to add
   */
  addAccount(account: KiroAccount): void {
    this.accounts.set(account.id, account);
  }

  /**
   * Add Kiro combo configuration
   * 
   * @param combo - Kiro combo configuration
   */
  addCombo(combo: KiroCombo): void {
    this.combos.set(combo.name, combo);
  }

  /**
   * Authenticate Kiro account and obtain session
   * 
   * @param machineId - Machine ID for authentication
   * @param apiKey - API key for authentication
   * @param mitmRouterUrl - MITM router URL
   * @returns Kiro session
   */
  async authenticateAccount(
    machineId: string,
    apiKey: string,
    mitmRouterUrl: string
  ): Promise<KiroSession> {
    try {
      // Call MITM router to authenticate
      const response = await axios.post<KiroAuthResponse>(
        `${mitmRouterUrl}/auth/login`,
        {
          machineId,
          apiKey,
        },
        {
          timeout: 10000,
        }
      );

      const session: KiroSession = {
        accountId: machineId,
        machineId,
        sessionToken: response.data.sessionToken,
        apiKey: response.data.apiKey,
        expiresAt: new Date(response.data.expiresAt),
      };

      // Store session in Redis
      await this.storeSessionInRedis(session);

      return session;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Kiro authentication failed: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  /**
   * Refresh expired Kiro session
   * 
   * @param accountId - Account ID to refresh
   * @returns Refreshed Kiro session
   */
  async refreshSession(accountId: string): Promise<KiroSession> {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Kiro account ${accountId} not found`);
    }

    try {
      // Call MITM router to refresh session
      const response = await axios.post<KiroAuthResponse>(
        `${account.mitmRouterUrl}/auth/refresh`,
        {
          machineId: account.machineId,
          sessionToken: account.sessionToken,
        },
        {
          timeout: 10000,
        }
      );

      const session: KiroSession = {
        accountId: account.id,
        machineId: account.machineId,
        sessionToken: response.data.sessionToken,
        apiKey: response.data.apiKey,
        expiresAt: new Date(response.data.expiresAt),
      };

      // Update account with new session
      account.sessionToken = session.sessionToken;
      account.sessionExpiry = session.expiresAt;

      // Store updated session in Redis
      await this.storeSessionInRedis(session);

      return session;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Kiro session refresh failed: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  /**
   * Select account from combo using configured strategy
   * 
   * @param comboName - Combo name
   * @param stickyKey - Sticky key for sticky-round-robin strategy (optional)
   * @returns Selected Kiro account
   */
  async selectAccountFromCombo(
    comboName: string,
    stickyKey?: string
  ): Promise<KiroAccount> {
    const combo = this.combos.get(comboName);
    if (!combo) {
      throw new Error(`Kiro combo ${comboName} not found`);
    }

    if (combo.accounts.length === 0) {
      throw new Error(`Kiro combo ${comboName} has no accounts`);
    }

    let accountId: string;

    if (combo.strategy === 'round-robin') {
      // Simple round-robin
      accountId = combo.accounts[combo.currentIndex];
      combo.currentIndex = (combo.currentIndex + 1) % combo.accounts.length;

      // Store updated combo state in Redis
      await this.storeComboStateInRedis(combo);
    } else {
      // Sticky round-robin (based on sticky key)
      if (!stickyKey) {
        // Fallback to round-robin if no sticky key provided
        accountId = combo.accounts[combo.currentIndex];
        combo.currentIndex = (combo.currentIndex + 1) % combo.accounts.length;
        await this.storeComboStateInRedis(combo);
      } else {
        const index = this.hashToIndex(stickyKey, combo.accounts.length);
        accountId = combo.accounts[index];
      }
    }

    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Kiro account ${accountId} not found in combo ${comboName}`);
    }

    // Check if session needs refresh
    if (await this.needsSessionRefresh(account)) {
      await this.refreshSession(account.id);
    }

    // Update usage tracking
    account.lastUsed = new Date();
    account.requestCount += 1;

    return account;
  }

  /**
   * Rotate to next account in combo
   * 
   * @param currentAccountId - Current account ID
   * @param comboName - Combo name
   * @returns Next Kiro account
   */
  async rotateAccount(
    currentAccountId: string,
    comboName: string
  ): Promise<KiroAccount> {
    const combo = this.combos.get(comboName);
    if (!combo) {
      throw new Error(`Kiro combo ${comboName} not found`);
    }

    // Find current account index
    const currentIndex = combo.accounts.indexOf(currentAccountId);
    if (currentIndex === -1) {
      throw new Error(
        `Account ${currentAccountId} not found in combo ${comboName}`
      );
    }

    // Move to next account
    const nextIndex = (currentIndex + 1) % combo.accounts.length;
    const nextAccountId = combo.accounts[nextIndex];

    const account = this.accounts.get(nextAccountId);
    if (!account) {
      throw new Error(`Kiro account ${nextAccountId} not found`);
    }

    // Check if session needs refresh
    if (await this.needsSessionRefresh(account)) {
      await this.refreshSession(account.id);
    }

    // Update usage tracking
    account.lastUsed = new Date();
    account.requestCount += 1;

    return account;
  }

  /**
   * Check if account session needs refresh
   * 
   * @param account - Kiro account
   * @returns True if session needs refresh
   */
  private async needsSessionRefresh(account: KiroAccount): Promise<boolean> {
    if (!account.sessionExpiry) {
      // No session expiry set, needs authentication
      return true;
    }

    const now = Date.now();
    const expiryTime = account.sessionExpiry.getTime();

    // Refresh if within 5 minutes of expiry
    return expiryTime - now < this.SESSION_REFRESH_BUFFER_MS;
  }

  /**
   * Store session in Redis
   * 
   * @param session - Kiro session
   */
  private async storeSessionInRedis(session: KiroSession): Promise<void> {
    const key = `kiro:session:${session.accountId}`;
    const data = JSON.stringify(session);

    // Calculate TTL until expiry
    const ttl = Math.max(
      60,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
    );

    await this.redisClient.getClient().setex(key, ttl, data);
  }

  /**
   * Load session from Redis
   * 
   * @param accountId - Account ID
   * @returns Kiro session or null
   */
  async loadSessionFromRedis(
    accountId: string
  ): Promise<KiroSession | null> {
    const key = `kiro:session:${accountId}`;
    const data = await this.redisClient.getClient().get(key);

    if (!data) {
      return null;
    }

    try {
      const session = JSON.parse(data) as KiroSession;
      session.expiresAt = new Date(session.expiresAt);
      return session;
    } catch (error) {
      console.error(`Failed to parse session for account ${accountId}:`, error);
      return null;
    }
  }

  /**
   * Store combo state in Redis
   * 
   * @param combo - Kiro combo
   */
  private async storeComboStateInRedis(combo: KiroCombo): Promise<void> {
    const key = `kiro:combo:${combo.name}`;
    const data = JSON.stringify(combo);

    // Store with 24h TTL
    await this.redisClient.getClient().setex(key, 86400, data);
  }

  /**
   * Load combo state from Redis
   * 
   * @param comboName - Combo name
   * @returns Kiro combo or null
   */
  async loadComboStateFromRedis(comboName: string): Promise<KiroCombo | null> {
    const key = `kiro:combo:${comboName}`;
    const data = await this.redisClient.getClient().get(key);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as KiroCombo;
    } catch (error) {
      console.error(`Failed to parse combo state for ${comboName}:`, error);
      return null;
    }
  }

  /**
   * Hash sticky key to index
   * 
   * @param key - Sticky key (e.g., conversation ID)
   * @param length - Number of accounts in combo
   * @returns Index in range [0, length)
   */
  private hashToIndex(key: string, length: number): number {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash) % length;
  }

  /**
   * Get account by ID
   * 
   * @param accountId - Account ID
   * @returns Kiro account or undefined
   */
  getAccount(accountId: string): KiroAccount | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * Get all accounts
   * 
   * @returns Array of Kiro accounts
   */
  getAccounts(): KiroAccount[] {
    return Array.from(this.accounts.values());
  }

  /**
   * Get combo by name
   * 
   * @param comboName - Combo name
   * @returns Kiro combo or undefined
   */
  getCombo(comboName: string): KiroCombo | undefined {
    return this.combos.get(comboName);
  }

  /**
   * Get all combos
   * 
   * @returns Array of Kiro combos
   */
  getCombos(): KiroCombo[] {
    return Array.from(this.combos.values());
  }

  /**
   * Initialize combos from Redis
   * 
   * Load combo states from Redis to restore round-robin indices
   */
  async initializeCombosFromRedis(): Promise<void> {
    const promises = Array.from(this.combos.keys()).map(async (comboName) => {
      const storedCombo = await this.loadComboStateFromRedis(comboName);
      if (storedCombo) {
        // Update current index from Redis
        const combo = this.combos.get(comboName);
        if (combo) {
          combo.currentIndex = storedCombo.currentIndex;
        }
      }
    });

    await Promise.all(promises);
  }
}
