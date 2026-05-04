/**
 * AuthService
 * 
 * Wrapper around KiroAuthManager for CLI operations
 */

import { KiroAuthManager, type KiroSession, type KiroAccount } from '../../accounts/kiro-auth-manager.js';
import { RedisClientWrapper } from '../../infrastructure/redis.js';
import { ConfigService } from './config-service.js';
import { logger } from '../utils/logger.js';
import type { SessionStatus } from '../types/cli.types.js';

/**
 * AuthService
 * 
 * Manages Kiro authentication and session refresh for CLI
 */
export class AuthService {
  private kiroAuthManager: KiroAuthManager;
  private configService: ConfigService;
  private refreshWorkerInterval?: NodeJS.Timeout;
  private readonly REFRESH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
  private readonly REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    configService: ConfigService,
    redisClient: RedisClientWrapper
  ) {
    this.configService = configService;
    this.kiroAuthManager = new KiroAuthManager(redisClient);
  }

  /**
   * Initialize AuthService by loading accounts from config
   */
  async initialize(): Promise<void> {
    const config = await this.configService.getConfig();

    // Load only OAuth accounts into KiroAuthManager (deprecated, only for OAuth)
    for (const account of config.accounts) {
      // Only load OAuth accounts into KiroAuthManager
      if (account.provider === 'kiro') {
        const kiroAccount: KiroAccount = {
          id: account.id,
          machineId: account.kiroConfig.machineId,
          apiKey: account.apiKey,
          sessionToken: account.kiroConfig.sessionToken,
          mitmRouterUrl: account.kiroConfig.mitmRouterUrl,
          lastUsed: account.lastUsed ? new Date(account.lastUsed) : new Date(),
          requestCount: account.requestCount || 0,
          sessionExpiry: account.kiroConfig.sessionExpiry,
        };

        this.kiroAuthManager.addAccount(kiroAccount);
      }
    }

    // Load combos into KiroAuthManager
    for (const combo of config.combos) {
      this.kiroAuthManager.addCombo(combo);
    }

    // Initialize combo states from Redis
    await this.kiroAuthManager.initializeCombosFromRedis();

    const oauthAccountCount = config.accounts.filter(a => a.provider === 'kiro').length;
    logger.info('AuthService initialized', {
      totalAccounts: config.accounts.length,
      oauthAccounts: oauthAccountCount,
      comboCount: config.combos.length,
    });
  }

  /**
   * Authenticate Kiro account
   * 
   * @param machineId - Machine ID
   * @param apiKey - API key
   * @param mitmRouterUrl - MITM router URL (optional, defaults to config)
   * @returns Kiro session
   */
  async authenticate(
    machineId: string,
    apiKey: string,
    mitmRouterUrl?: string
  ): Promise<KiroSession> {
    const config = await this.configService.getConfig();
    const routerUrl = mitmRouterUrl || config.infrastructure.mitmRouterUrl;

    logger.info('Authenticating Kiro account', { machineId, mitmRouterUrl: routerUrl });

    try {
      const session = await this.kiroAuthManager.authenticateAccount(
        machineId,
        apiKey,
        routerUrl
      );

      logger.info('Kiro authentication successful', {
        accountId: session.accountId,
        expiresAt: session.expiresAt,
      });

      return session;
    } catch (error) {
      logger.error('Kiro authentication failed', error);
      throw error;
    }
  }

  /**
   * Refresh session for account
   * 
   * @param accountId - Account ID
   * @returns Refreshed Kiro session
   */
  async refreshSession(accountId: string): Promise<KiroSession> {
    logger.info('Refreshing session for account', { accountId });

    try {
      const session = await this.kiroAuthManager.refreshSession(accountId);

      // Update config with new session token and expiry for OAuth account
      const account = await this.configService.getAccount(accountId);
      if (account && account.provider === 'kiro') {
        account.kiroConfig.sessionToken = session.sessionToken;
        account.kiroConfig.sessionExpiry = session.expiresAt;
        account.lastUsed = Date.now();
        await this.configService.updateAccount(accountId, account);
      }

      logger.info('Session refresh successful', {
        accountId: session.accountId,
        expiresAt: session.expiresAt,
      });

      return session;
    } catch (error) {
      logger.error('Session refresh failed', error);
      throw error;
    }
  }

  /**
   * Get session status for account
   * 
   * @param accountId - Account ID
   * @returns Session status
   */
  async getSessionStatus(accountId: string): Promise<SessionStatus> {
    const account = this.kiroAuthManager.getAccount(accountId);

    if (!account) {
      return {
        accountId,
        isValid: false,
        needsRefresh: true,
      };
    }

    if (!account.sessionExpiry) {
      return {
        accountId,
        isValid: false,
        needsRefresh: true,
      };
    }

    const now = Date.now();
    const expiryTime = account.sessionExpiry.getTime();
    const timeUntilExpiry = expiryTime - now;

    const isValid = timeUntilExpiry > 0;
    const needsRefresh = timeUntilExpiry < this.REFRESH_BUFFER_MS;

    return {
      accountId,
      isValid,
      expiresAt: account.sessionExpiry,
      expiresIn: this.formatTimeUntilExpiry(timeUntilExpiry),
      needsRefresh,
    };
  }

  /**
   * Get session status for all accounts
   * 
   * @returns Array of session statuses
   */
  async getAllSessionStatuses(): Promise<SessionStatus[]> {
    const accounts = this.kiroAuthManager.getAccounts();
    const statuses: SessionStatus[] = [];

    for (const account of accounts) {
      const status = await this.getSessionStatus(account.id);
      statuses.push(status);
    }

    return statuses;
  }

  /**
   * Start session refresh background worker
   */
  async startSessionRefreshWorker(): Promise<void> {
    if (this.refreshWorkerInterval) {
      logger.warn('Session refresh worker already running');
      return;
    }

    logger.info('Starting session refresh worker');

    // Run immediately on start
    await this.checkAndRefreshSessions();

    // Then run every minute
    this.refreshWorkerInterval = setInterval(async () => {
      await this.checkAndRefreshSessions();
    }, this.REFRESH_CHECK_INTERVAL_MS);

    logger.info('Session refresh worker started');
  }

  /**
   * Stop session refresh background worker
   */
  async stopSessionRefreshWorker(): Promise<void> {
    if (!this.refreshWorkerInterval) {
      logger.warn('Session refresh worker not running');
      return;
    }

    logger.info('Stopping session refresh worker');

    clearInterval(this.refreshWorkerInterval);
    this.refreshWorkerInterval = undefined;

    logger.info('Session refresh worker stopped');
  }

  /**
   * Check all accounts and refresh expiring sessions
   */
  private async checkAndRefreshSessions(): Promise<void> {
    const accounts = this.kiroAuthManager.getAccounts();

    logger.debug('Checking sessions for refresh', { accountCount: accounts.length });

    for (const account of accounts) {
      try {
        const status = await this.getSessionStatus(account.id);

        if (status.needsRefresh && status.isValid) {
          logger.info('Session needs refresh', {
            accountId: account.id,
            expiresIn: status.expiresIn,
          });

          await this.refreshSession(account.id);
        } else if (!status.isValid) {
          logger.warn('Session expired', {
            accountId: account.id,
          });
        }
      } catch (error) {
        logger.error('Failed to refresh session', {
          accountId: account.id,
          error,
        });
      }
    }
  }

  /**
   * Format time until expiry in human-readable format
   * 
   * @param milliseconds - Time in milliseconds
   * @returns Human-readable time string
   */
  private formatTimeUntilExpiry(milliseconds: number): string {
    if (milliseconds <= 0) {
      return 'expired';
    }

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      return `${seconds} second${seconds > 1 ? 's' : ''}`;
    }
  }

  /**
   * Get KiroAuthManager instance
   * 
   * @returns KiroAuthManager instance
   */
  getKiroAuthManager(): KiroAuthManager {
    return this.kiroAuthManager;
  }

  /**
   * Check if session refresh worker is running
   * 
   * @returns True if worker is running
   */
  isRefreshWorkerRunning(): boolean {
    return this.refreshWorkerInterval !== undefined;
  }
}
