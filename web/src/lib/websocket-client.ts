/**
 * WebSocket Client Wrapper for Browser
 *
 * Browser-compatible wrapper around the WebSocket API that provides:
 * - Automatic reconnection with exponential backoff
 * - Polling fallback when WebSocket is unavailable
 * - Event-based message handling
 * - Singleton pattern for shared connection
 *
 * Adapts the server-side DashboardWebSocketClient for browser use.
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'polling';

export type Channel = 'usage' | 'quota' | 'accounts';

export interface WebSocketConfig {
  url: string;
  authToken?: string;
  heartbeatInterval?: number;
  maxReconnectAttempts?: number;
  initialReconnectDelay?: number;
  maxReconnectDelay?: number;
  pollingInterval?: number;
  maxSubscriptions?: number;
}

export interface ServerMessage {
  type: 'usage_event' | 'quota_update' | 'account_status' | 'pong';
  data?: Record<string, unknown>;
}

export interface ReconnectionInfo {
  attempt: number;
  delay: number;
}

type EventCallback = (data: any) => void;

function getConfigKey(config: Pick<WebSocketConfig, 'url' | 'authToken'>): string {
  return `${config.url}|${config.authToken || ''}`;
}

const DEFAULT_CONFIG: Required<Omit<WebSocketConfig, 'authToken'>> = {
  url: 'ws://127.0.0.1:3130',
  heartbeatInterval: 30000,
  maxReconnectAttempts: 5,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  pollingInterval: 10000, // Increased from 5s to 10s for better performance
  maxSubscriptions: 50,
};

export class WebSocketClient {
  private config: Required<WebSocketConfig>;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private subscriptions: Set<string> = new Set();
  private status: ConnectionStatus = 'disconnected';
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private pollingTimer: number | null = null;
  private intentionallyDisconnected = false;
  private isPolling = false;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private lastPongTime = 0;
  private missedPongs = 0;
  private readonly MAX_MISSED_PONGS = 3;

  constructor(config: WebSocketConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      authToken: config.authToken || '',
    };
    this.validateUrl(this.config.url);
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return Promise.resolve();
    }

    this.intentionallyDisconnected = false;
    this.setStatus('connecting');

    return new Promise<void>((resolve) => {
      try {
        this.ws = new WebSocket(this.config.url);
      } catch {
        this.setStatus('disconnected');
        this.reconnect();
        resolve();
        return;
      }

      this.ws.onopen = () => this.handleOpen(resolve);
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onclose = () => this.handleClose();
      this.ws.onerror = () => this.handleError();
    });
  }

  disconnect(): void {
    this.intentionallyDisconnected = true;
    this.cleanupTimers();
    this.stopPolling();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.setStatus('disconnected');
    this.emit('disconnected', undefined);
  }

  subscribe(channels: Channel[]): void {
    for (const ch of channels) {
      if (this.subscriptions.size >= this.config.maxSubscriptions) {
        break;
      }
      this.subscriptions.add(ch);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channels: [...this.subscriptions] });
    }
  }

  unsubscribe(channels: Channel[]): void {
    for (const ch of channels) {
      this.subscriptions.delete(ch);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', channels });
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSubscriptions(): string[] {
    return [...this.subscriptions];
  }

  getConfigKey(): string {
    return getConfigKey(this.config);
  }

  isPollingActive(): boolean {
    return this.isPolling;
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  // ---------------------------------------------------------------------------
  // Private Handlers
  // ---------------------------------------------------------------------------

  private handleOpen(resolve: () => void): void {
    this.reconnectAttempts = 0;
    this.setStatus('connected');

    if (this.config.authToken) {
      this.send({ type: 'auth', token: this.config.authToken });
    }

    this.resubscribe();
    this.startHeartbeat();

    this.emit('connected', undefined);
    resolve();
  }

  private handleMessage(event: MessageEvent): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      console.error('WebSocketClient: invalid JSON message received');
      return;
    }

    this.emit('message', message);

    switch (message.type) {
      case 'usage_event':
        this.emit('usage_event', message);
        break;
      case 'quota_update':
        this.emit('quota_update', message);
        break;
      case 'account_status':
        this.emit('account_status', message);
        break;
      case 'pong':
        this.lastPongTime = Date.now();
        this.missedPongs = 0;
        this.emit('pong', undefined);
        break;
    }
  }

  private handleClose(): void {
    this.stopHeartbeat();
    this.ws = null;

    if (!this.intentionallyDisconnected) {
      this.reconnect();
    }
  }

  private handleError(): void {
    // Browser WebSocket errors are often transient during API/WS startup.
    // Let close/reconnect drive state changes; avoid throwing/rejecting noisy stack traces.
    this.emit('connection_error', { url: this.config.url, status: this.status });
  }

  // ---------------------------------------------------------------------------
  // Reconnection Logic
  // ---------------------------------------------------------------------------

  private reconnect(): void {
    if (this.intentionallyDisconnected) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.reconnectAttempts = 0;
    }

    this.reconnectAttempts++;
    this.setStatus('reconnecting');

    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay
    );

    const info: ReconnectionInfo = {
      attempt: this.reconnectAttempts,
      delay,
    };

    this.emit('reconnecting', info);

    this.reconnectTimer = window.setTimeout(() => {
      if (this.intentionallyDisconnected) {
        return;
      }
      this.connect().catch(() => {
        // Error handled by handleError
      });
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Polling Fallback
  // ---------------------------------------------------------------------------

  private startPolling(): void {
    this.setStatus('polling');
    this.isPolling = true;
    this.emit('polling_started', undefined);

    this.pollingTimer = window.setInterval(() => {
      this.emit('poll', undefined);
    }, this.config.pollingInterval);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.isPolling = false;
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();
    this.missedPongs = 0;

    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check if we've missed too many pongs
        const timeSinceLastPong = Date.now() - this.lastPongTime;
        if (timeSinceLastPong > this.config.heartbeatInterval * 2) {
          this.missedPongs++;
          if (this.missedPongs >= this.MAX_MISSED_PONGS) {
            console.warn('WebSocketClient: Connection appears dead, reconnecting...');
            this.ws.close();
            return;
          }
        }

        this.send({ type: 'ping' });
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resubscribe(): void {
    if (this.subscriptions.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'subscribe',
        channels: [...this.subscriptions],
      });
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('WebSocketClient: failed to send message', error);
      }
    }
  }

  private cleanupTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status_change', status);
    }
  }

  private emit(event: string, data: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} callback:`, error);
        }
      });
    }
  }

  private validateUrl(url: string): void {
    const trimmed = url.trim();
    if (!trimmed.startsWith('ws://') && !trimmed.startsWith('wss://')) {
      throw new Error(`Invalid WebSocket URL: "${url}". Must start with ws:// or wss://`);
    }

    try {
      new URL(trimmed);
    } catch {
      throw new Error(`Invalid WebSocket URL: "${url}"`);
    }
  }
}

// Singleton instance
let instance: WebSocketClient | null = null;

export function getWebSocketClient(config?: WebSocketConfig): WebSocketClient {
  if (!instance && config) {
    instance = new WebSocketClient(config);
  }
  if (instance && config && instance.getConfigKey() !== getConfigKey(config)) {
    instance.disconnect();
    instance = new WebSocketClient(config);
  }
  if (!instance) {
    throw new Error('WebSocketClient not initialized. Call getWebSocketClient with config first.');
  }
  return instance;
}

export function resetWebSocketClient(): void {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}
