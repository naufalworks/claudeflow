import { renderHook, act, waitFor } from '@testing-library/react';
import { useAccountsStore } from '@/store/accounts-store';

// Mock fetch
global.fetch = jest.fn();

describe('useAccountsStore', () => {
  beforeEach(() => {
    // Clear store state before each test
    useAccountsStore.setState({ accounts: [], loading: false, error: null });
    (global.fetch as jest.Mock).mockClear();
  });

  describe('fetchAccounts', () => {
    it('fetches accounts successfully', async () => {
      const mockAccounts = [
        { id: '1', email: 'test1@example.com', status: 'active' },
        { id: '2', email: 'test2@example.com', status: 'inactive' },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: mockAccounts }),
      });

      const { result } = renderHook(() => useAccountsStore());

      await act(async () => {
        await result.current.fetchAccounts();
      });

      expect(result.current.accounts).toEqual(mockAccounts);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('handles accounts array directly in response', async () => {
      const mockAccounts = [
        { id: '1', email: 'test1@example.com', status: 'active' },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccounts,
      });

      const { result } = renderHook(() => useAccountsStore());

      await act(async () => {
        await result.current.fetchAccounts();
      });

      expect(result.current.accounts).toEqual(mockAccounts);
    });

    it('sets loading state during fetch', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const { result } = renderHook(() => useAccountsStore());

      act(() => {
        result.current.fetchAccounts();
      });

      expect(result.current.loading).toBe(true);
    });

    it('handles fetch error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      const { result } = renderHook(() => useAccountsStore());

      await act(async () => {
        await result.current.fetchAccounts();
      });

      expect(result.current.error).toBe('Failed to fetch accounts: Internal Server Error');
      expect(result.current.loading).toBe(false);
    });

    it('handles network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useAccountsStore());

      await act(async () => {
        await result.current.fetchAccounts();
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.loading).toBe(false);
    });
  });

  describe('refreshAccount', () => {
    it('updates existing account', async () => {
      const initialAccounts = [
        { id: '1', email: 'test1@example.com', status: 'active' as const },
        { id: '2', email: 'test2@example.com', status: 'inactive' as const },
      ];

      const updatedAccount = {
        id: '1',
        email: 'test1@example.com',
        status: 'suspended' as const,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => updatedAccount,
      });

      const { result } = renderHook(() => useAccountsStore());

      act(() => {
        result.current.setAccounts(initialAccounts);
      });

      await act(async () => {
        await result.current.refreshAccount('1');
      });

      expect(result.current.accounts[0]).toEqual(updatedAccount);
      expect(result.current.accounts[1]).toEqual(initialAccounts[1]);
    });

    it('adds new account if not found', async () => {
      const initialAccounts = [
        { id: '1', email: 'test1@example.com', status: 'active' as const },
      ];

      const newAccount = {
        id: '2',
        email: 'test2@example.com',
        status: 'active' as const,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => newAccount,
      });

      const { result } = renderHook(() => useAccountsStore());

      act(() => {
        result.current.setAccounts(initialAccounts);
      });

      await act(async () => {
        await result.current.refreshAccount('2');
      });

      expect(result.current.accounts).toHaveLength(2);
      expect(result.current.accounts[1]).toEqual(newAccount);
    });

    it('handles refresh error silently', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Refresh failed'));

      const { result } = renderHook(() => useAccountsStore());

      await act(async () => {
        await result.current.refreshAccount('1');
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to refresh account:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('updateAccountFromWebSocket', () => {
    it('updates existing account with partial data', () => {
      const initialAccounts = [
        { id: '1', email: 'test1@example.com', status: 'active' as const },
        { id: '2', email: 'test2@example.com', status: 'inactive' as const },
      ];

      const { result } = renderHook(() => useAccountsStore());

      act(() => {
        result.current.setAccounts(initialAccounts);
      });

      act(() => {
        result.current.updateAccountFromWebSocket({
          id: '1',
          status: 'suspended',
        });
      });

      expect(result.current.accounts[0].status).toBe('suspended');
      expect(result.current.accounts[0].email).toBe('test1@example.com');
    });

    it('does nothing if account not found', () => {
      const initialAccounts = [
        { id: '1', email: 'test1@example.com', status: 'active' as const },
      ];

      const { result } = renderHook(() => useAccountsStore());

      act(() => {
        result.current.setAccounts(initialAccounts);
      });

      act(() => {
        result.current.updateAccountFromWebSocket({
          id: '999',
          status: 'suspended',
        });
      });

      expect(result.current.accounts).toEqual(initialAccounts);
    });
  });

  describe('setters', () => {
    it('setAccounts updates accounts', () => {
      const { result } = renderHook(() => useAccountsStore());
      const accounts = [{ id: '1', email: 'test@example.com', status: 'active' as const }];

      act(() => {
        result.current.setAccounts(accounts);
      });

      expect(result.current.accounts).toEqual(accounts);
    });

    it('setLoading updates loading state', () => {
      const { result } = renderHook(() => useAccountsStore());

      act(() => {
        result.current.setLoading(true);
      });

      expect(result.current.loading).toBe(true);
    });

    it('setError updates error state', () => {
      const { result } = renderHook(() => useAccountsStore());

      act(() => {
        result.current.setError('Test error');
      });

      expect(result.current.error).toBe('Test error');
    });
  });
});
