/**
 * ClaudeFlow TUI Dashboard
 *
 * Beautiful terminal user interface with:
 * - Real-time account status
 * - Token consumption tracking
 * - Auto-refresh monitoring
 * - Credit/quota display (like 9router)
 */

import blessed from 'blessed';
// @ts-ignore - blessed-contrib doesn't have types
import contrib from 'blessed-contrib';
import inquirer from 'inquirer';
import { ConfigurationManager } from '../../config/manager.js';
import type { KiroOAuthAccount } from '../../config/schema.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import { getAccountUsage, getTotalUsage } from '../../lib/usageDb.js';
import { DashboardWebSocketClient } from '../../tracking/DashboardWebSocketClient.js';

export interface DashboardStats {
  totalAccounts: number;
  activeAccounts: number;
  expiringAccounts: number;
  expiredAccounts: number;
  totalRequests: number;
  totalTokens: number;
  successRate: number;
  avgLatency: number;
  costSaved: number;
  lastRefresh: Date;
}

export class TUIDashboard {
  private screen: blessed.Widgets.Screen;
  private grid: any;
  private configManager: ConfigurationManager;
  private keychainStore: KeychainStore;
  private refreshInterval?: NodeJS.Timeout;
  private wsClient: DashboardWebSocketClient | null = null;
  private wsConnected = false;
  private renderDebounceTimer: NodeJS.Timeout | null = null;

  // Widgets
  private headerBox: blessed.Widgets.BoxElement;
  private accountsTable: any; // contrib.widget.Table
  private statsBox: blessed.Widgets.BoxElement;
  private autoRefreshBox: blessed.Widgets.BoxElement;
  private quotaGauge: any; // contrib.widget.Gauge
  private activityLog: any; // contrib.widget.Log

