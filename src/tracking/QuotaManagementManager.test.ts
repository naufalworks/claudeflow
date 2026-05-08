/**
 * Tests for Quota Management Manager
 *
 * Tests quota tracking, account ranking, reset detection, and status reporting.
 */

import { QuotaManagementManager } from './QuotaManagementManager.js';
import { QuotaResetEvent } from './QuotaManagementManager.types.js';
import fs from 'fs';
import path from 'path';

describe('QuotaManagementManager', () => {
  let manager: QuotaManagementManager;
  let testDbPath: string;

  beforeEach(() => {
    // Create temporary database for testing
    testDbPath = path.join(__dirname, `test-quota-${Date.now()}.db`);
    manager = new QuotaManagementManager(testDbPath);
  });

  afterEach(() => {
    manager.close();
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    const walPath = `${testDbPath}-wal`;
    const shmPath = `${testDbPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  describe('updateQuotaUsage', () => {
    it('should track requests per minute', async () => {
      await manager.updateQuotaUsage('account1', 1000);
      await manager.updateQuotaUsage('account1', 1000);

      const status = await manager.getQuotaStatus('account1');
      expect(status.requestsPerMinute.used).toBe(2);
    });

    it('should track tokens per day', async () => {
      await manager.updateQuotaUsage('account1', 1000);
      await manager.updateQuotaUsage('account1', 2000);

      const status = await manager.getQuotaStatus('account1');
      expect(status.tokensPerDay.used).toBe(3000);
    });

    it('should reset requests per minute after time window', async () => {
      // First request
      await manager.updateQuotaUsage('account1', 1000);

      // Manually advance time by modifying database
      const db = manager.getDatabase();
      const now = Date.now();
      const oldMinute = Math.floor(now / 60000) * 60000 - 120000; // 2 minutes ago

      db.prepare(
        `
        UPDATE quota_tracking 
        SET last_minute_timestamp = ?
        WHERE account_id = ?
      `
      ).run(oldMinute, 'account1');

      // Clear cache to force reload
      await manager.updateQuotaUsage('account1', 1000);

      const status = await manager.getQuotaStatus('account1');
      expect(status.requestsPerMinute.used).toBe(1); // Should be reset
    });

    it('should emit quota_update event', async () => {
      let eventEmitted = false;
      manager.on('quota_update', (data) => {
        eventEmitted = true;
        expect(data.accountId).toBe('account1');
        expect(data.quotaUsed).toBeGreaterThan(0);
      });

      await manager.updateQuotaUsage('account1', 1000);
      expect(eventEmitted).toBe(true);
    });
  });

  describe('getQuotaStatus', () => {
    it('should return quota status with usage and limits', async () => {
      await manager.updateQuotaUsage('account1', 1000);

      const status = await manager.getQuotaStatus('account1');

      expect(status.accountId).toBe('account1');
      expect(status.requestsPerMinute.used).toBe(1);
      expect(status.requestsPerMinute.limit).toBe(4000);
      expect(status.tokensPerDay.used).toBe(1000);
      expect(status.tokensPerDay.limit).toBe(5_000_000);
      expect(status.status).toBe('available');
    });

    it('should mark account as near_limit when usage exceeds 95%', async () => {
      // Set low limit for testing
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 100,
        tokensPerDay: 1000,
      });

      // Use 96% of quota
      for (let i = 0; i < 96; i++) {
        await manager.updateQuotaUsage('account1', 10);
      }

      const status = await manager.getQuotaStatus('account1');
      expect(status.status).toBe('near_limit');
    });

    it('should mark account as exceeded when usage reaches 100%', async () => {
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 10,
        tokensPerDay: 1000,
      });

      // Exceed quota
      for (let i = 0; i < 11; i++) {
        await manager.updateQuotaUsage('account1', 100);
      }

      const status = await manager.getQuotaStatus('account1');
      expect(status.status).toBe('exceeded');
    });

    it('should return reset times', async () => {
      await manager.updateQuotaUsage('account1', 1000);

      const status = await manager.getQuotaStatus('account1');

      expect(status.requestsPerMinute.resetTime).toBeInstanceOf(Date);
      expect(status.tokensPerDay.resetTime).toBeInstanceOf(Date);
      expect(status.requestsPerMinute.resetTime.getTime()).toBeGreaterThan(Date.now());
      expect(status.tokensPerDay.resetTime.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('isAccountAvailable', () => {
    it('should return true for available accounts', async () => {
      await manager.updateQuotaUsage('account1', 1000);

      const available = await manager.isAccountAvailable('account1');
      expect(available).toBe(true);
    });

    it('should return false for exceeded accounts', async () => {
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 10,
        tokensPerDay: 1000,
      });

      // Exceed quota
      for (let i = 0; i < 11; i++) {
        await manager.updateQuotaUsage('account1', 100);
      }

      const available = await manager.isAccountAvailable('account1');
      expect(available).toBe(false);
    });
  });

  describe('getAvailableAccounts', () => {
    it('should return ranked accounts by score', async () => {
      // Create multiple accounts with different usage
      await manager.updateQuotaUsage('account1', 1000);
      await manager.updateQuotaUsage('account2', 100000);
      await manager.updateQuotaUsage('account3', 500000);

      const ranked = await manager.getAvailableAccounts();

      expect(ranked.length).toBe(3);
      expect(ranked[0].accountId).toBe('account1'); // Lowest usage = highest score
      expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
      expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
    });

    it('should assign zero score to near_limit accounts', async () => {
      // Create one available account
      await manager.updateQuotaUsage('account2', 1000);

      // Create one near_limit account
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 100,
        tokensPerDay: 1000,
      });

      // Use 96% of quota
      for (let i = 0; i < 96; i++) {
        await manager.updateQuotaUsage('account1', 10);
      }

      const ranked = await manager.getAvailableAccounts();
      const account1 = ranked.find((a) => a.accountId === 'account1');

      expect(account1?.score).toBe(0);
      expect(account1?.reason).toContain('Near quota limit');
    });

    it('should allow near_limit accounts when all accounts are near_limit', async () => {
      // Set all accounts to near limit
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 100,
        tokensPerDay: 1000,
      });
      await manager.setQuotaLimits('account2', {
        requestsPerMinute: 100,
        tokensPerDay: 1000,
      });

      // Use 96% for both
      for (let i = 0; i < 96; i++) {
        await manager.updateQuotaUsage('account1', 10);
        await manager.updateQuotaUsage('account2', 10);
      }

      const ranked = await manager.getAvailableAccounts();

      // Should recalculate scores without penalty
      expect(ranked.length).toBe(2);
      expect(ranked[0].score).toBeGreaterThan(0);
      expect(ranked[0].reason).toContain('All accounts near limit');
    });

    it('should include quota remaining and percentage', async () => {
      await manager.updateQuotaUsage('account1', 1000);

      const ranked = await manager.getAvailableAccounts();
      const account1 = ranked.find((a) => a.accountId === 'account1');

      expect(account1?.quotaRemaining).toBeGreaterThan(0);
      expect(account1?.quotaPercentage).toBeGreaterThan(0);
      expect(account1?.quotaPercentage).toBeLessThanOrEqual(1);
    });
  });

  describe('quota reset detection', () => {
    it('should detect quota reset when usage drops >50%', async () => {
      let resetDetected = false;
      let resetEvent: QuotaResetEvent | undefined;

      manager.on('quota_reset', (event: QuotaResetEvent) => {
        resetDetected = true;
        resetEvent = event;
      });

      // Set initial usage
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 100,
        tokensPerDay: 1000,
      });

      for (let i = 0; i < 50; i++) {
        await manager.updateQuotaUsage('account1', 10);
      }

      // Manually trigger minute reset by advancing time
      const db = manager.getDatabase();
      const now = Date.now();
      const oldMinute = Math.floor(now / 60000) * 60000 - 120000;

      db.prepare(
        `
        UPDATE quota_tracking 
        SET last_minute_timestamp = ?
        WHERE account_id = ?
      `
      ).run(oldMinute, 'account1');

      // Next update should detect reset
      await manager.updateQuotaUsage('account1', 10);

      expect(resetDetected).toBe(true);
      expect(resetEvent?.accountId).toBe('account1');
      expect(resetEvent?.quotaType).toBe('rpm');
      expect(resetEvent?.decreasePercentage).toBeGreaterThan(0.5);
    });

    it('should record reset in history', async () => {
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 100,
        tokensPerDay: 1000,
      });

      for (let i = 0; i < 50; i++) {
        await manager.updateQuotaUsage('account1', 10);
      }

      // Trigger reset
      const db = manager.getDatabase();
      const now = Date.now();
      const oldMinute = Math.floor(now / 60000) * 60000 - 120000;

      db.prepare(
        `
        UPDATE quota_tracking 
        SET last_minute_timestamp = ?
        WHERE account_id = ?
      `
      ).run(oldMinute, 'account1');

      await manager.updateQuotaUsage('account1', 10);

      // Check history
      const history = db
        .prepare(
          `
        SELECT * FROM quota_reset_history WHERE account_id = ?
      `
        )
        .all('account1');

      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('predictQuotaReset', () => {
    it('should predict next reset time', async () => {
      const predicted = await manager.predictQuotaReset('account1');

      expect(predicted).toBeInstanceOf(Date);
      expect(predicted.getTime()).toBeGreaterThan(Date.now());
    });

    it('should use historical data when available', async () => {
      // Insert historical resets
      const db = manager.getDatabase();
      const now = Date.now();

      db.prepare(
        `
        INSERT INTO quota_reset_history (account_id, timestamp, previous_usage, current_usage, decrease_percentage, quota_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run('account1', now - 86400000, 1000, 0, 1.0, 'tpd'); // 1 day ago

      db.prepare(
        `
        INSERT INTO quota_reset_history (account_id, timestamp, previous_usage, current_usage, decrease_percentage, quota_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run('account1', now - 172800000, 1000, 0, 1.0, 'tpd'); // 2 days ago

      const predicted = await manager.predictQuotaReset('account1');

      // Should predict approximately 1 day from last reset
      const expectedTime = now + 86400000;
      const tolerance = 3600000; // 1 hour tolerance

      expect(Math.abs(predicted.getTime() - expectedTime)).toBeLessThan(tolerance);
    });
  });

  describe('setQuotaLimits', () => {
    it('should set custom quota limits', async () => {
      await manager.setQuotaLimits('account1', {
        requestsPerMinute: 1000,
        tokensPerDay: 1_000_000,
      });

      await manager.updateQuotaUsage('account1', 100);

      const status = await manager.getQuotaStatus('account1');
      expect(status.requestsPerMinute.limit).toBe(1000);
      expect(status.tokensPerDay.limit).toBe(1_000_000);
    });
  });

  describe('error handling', () => {
    it('should handle missing account gracefully', async () => {
      const status = await manager.getQuotaStatus('nonexistent');

      expect(status.accountId).toBe('nonexistent');
      expect(status.requestsPerMinute.used).toBe(0);
      expect(status.tokensPerDay.used).toBe(0);
    });

    it('should return empty array when no accounts exist', async () => {
      const ranked = await manager.getAvailableAccounts();
      expect(ranked).toEqual([]);
    });
  });
});
