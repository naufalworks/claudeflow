/**
 * Accounts Store
 *
 * Manages account data including fetching, caching, and real-time updates
 * from WebSocket events.
 */

import { create } from 'zustand';
import { apiClient, AccountSummary } from '../lib/api-client';

// Use AccountSummary from api-client instead of custom Account interface
export type Account = AccountSummary;

interface AccountsState {
  accounts: Account[];
  loading: boolean;
  error: string | null;
  fetchAccounts: () => Promise<void>;
  refreshAccount: (id: string) => Promise<void>;
  updateAccountFromWebSocket: (update: Partial<Account> & { id: string }) => void;
  setAccounts: (accounts: Account[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  loading: false,
  error: null,

  fetchAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.getAccounts();
      set({ accounts: data.accounts || data, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      set({ error: message, loading: false });
    }
  },

  refreshAccount: async (id: string) => {
    try {
      const existing = get().accounts.find((a) => a.id === id);

      if (existing?.provider === 'kiro-oauth') {
        await apiClient.refreshAccountToken(id);
      }

      const account = await apiClient.getAccountDetails(id);

      const { accounts } = get();
      const index = accounts.findIndex((a) => a.id === id);

      if (index !== -1) {
        const updated = [...accounts];
        updated[index] = account;
        set({ accounts: updated });
      } else {
        set({ accounts: [...accounts, account] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh account';
      set({ error: message });
    }
  },

  updateAccountFromWebSocket: (update: Partial<Account> & { id: string }) => {
    const { accounts } = get();
    const index = accounts.findIndex((a) => a.id === update.id);

    if (index !== -1) {
      const updated = [...accounts];
      updated[index] = { ...updated[index], ...update };
      set({ accounts: updated });
    }
  },

  setAccounts: (accounts: Account[]) => set({ accounts }),
  setLoading: (loading: boolean) => set({ loading }),
  setError: (error: string | null) => set({ error }),
}));
