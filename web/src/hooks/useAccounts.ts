/**
 * useAccounts Hook
 *
 * React hook for fetching and managing account data with real-time updates.
 * Integrates with the accounts store and WebSocket for live updates.
 */

import { useEffect, useCallback } from 'react';
import { useAccountsStore, Account } from '../store/accounts-store';
import { useWebSocket } from './useWebSocket';
import { ServerMessage } from '../lib/websocket-client';

export interface UseAccountsOptions {
  autoFetch?: boolean;
  enableWebSocket?: boolean;
  websocketUrl?: string;
  authToken?: string;
}

export interface UseAccountsReturn {
  accounts: Account[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refreshAccount: (id: string) => Promise<void>;
  isConnected: boolean;
  connectionStatus: string;
}

export function useAccounts(options: UseAccountsOptions = {}): UseAccountsReturn {
  const {
    autoFetch = true,
    enableWebSocket = true,
    websocketUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:3130',
    authToken,
  } = options;

  const { accounts, loading, error, fetchAccounts, refreshAccount, updateAccountFromWebSocket } = useAccountsStore();

  // Handle WebSocket account status updates
  const handleAccountStatus = useCallback(
    (message: ServerMessage) => {
      if (message.type === 'account_status' && message.data) {
        const { id, ...update } = message.data as { id: string; [key: string]: unknown };
        if (id) {
          updateAccountFromWebSocket({ id, ...update } as Partial<Account> & { id: string });
        }
      }
    },
    [updateAccountFromWebSocket]
  );

  // Handle WebSocket quota updates
  const handleQuotaUpdate = useCallback(
    (message: ServerMessage) => {
      if (message.type === 'quota_update' && message.data) {
        const { accountId, ...quotaData } = message.data as { accountId?: string; [key: string]: unknown };
        if (accountId) {
          updateAccountFromWebSocket({
            id: accountId,
            quota: quotaData as unknown as Account['quota'],
          });
        }
      }
    },
    [updateAccountFromWebSocket]
  );

  // Handle WebSocket usage events
  const handleUsageEvent = useCallback(
    (message: ServerMessage) => {
      if (message.type === 'usage_event' && message.data) {
        const { accountId, requestCount } = message.data as { accountId?: string; requestCount?: number; [key: string]: unknown };
        if (accountId && requestCount !== undefined) {
          updateAccountFromWebSocket({
            id: accountId,
            requestCount: requestCount,
          });
        }
      }
    },
    [updateAccountFromWebSocket]
  );

  const handleWebSocketError = useCallback((_error: Error) => {
    // WebSocket reconnects automatically. Keep dashboard quiet during startup races.
  }, []);

  // Set up WebSocket connection
  const { status: connectionStatus, isConnected } = useWebSocket({
    url: websocketUrl,
    authToken,
    channels: enableWebSocket ? ['accounts', 'quota', 'usage'] : [],
    autoConnect: enableWebSocket,
    onAccountStatus: handleAccountStatus,
    onQuotaUpdate: handleQuotaUpdate,
    onUsageEvent: handleUsageEvent,
    onError: handleWebSocketError,
  });

  // Fetch accounts on mount if autoFetch is enabled
  useEffect(() => {
    if (autoFetch) {
      fetchAccounts();
    }
  }, [autoFetch, fetchAccounts]);

  const refetch = useCallback(async () => {
    await fetchAccounts();
  }, [fetchAccounts]);

  return {
    accounts,
    loading,
    error,
    refetch,
    refreshAccount,
    isConnected,
    connectionStatus,
  };
}
