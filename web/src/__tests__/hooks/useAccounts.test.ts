import { renderHook, waitFor } from '@testing-library/react';
import { useAccounts } from '@/hooks/useAccounts';
import { useAccountsStore } from '@/store/accounts-store';

// Mock the WebSocket hook
jest.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: jest.fn(() => ({
    status: 'connected',
    isConnected: true,
    isPolling: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    client: null,
  })),
}));

// Mock fetch
global.fetch = jest.fn();

describe('useAccounts', () => {
  beforeEach(() => {
    useAccountsStore.setState({ accounts: [], loading: false, error: null });
    (global.fetch as jest.Mock).mockClear();
  });

  it('fetches accounts on mount when autoFetch is true', async () => {
    const mockAccounts = [
      { id: '1', email: 'test1@example.com', status: 'active' as const },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accounts: mockAccounts }),
    });

    const { result } = renderHook(() => useAccounts({ autoFetch: true }));

    await waitFor(() => {
      expect(result.current.accounts).toEqual(mockAccounts);
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/accounts');
  });

  it('does not fetch accounts on mount when autoFetch is false', () => {
    renderHook(() => useAccounts({ autoFetch: false }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns loading state', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    const { result } = renderHook(() => useAccounts());

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
  });

  it('returns error state on fetch failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    });

    const { result } = renderHook(() => useAccounts());

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to fetch accounts: Internal Server Error');
    });
  });

  it('refetch calls fetchAccounts', async () => {
    const mockAccounts = [
      { id: '1', email: 'test1@example.com', status: 'active' as const },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ accounts: mockAccounts }),
    });

    const { result } = renderHook(() => useAccounts({ autoFetch: false }));

    await waitFor(async () => {
      await result.current.refetch();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/accounts');
  });

  it('refreshAccount calls store refreshAccount', async () => {
    const mockAccount = {
      id: '1',
      email: 'test1@example.com',
      status: 'active' as const,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAccount,
    });

    const { result } = renderHook(() => useAccounts({ autoFetch: false }));

    await waitFor(async () => {
      await result.current.refreshAccount('1');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/accounts/1');
  });

  it('returns WebSocket connection status', () => {
    const { result } = renderHook(() => useAccounts());

    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionStatus).toBe('connected');
  });

  it('disables WebSocket when enableWebSocket is false', () => {
    const useWebSocketMock = require('@/hooks/useWebSocket').useWebSocket;

    renderHook(() => useAccounts({ enableWebSocket: false }));

    expect(useWebSocketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: [],
        autoConnect: false,
      })
    );
  });

  it('uses custom websocketUrl when provided', () => {
    const useWebSocketMock = require('@/hooks/useWebSocket').useWebSocket;

    renderHook(() => useAccounts({ websocketUrl: 'ws://custom:9000' }));

    expect(useWebSocketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'ws://custom:9000',
      })
    );
  });

  it('passes authToken to WebSocket', () => {
    const useWebSocketMock = require('@/hooks/useWebSocket').useWebSocket;

    renderHook(() => useAccounts({ authToken: 'test-token' }));

    expect(useWebSocketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: 'test-token',
      })
    );
  });
});
