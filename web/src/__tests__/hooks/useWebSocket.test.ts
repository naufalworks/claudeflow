import { renderHook, waitFor } from '@testing-library/react';
import { useWebSocket } from '@/hooks/useWebSocket';

// Mock the WebSocket client
const mockClient = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

jest.mock('@/lib/websocket-client', () => ({
  getWebSocketClient: jest.fn(() => mockClient),
}));

describe('useWebSocket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes WebSocket client with provided options', () => {
    const { getWebSocketClient } = require('@/lib/websocket-client');

    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        authToken: 'test-token',
      })
    );

    expect(getWebSocketClient).toHaveBeenCalledWith({
      url: 'ws://localhost:8080',
      authToken: 'test-token',
    });
  });

  it('auto-connects when autoConnect is true', () => {
    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        autoConnect: true,
      })
    );

    expect(mockClient.connect).toHaveBeenCalled();
  });

  it('does not auto-connect when autoConnect is false', () => {
    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        autoConnect: false,
      })
    );

    expect(mockClient.connect).not.toHaveBeenCalled();
  });

  it('subscribes to channels on mount', () => {
    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        channels: ['accounts', 'usage'],
      })
    );

    expect(mockClient.subscribe).toHaveBeenCalledWith(['accounts', 'usage']);
  });

  it('sets up event listeners', () => {
    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    expect(mockClient.on).toHaveBeenCalledWith('status_change', expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith('usage_event', expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith('quota_update', expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith('account_status', expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockClient.on).toHaveBeenCalledWith('polling_started', expect.any(Function));
  });

  it('cleans up event listeners on unmount', () => {
    const { unmount } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    unmount();

    expect(mockClient.off).toHaveBeenCalledWith('status_change', expect.any(Function));
    expect(mockClient.off).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockClient.off).toHaveBeenCalledWith('usage_event', expect.any(Function));
    expect(mockClient.off).toHaveBeenCalledWith('quota_update', expect.any(Function));
    expect(mockClient.off).toHaveBeenCalledWith('account_status', expect.any(Function));
    expect(mockClient.off).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockClient.off).toHaveBeenCalledWith('polling_started', expect.any(Function));
  });

  it('unsubscribes from channels on unmount', () => {
    const { unmount } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        channels: ['accounts', 'usage'],
      })
    );

    unmount();

    expect(mockClient.unsubscribe).toHaveBeenCalledWith(['accounts', 'usage']);
  });

  it('provides connect method', async () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        autoConnect: false,
      })
    );

    await result.current.connect();

    expect(mockClient.connect).toHaveBeenCalled();
  });

  it('provides disconnect method', () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    result.current.disconnect();

    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('provides subscribe method', () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    result.current.subscribe(['new-channel']);

    expect(mockClient.subscribe).toHaveBeenCalledWith(['new-channel']);
  });

  it('provides unsubscribe method', () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    result.current.unsubscribe(['old-channel']);

    expect(mockClient.unsubscribe).toHaveBeenCalledWith(['old-channel']);
  });

  it('returns client instance', () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    expect(result.current.client).toBe(mockClient);
  });

  it('returns initial status as disconnected', () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        autoConnect: false,
      })
    );

    expect(result.current.status).toBe('disconnected');
    expect(result.current.isConnected).toBe(false);
  });

  it('handles status change events', async () => {
    let statusChangeHandler: ((status: string) => void) | undefined;

    mockClient.on.mockImplementation((event, handler) => {
      if (event === 'status_change') {
        statusChangeHandler = handler;
      }
    });

    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    // Simulate status change
    if (statusChangeHandler) {
      statusChangeHandler('connected');
    }

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
      expect(result.current.isConnected).toBe(true);
    });
  });

  it('handles polling started event', async () => {
    let pollingStartedHandler: (() => void) | undefined;

    mockClient.on.mockImplementation((event, handler) => {
      if (event === 'polling_started') {
        pollingStartedHandler = handler;
      }
    });

    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
      })
    );

    // Simulate polling started
    if (pollingStartedHandler) {
      pollingStartedHandler();
    }

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true);
    });
  });

  it('calls onMessage callback when message is received', () => {
    const onMessage = jest.fn();
    let messageHandler: ((message: unknown) => void) | undefined;

    mockClient.on.mockImplementation((event, handler) => {
      if (event === 'message') {
        messageHandler = handler;
      }
    });

    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        onMessage,
      })
    );

    const testMessage = { type: 'test', data: {} };
    if (messageHandler) {
      messageHandler(testMessage);
    }

    expect(onMessage).toHaveBeenCalledWith(testMessage);
  });

  it('calls onError callback when error occurs', () => {
    const onError = jest.fn();
    let errorHandler: ((error: Error) => void) | undefined;

    mockClient.on.mockImplementation((event, handler) => {
      if (event === 'error') {
        errorHandler = handler;
      }
    });

    renderHook(() =>
      useWebSocket({
        url: 'ws://localhost:8080',
        onError,
      })
    );

    const testError = new Error('Test error');
    if (errorHandler) {
      errorHandler(testError);
    }

    expect(onError).toHaveBeenCalledWith(testError);
  });
});