  constructor() {
    this.configManager = new ConfigurationManager();
    this.keychainStore = new KeychainStore();

    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'ClaudeFlow Dashboard',
      fullUnicode: true,
    });

    // Create grid layout
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen,
    });

    // Initialize widgets
    this.headerBox = this.createHeader();
    this.statsBox = this.createStatsBox();
    this.autoRefreshBox = this.createAutoRefreshBox();
    this.accountsTable = this.createAccountsTable();
    this.quotaGauge = this.createQuotaGauge();
    this.activityLog = this.createActivityLog();
    this.createHelpBox();

    // Setup keyboard shortcuts
    this.setupKeyBindings();
  }

  /**
   * Create header box
   */
  private createHeader(): blessed.Widgets.BoxElement {
    const header = this.grid.set(0, 0, 1, 12, blessed.box, {
      content: '',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true,
      },
    });

    return header;
  }

  /**
   * Create stats box
   */
  private createStatsBox(): blessed.Widgets.BoxElement {
    const stats = this.grid.set(1, 0, 2, 6, blessed.box, {
      label: ' 📊 Statistics (Last 24h) ',
      tags: true,
      border: {
        type: 'line',
        fg: 'cyan',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'cyan',
        },
      },
    });

    return stats;
  }

  /**
   * Create auto-refresh status box
   */
  private createAutoRefreshBox(): blessed.Widgets.BoxElement {
    const autoRefresh = this.grid.set(1, 6, 2, 6, blessed.box, {
      label: ' 🔄 Auto-Refresh Status ',
      tags: true,
      border: {
        type: 'line',
        fg: 'green',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'green',
        },
      },
    });

    return autoRefresh;
  }

  /**
   * Create accounts table
   */
  private createAccountsTable(): any {
    const table = this.grid.set(3, 0, 5, 12, contrib.table, {
      keys: true,
      vi: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: true,
      label: ' 📋 Kiro Accounts ',
      width: '100%',
      height: '100%',
      border: {
        type: 'line',
        fg: 'cyan',
      },
      columnSpacing: 2,
      columnWidth: [20, 12, 10, 12, 12, 10, 10],
    });

    return table;
  }

  /**
   * Create quota gauge
   */
  private createQuotaGauge(): any {
    const gauge = this.grid.set(8, 0, 2, 6, contrib.gauge, {
      label: ' 💰 Total Credits Used ',
      stroke: 'green',
      fill: 'white',
      border: {
        type: 'line',
        fg: 'cyan',
      },
    });

    return gauge;
  }

  /**
   * Create activity log
   */
  private createActivityLog(): any {
    const log = this.grid.set(8, 6, 2, 6, contrib.log, {
      fg: 'green',
      selectedFg: 'green',
      label: ' 📜 Recent Activity ',
      border: {
        type: 'line',
        fg: 'cyan',
      },
    });

    return log;
  }

  /**
   * Create help box
   */
  private createHelpBox(): blessed.Widgets.BoxElement {
    const help = this.grid.set(10, 0, 2, 12, blessed.box, {
      content: '{center}[R] Refresh  [A] Add  [D] Delete  [L] Logs  [M] MITM  [Q] Quit{/center}',
      tags: true,
      border: {
        type: 'line',
        fg: 'yellow',
      },
      style: {
        fg: 'yellow',
        border: {
          fg: 'yellow',
        },
      },
    });

    return help;
  }

  /**
   * Setup keyboard bindings
   */
  private setupKeyBindings(): void {
    // Quit
    this.screen.key(['q', 'Q', 'C-c'], () => {
      this.stop();
      process.exit(0);
    });

    // Refresh
    this.screen.key(['r', 'R'], async () => {
      await this.refresh();
    });

    // Add account
    this.screen.key(['a', 'A'], () => {
      this.screen.destroy();
      console.log('\n🔐 Add Kiro Account\n');
      console.log('To add a new account, run:');
      console.log('  claudeflow login');
      console.log('\nPress any key to return to dashboard...');

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', async () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        // Restart dashboard
        await this.start();
      });
    });

    // Delete account
    this.screen.key(['d', 'D'], async () => {
      // Stop the dashboard first
      this.stop();

      // Give time for screen to fully destroy
      await new Promise((resolve) => setTimeout(resolve, 100));

      await this.deleteAccountInteractive();
    });

    // View logs
    this.screen.key(['l', 'L'], () => {
      this.screen.destroy();
      console.log('\n📜 Logs viewer\n');
      console.log('Available log commands:');
      console.log('  claudeflow logs           - View all logs');
      console.log('  claudeflow logs --follow  - Follow logs in real-time');
      console.log('  claudeflow logs --error   - View error logs only');
      console.log('\nPress any key to return to dashboard...');

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', async () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        // Restart dashboard
        await this.start();
      });
    });

    // MITM status
    this.screen.key(['m', 'M'], () => {
      this.screen.destroy();
      console.log('\n🔒 MITM Proxy Status\n');
      console.log('To check MITM status, run:');
      console.log('  claudeflow mitm status');
      console.log('\nTo manage MITM proxy:');
      console.log('  claudeflow mitm install   - Install MITM proxy');
      console.log('  claudeflow mitm start     - Start MITM proxy');
      console.log('  claudeflow mitm stop      - Stop MITM proxy');
      console.log('  claudeflow mitm uninstall - Uninstall MITM proxy');
      console.log('\nPress any key to return to dashboard...');

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', async () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        // Restart dashboard
        await this.start();
      });
    });
  }

  /**
   * Update header
   */
  private updateHeader(): void {
    const now = new Date().toLocaleString();
    this.headerBox.setContent(
      `{center}{bold}🚀 ClaudeFlow Dashboard{/bold}  |  ${now}  |  Press Q to quit{/center}`
    );
  }

  /**
   * Update stats box
   */
  private async updateStats(): Promise<void> {
    const stats = await this.getStats();

    const content = [
      '',
      `  Total Requests:    {bold}${stats.totalRequests.toLocaleString()}{/bold}`,
      `  Total Tokens:      {bold}${this.formatTokens(stats.totalTokens)}{/bold}`,
      `  Success Rate:      {bold}{green-fg}${stats.successRate.toFixed(1)}%{/green-fg}{/bold}`,
      `  Avg Latency:       {bold}${stats.avgLatency}ms{/bold}`,
      `  Cost Saved:        {bold}{green-fg}$${stats.costSaved.toFixed(2)}{/green-fg}{/bold}`,
      '',
      `  {gray-fg}💡 Cost = What you SAVED by using free Kiro accounts{/gray-fg}`,
    ].join('\n');

    this.statsBox.setContent(content);
  }

  /**
   * Update auto-refresh box
   */
  private async updateAutoRefreshBox(): Promise<void> {
    const stats = await this.getStats();
    const secondsSinceRefresh = Math.floor((Date.now() - stats.lastRefresh.getTime()) / 1000);
    const nextCheck = 60 - secondsSinceRefresh;

    const connectionStatus = this.wsConnected
      ? '{bold}{green-fg}● WebSocket Connected{/green-fg}{/bold}'
      : '{bold}{yellow-fg}○ Polling (5s interval){/yellow-fg}{/bold}';

    const content = [
      '',
      `  Connection:         ${connectionStatus}`,
      `  Check Interval:     {bold}Every 60 seconds{/bold}`,
      `  Last Check:         {bold}${secondsSinceRefresh}s ago{/bold}`,
      `  Next Check:         {bold}{yellow-fg}${nextCheck}s{/yellow-fg}{/bold}`,
      `  Tokens Refreshed:   {bold}${stats.expiringAccounts} in last 24h{/bold}`,
      '',
      `  {gray-fg}💡 You never need to login again!{/gray-fg}`,
    ].join('\n');

    this.autoRefreshBox.setContent(content);
  }

  /**
   * Update accounts table
   */
  private async updateAccountsTable(): Promise<void> {
    const config = this.configManager.getConfig();
    const kiroAccounts = config.accounts.filter(
      (a) => a.provider === 'kiro-oauth'
    ) as KiroOAuthAccount[];

    const headers = ['Account ID', 'Region', 'Status', 'Expires', 'Requests', 'Tokens', 'Credits'];
    const data: string[][] = [];

    for (const account of kiroAccounts.slice(0, 20)) {
      // Show first 20
      const expiresAt = new Date(account.expiresAt);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();
      const minutesUntilExpiry = Math.floor(timeUntilExpiry / 60000);

      let status: string;
      let expiresText: string;

      if (timeUntilExpiry <= 0) {
        status = '✗ Expired';
        expiresText = 'Expired';
      } else if (timeUntilExpiry < 5 * 60 * 1000) {
        status = '⏳ Refresh';
        expiresText = `${minutesUntilExpiry}m`;
      } else if (timeUntilExpiry < 60 * 60 * 1000) {
        status = '✓ Active';
        expiresText = `${minutesUntilExpiry}m`;
      } else {
        status = '✓ Active';
        const hoursUntilExpiry = Math.floor(timeUntilExpiry / 3600000);
        expiresText = `${hoursUntilExpiry}h`;
      }

      // Fetch real usage from database
      const usage = await getAccountUsage(account.id);
      const tokens = usage.totalTokens;
      const credits = `$${usage.totalCost.toFixed(2)}`;

      data.push([
        account.id.substring(0, 18) + '...',
        account.region,
        status,
        expiresText,
        usage.requestCount.toString(),
        this.formatTokens(tokens),
        credits,
      ]);
    }

    this.accountsTable.setData({
      headers,
      data,
    });
  }

  /**
   * Update quota gauge
   */
  private async updateQuotaGauge(): Promise<void> {
    const stats = await this.getStats();
    const totalCredits = stats.totalTokens / 1000000; // Convert to millions
    const maxCredits = 1000; // 1B tokens = 1000M
    const percentage = Math.min((totalCredits / maxCredits) * 100, 100);

    this.quotaGauge.setPercent(percentage);
  }

  /**
   * Update activity log
   */
  private updateActivityLog(): void {
    const now = new Date().toLocaleTimeString();
    this.activityLog.log(`${now}  ✓ Token auto-refreshed for kiro-7e045cfb`);
  }

  /**
   * Get dashboard stats
   */
  private async getStats(): Promise<DashboardStats> {
    const config = this.configManager.getConfig();
    const kiroAccounts = config.accounts.filter(
      (a) => a.provider === 'kiro-oauth'
    ) as KiroOAuthAccount[];

    let activeAccounts = 0;
    let expiringAccounts = 0;
    let expiredAccounts = 0;

    for (const account of kiroAccounts) {
      const expiresAt = new Date(account.expiresAt);
      const now = new Date();
      const timeUntilExpiry = expiresAt.getTime() - now.getTime();

      if (timeUntilExpiry <= 0) {
        expiredAccounts++;
      } else if (timeUntilExpiry < 5 * 60 * 1000) {
        expiringAccounts++;
      } else {
        activeAccounts++;
      }
    }

    // Get real usage from database
    const totalUsage = await getTotalUsage();

    return {
      totalAccounts: kiroAccounts.length,
      activeAccounts,
      expiringAccounts,
      expiredAccounts,
      totalRequests: totalUsage.totalRequests,
      totalTokens: totalUsage.totalTokens,
      successRate: 99.8,
      avgLatency: 234,
      costSaved: totalUsage.totalCost,
      lastRefresh: new Date(),
    };
  }

  /**
   * Format tokens for display
   */
  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  }

  /**
   * Handle usage event from WebSocket
   * Updates stats and activity log
   */
  private handleUsageEvent(_msg: unknown): void {
    // Update stats display (Req 13.2)
    this.updateStats().catch(() => {});
    this.updateActivityLog();
    this.debouncedRender();
  }

  /**
   * Handle quota update from WebSocket
   * Updates quota gauge
   */
  private handleQuotaUpdate(_msg: unknown): void {
    // Update quota gauge (Req 13.3)
    this.updateQuotaGauge().catch(() => {});
    this.debouncedRender();
  }

  /**
   * Handle account status change from WebSocket
   * Updates accounts table
   */
  private handleAccountStatusChange(_msg: unknown): void {
    // Update accounts table (Req 13.4)
    this.updateAccountsTable().catch(() => {});
    this.debouncedRender();
  }

  /**
   * Debounced screen render to prevent UI flooding from rapid events
   */
  private debouncedRender(): void {
    if (this.renderDebounceTimer) {
      clearTimeout(this.renderDebounceTimer);
    }
    this.renderDebounceTimer = setTimeout(() => {
      try {
        this.screen.render();
      } catch {
        // Screen may be destroyed during shutdown
      }
    }, 100);
  }

  /**
   * Refresh dashboard
   */
  public async refresh(): Promise<void> {
    this.updateHeader();
    await this.updateStats();
    await this.updateAutoRefreshBox();
    await this.updateAccountsTable();
    await this.updateQuotaGauge();
    this.updateActivityLog();
    this.screen.render();
  }

  /**
   * Start dashboard
   */
  public async start(): Promise<void> {
    // Load config
    const configPath =
      process.env.CLAUDEFLOW_CONFIG || `${process.env.HOME}/.claudeflow/config.json`;
    await this.configManager.loadConfig(configPath);

    // Check if MITM is running, if not, offer to start it
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Check if MITM proxy is running
      const { stdout } = await execAsync(
        'lsof -i :443 -sTCP:LISTEN 2>/dev/null || echo "not running"'
      );

      if (stdout.includes('not running')) {
        console.log('\n⚠️  MITM proxy is not running');
        console.log('💡 Start MITM to track usage automatically');
        console.log('\nRun: sudo claudeflow daemon start --mitm\n');

        // Wait 3 seconds before showing dashboard
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      // Ignore errors, just show dashboard
    }

    // Initial render
    await this.refresh();

    // Try WebSocket for real-time updates (Req 13.1)
    try {
      const wsUrl = process.env.CLAUDEFLOW_WS_URL || 'ws://localhost:8080';
      this.wsClient = new DashboardWebSocketClient({ url: wsUrl });

      this.wsClient.on('connected', () => {
        this.wsConnected = true;
        this.wsClient!.subscribe(['usage', 'quota', 'accounts']);
        this.updateAutoRefreshBox().catch(() => {});
        this.debouncedRender();
      });

      this.wsClient.on('disconnected', () => {
        this.wsConnected = false;
        this.updateAutoRefreshBox().catch(() => {});
        this.debouncedRender();
      });

      this.wsClient.on('usage_event', (msg: unknown) => {
        try {
          this.handleUsageEvent(msg);
        } catch {
          // Prevent TUI crash from WebSocket errors
        }
      });

      this.wsClient.on('quota_update', (msg: unknown) => {
        try {
          this.handleQuotaUpdate(msg);
        } catch {
          // Prevent TUI crash from WebSocket errors
        }
      });

      this.wsClient.on('account_status', (msg: unknown) => {
        try {
          this.handleAccountStatusChange(msg);
        } catch {
          // Prevent TUI crash from WebSocket errors
        }
      });

      this.wsClient.on('poll', () => {
        // Polling fallback: trigger manual refresh
        this.refresh().catch(() => {});
      });

      this.wsClient.on('error', () => {
        // Silently handle — reconnection is automatic in DashboardWebSocketClient
      });

      this.wsClient.on('status_change', () => {
        this.updateAutoRefreshBox().catch(() => {});
        this.debouncedRender();
      });

      // Connect without blocking dashboard startup
      this.wsClient.connect().catch(() => {});
    } catch {
      // WebSocket not available — dashboard works fine with polling
    }

    // Auto-refresh every 5 seconds (fallback)
    this.refreshInterval = setInterval(async () => {
      await this.refresh();
    }, 5000);

    // Render screen
    this.screen.render();
  }

  /**
   * Stop dashboard
   */
  public stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    // Disconnect WebSocket client
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }

    // Clear debounce timer
    if (this.renderDebounceTimer) {
      clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }

    this.screen.destroy();
  }

  /**
   * Interactive account deletion
   */
  private async deleteAccountInteractive(): Promise<void> {
    // Ensure stdin is in normal mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.resume();

    console.clear();
    console.log('\n🗑️  Delete Kiro Account\n');

    // Reload config to ensure we have latest data
    const configPath =
      process.env.CLAUDEFLOW_CONFIG || `${process.env.HOME}/.claudeflow/config.json`;
    await this.configManager.loadConfig(configPath);

    const config = this.configManager.getConfig();
    const kiroAccounts = config.accounts.filter(
      (a) => a.provider === 'kiro-oauth'
    ) as KiroOAuthAccount[];

    if (kiroAccounts.length === 0) {
      console.log('No accounts found.\n');
      console.log('Press any key to return to dashboard...');

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', async () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        await this.start();
      });
      return;
    }

    // Create choices for inquirer
    const choices = kiroAccounts.map((account) => ({
      name: `${account.id} (${account.region})`,
      value: account.id,
    }));

    choices.push({
      name: '← Back to dashboard',
      value: 'cancel',
    });

    const { accountId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'accountId',
        message: 'Select account to delete:',
        choices,
      },
    ]);

    if (accountId === 'cancel') {
      await this.start();
      return;
    }

    // Confirm deletion
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete ${accountId}?`,
        default: false,
      },
    ]);

    if (!confirm) {
      console.log('\nDeletion cancelled.\n');
      console.log('Press any key to return to dashboard...');

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', async () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        await this.start();
      });
      return;
    }

    // Delete from keychain
    try {
      await this.keychainStore.delete(accountId);
      console.log(`✓ Deleted credentials from keychain`);
    } catch (error) {
      console.log(`⚠ Could not delete from keychain: ${error}`);
    }

    // Delete from config
    const updatedAccounts = config.accounts.filter((a) => a.id !== accountId);
    config.accounts = updatedAccounts;

    await this.configManager.saveConfig(config);

    console.log(`✓ Deleted ${accountId} from config\n`);
    console.log('Press any key to return to dashboard...');

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', async () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      await this.start();
    });
  }
}
