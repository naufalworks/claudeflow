/**
 * Example: Using State Management & WebSocket Hooks
 *
 * This file demonstrates how to use the Zustand stores and custom hooks
 * in your React components.
 */

'use client';

import { useEffect } from 'react';
import { useAuthStore, useAccountsStore, useUIStore } from '@/store';
import { useAccounts, useAnalytics, useWebSocket } from '@/hooks';

/**
 * Example 1: Authentication Store
 */
export function AuthExample() {
  const { apiKey, isAuthenticated, login, logout, checkAuth } = useAuthStore();

  useEffect(() => {
    // Check authentication status on mount
    checkAuth();
  }, [checkAuth]);

  const handleLogin = () => {
    try {
      login('sk-ant-api03-...');
      console.log('Logged in successfully');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <div>
      <p>Authenticated: {isAuthenticated ? 'Yes' : 'No'}</p>
      <p>API Key: {apiKey ? '***' + apiKey.slice(-4) : 'None'}</p>
      <button onClick={handleLogin}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

/**
 * Example 2: UI Store
 */
export function UIExample() {
  const {
    theme,
    sidebarOpen,
    commandPaletteOpen,
    toggleTheme,
    toggleSidebar,
    openCommandPalette,
    closeCommandPalette,
  } = useUIStore();

  return (
    <div>
      <p>Theme: {theme}</p>
      <p>Sidebar: {sidebarOpen ? 'Open' : 'Closed'}</p>
      <p>Command Palette: {commandPaletteOpen ? 'Open' : 'Closed'}</p>

      <button onClick={toggleTheme}>Toggle Theme</button>
      <button onClick={toggleSidebar}>Toggle Sidebar</button>
      <button onClick={openCommandPalette}>Open Command Palette</button>
      <button onClick={closeCommandPalette}>Close Command Palette</button>
    </div>
  );
}

/**
 * Example 3: Accounts Hook with WebSocket
 */
export function AccountsExample() {
  const {
    accounts,
    loading,
    error,
    refetch,
    refreshAccount,
    isConnected,
    connectionStatus,
  } = useAccounts({
    autoFetch: true,
    enableWebSocket: true,
    websocketUrl: 'ws://localhost:8080',
  });

  return (
    <div>
      <div>
        <p>Connection Status: {connectionStatus}</p>
        <p>WebSocket Connected: {isConnected ? 'Yes' : 'No'}</p>
        <button onClick={refetch}>Refresh All</button>
      </div>

      {loading && <p>Loading accounts...</p>}
      {error && <p>Error: {error}</p>}

      <ul>
        {accounts.map((account) => (
          <li key={account.id}>
            <p>Provider: {account.provider}</p>
            <p>Status: {account.status}</p>
            <p>Requests: {account.requestCount || 0}</p>
            <button onClick={() => refreshAccount(account.id)}>
              Refresh
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Example 4: Analytics Hook
 */
export function AnalyticsExample() {
  const { metrics, insights, loading, error, refetch, lastUpdated } = useAnalytics({
    autoFetch: true,
    refreshInterval: 30000, // Refresh every 30 seconds
  });

  return (
    <div>
      <div>
        <p>Last Updated: {lastUpdated || 'Never'}</p>
        <button onClick={refetch}>Refresh Analytics</button>
      </div>

      {loading && <p>Loading analytics...</p>}
      {error && <p>Error: {error}</p>}

      {metrics && (
        <div>
          <h3>Metrics</h3>
          <p>Total Requests: {metrics.totalRequests}</p>
          <p>Total Tokens: {metrics.totalTokens}</p>
          <p>Total Cost: ${metrics.totalCost}</p>
          <p>Average Latency: {metrics.averageLatency}ms</p>
          <p>Error Rate: {metrics.errorRate}%</p>
          <p>Active Accounts: {metrics.activeAccounts}</p>
        </div>
      )}

      {insights.length > 0 && (
        <div>
          <h3>Insights</h3>
          <ul>
            {insights.map((insight, index) => (
              <li key={index}>
                <strong>{insight.type}:</strong> {insight.title}
                <p>{insight.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Example 5: Direct WebSocket Usage
 */
export function WebSocketExample() {
  const { status, isConnected, isPolling, connect, disconnect, subscribe, unsubscribe } =
    useWebSocket({
      url: 'ws://localhost:8080',
      channels: ['usage', 'quota', 'accounts'],
      autoConnect: true,
      onMessage: (message) => {
        console.log('Received message:', message);
      },
      onUsageEvent: (message) => {
        console.log('Usage event:', message.data);
      },
      onQuotaUpdate: (message) => {
        console.log('Quota update:', message.data);
      },
      onAccountStatus: (message) => {
        console.log('Account status:', message.data);
      },
      onError: (error) => {
        console.error('WebSocket error:', error);
      },
    });

  return (
    <div>
      <p>Status: {status}</p>
      <p>Connected: {isConnected ? 'Yes' : 'No'}</p>
      <p>Polling: {isPolling ? 'Yes' : 'No'}</p>

      <button onClick={connect}>Connect</button>
      <button onClick={disconnect}>Disconnect</button>
      <button onClick={() => subscribe(['usage'])}>Subscribe to Usage</button>
      <button onClick={() => unsubscribe(['usage'])}>Unsubscribe from Usage</button>
    </div>
  );
}

/**
 * Example 6: Combined Usage in Dashboard
 */
export function DashboardExample() {
  const { isAuthenticated } = useAuthStore();
  const { theme, sidebarOpen } = useUIStore();
  const { accounts, isConnected } = useAccounts({
    autoFetch: isAuthenticated,
    enableWebSocket: isAuthenticated,
  });
  const { metrics } = useAnalytics({
    autoFetch: isAuthenticated,
    refreshInterval: 60000,
  });

  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }

  return (
    <div data-theme={theme}>
      <aside style={{ display: sidebarOpen ? 'block' : 'none' }}>
        <h2>Sidebar</h2>
      </aside>

      <main>
        <header>
          <h1>ClaudeFlow Dashboard</h1>
          <p>WebSocket: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
        </header>

        <section>
          <h2>Metrics</h2>
          {metrics && (
            <div>
              <p>Requests: {metrics.totalRequests}</p>
              <p>Cost: ${metrics.totalCost}</p>
            </div>
          )}
        </section>

        <section>
          <h2>Accounts ({accounts.length})</h2>
          <ul>
            {accounts.map((account) => (
              <li key={account.id}>
                {account.provider} - {account.id.slice(0, 12)} - {account.status}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
