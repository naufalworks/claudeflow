/**
 * useWebSocket Hook
 *
 * React hook for managing WebSocket connections in components.
 * Handles connection lifecycle, subscription management, and cleanup.
 */

import { useEffect, useRef, useState } from 'react';
import { getWebSocketClient, WebSocketClient, Channel, ConnectionStatus, ServerMessage } from '../lib/websocket-client';

export interface UseWebSocketOptions {
  url: string;
  authToken?: string;
  channels?: Channel[];
  autoConnect?: boolean;
  onMessage?: (message: ServerMessage) => void;
  onUsageEvent?: (message: ServerMessage) => void;
  onQuotaUpdate?: (message: ServerMessage) => void;
  onAccountStatus?: (message: ServerMessage) => void;
  onError?: (error: Error) => void;
}

export interface UseWebSocketReturn {
  status: ConnectionStatus;
  isConnected: boolean;
  isPolling: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  subscribe: (channels: Channel[]) => void;
  unsubscribe: (channels: Channel[]) => void;
  client: WebSocketClient | null;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const {
    url,
    authToken,
    channels = [],
    autoConnect = true,
    onMessage,
    onUsageEvent,
    onQuotaUpdate,
    onAccountStatus,
    onError,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [isPolling, setIsPolling] = useState(false);
  const clientRef = useRef<WebSocketClient | null>(null);
  const channelsRef = useRef<Channel[]>(channels);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    // Initialize client
    try {
      clientRef.current = getWebSocketClient({ url, authToken });
    } catch (error) {
      console.error('Failed to initialize WebSocket client:', error);
      return;
    }

    const client = clientRef.current;
    const currentStatus = client.getStatus();
    setStatus(currentStatus);
    setIsPolling(client.isPollingActive());

    // Set up event listeners
    const handleStatusChange = (newStatus: ConnectionStatus) => {
      if (mountedRef.current) {
        setStatus(newStatus);
      }
    };

    const handleMessage = (message: ServerMessage) => {
      if (mountedRef.current && onMessage) {
        onMessage(message);
      }
    };

    const handleUsageEvent = (message: ServerMessage) => {
      if (mountedRef.current && onUsageEvent) {
        onUsageEvent(message);
      }
    };

    const handleQuotaUpdate = (message: ServerMessage) => {
      if (mountedRef.current && onQuotaUpdate) {
        onQuotaUpdate(message);
      }
    };

    const handleAccountStatus = (message: ServerMessage) => {
      if (mountedRef.current && onAccountStatus) {
        onAccountStatus(message);
      }
    };

    const handleError = (error: Error) => {
      if (mountedRef.current && onError) {
        onError(error);
      }
    };

    const handlePollingStarted = () => {
      if (mountedRef.current) {
        setIsPolling(true);
      }
    };

    client.on('status_change', handleStatusChange);
    client.on('message', handleMessage);
    client.on('usage_event', handleUsageEvent);
    client.on('quota_update', handleQuotaUpdate);
    client.on('account_status', handleAccountStatus);
    client.on('error', handleError);
    client.on('polling_started', handlePollingStarted);

    // Auto-connect if enabled. Connection errors are handled by client reconnect state.
    if (autoConnect) {
      void client.connect();
    }

    // Subscribe to channels
    if (channelsRef.current.length > 0) {
      client.subscribe(channelsRef.current);
    }

    // Cleanup on unmount
    return () => {
      client.off('status_change', handleStatusChange);
      client.off('message', handleMessage);
      client.off('usage_event', handleUsageEvent);
      client.off('quota_update', handleQuotaUpdate);
      client.off('account_status', handleAccountStatus);
      client.off('error', handleError);
      client.off('polling_started', handlePollingStarted);

      // Keep the shared WebSocket connection/subscriptions alive across route changes.
      // Unsubscribing here makes the singleton lose channels when pages remount after mutations.
    };
  }, [url, authToken, autoConnect, onMessage, onUsageEvent, onQuotaUpdate, onAccountStatus, onError]);

  // Update subscriptions when channels change
  useEffect(() => {
    if (clientRef.current && channels.length > 0) {
      clientRef.current.subscribe(channels);
    }
  }, [channels]);

  const connect = async () => {
    if (clientRef.current) {
      await clientRef.current.connect();
    }
  };

  const disconnect = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
  };

  const subscribe = (newChannels: Channel[]) => {
    if (clientRef.current) {
      clientRef.current.subscribe(newChannels);
    }
  };

  const unsubscribe = (channelsToRemove: Channel[]) => {
    if (clientRef.current) {
      clientRef.current.unsubscribe(channelsToRemove);
    }
  };

  return {
    status,
    isConnected: status === 'connected',
    isPolling,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    client: clientRef.current,
  };
}
