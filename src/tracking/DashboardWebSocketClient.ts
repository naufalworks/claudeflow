/**
 * Dashboard WebSocket Client
 *
 * WebSocket client that connects to the RealTimeUpdateService for real-time
 * usage tracking updates. Supports automatic reconnection with exponential
 * backoff, heartbeat, and polling fallback.
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5, 13.1, 13.2, 13.3, 13.4, 17.3, 17.4
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  DashboardClientConfig,
  ConnectionStatus,
  ReconnectionInfo,
  DEFAULT_DASHBOARD_CLIENT_CONFIG,
} from './DashboardWebSocketClient.types.js';
import { Channel, ServerMessage } from './RealTimeUpdateService.types.js';

/**
 * Dashboard WebSocket Client
 *
 * Connects to the RealTimeUpdateService WebSocket server, subscribes to
 * usage/quota/accounts channels, handles reconnection with exponential
 * backoff, and falls back to polling when WebSocket is unavailable.
 */
export class DashboardWebSocketClient extends EventEmitter {
  private config: DashboardClientConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private subscriptions: Set<string> = new Set();
  private _status: ConnectionStatus = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollingTimer: NodeJS.Timeout | null = null;
  private intentionallyDisconnected = false;
  private isPolling = false;

  constructor(config?: Partial<DashboardClientConfig>) {
    super();
    const merged = { ...DEFAULT_DASHBOARD_CLIENT_CONFIG, ...config };
    this.validateUrl(merged.url);
    this.config = merged;
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  /**
   * Establish a WebSocket connection to the server.
   * Resolves when the connection is open and ready.
   */
  connect(): Promise<void> {
    if (this._status === 'connected' || this._status === 'connecting') {
      return Promise.resolve();
    }

    this.intentionallyDisconnected = false;
    this.setStatus('connecting');

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
      } catch (error) {
        this.setStatus('disconnected');
        reject(error);
        return;
      }

      this.ws.on('open', () => this.handleOpen(resolve));
      this.ws.on('message', (data: WebSocket.Data) => this.handleMessage(data));
      this.ws.on('close', () => this.handleClose());
      this.ws.on('error', (err: Error) => this.handleError(err, reject));
    });
  }

  /**
   * Cleanly disconnect from the server.
   * Stops all timers and marks the disconnect as intentional.
   */
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
    this.emit('disconnected');
  }

  /**
   * Subscribe to the specified channels.
   * Sends a subscribe message immediately if connected; otherwise stores
   * channels for re-subscription on next connect.
   */
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

  /**
   * Unsubscribe from the specified channels.
   * Sends an unsubscribe message immediately if connected.
   */
  unsubscribe(channels: Channel[]): void {
    for (const ch of channels) {
      this.subscriptions.delete(ch);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', channels });
    }
  }

  /** Get the current connection status. */
  getStatus(): ConnectionStatus {
    return this._status;
  }

  /** Get the list of current channel subscriptions. */
  getSubscriptions(): string[] {
    return [...this.subscriptions];
  }

  /** Check if polling fallback is active. */
  isPollingActive(): boolean {
    return this.isPolling;
  }

  // ---------------------------------------------------------------------------
  // Private Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle the WebSocket 'open' event.
   * Resets reconnect attempts, optionally authenticates, re-subscribes,
   * starts heartbeat, and emits 'connected'.
   */
  private handleOpen(resolve: () => void): void {
    this.reconnectAttempts = 0;
    this.setStatus('connected');

    // Send auth if configured
    if (this.config.authToken) {
      this.send({ type: 'auth', token: this.config.authToken });
    }

    // Re-subscribe to stored channels
    this.resubscribe();

    // Start heartbeat
    this.startHeartbeat();

    this.emit('connected');
    resolve();
  }

  /**
   * Handle an incoming WebSocket message.
   * Parses JSON safely and emits typed events.
   */
  private handleMessage(data: WebSocket.Data): void {
    let message: ServerMessage;
    const raw =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf-8')
          : String(data);
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      // Invalid JSON — log error and return without crashing
      console.error('DashboardWebSocketClient: invalid JSON message received');
      return;
    }

    // Emit raw message event
    this.emit('message', message);

    // Emit typed events based on message type
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
        this.emit('pong');
        break;
    }
  }

  /**
   * Handle the WebSocket 'close' event.
   * Stops heartbeat and initiates reconnection if not intentional.
   */
  private handleClose(): void {
    this.stopHeartbeat();
    this.ws = null;

    if (!this.intentionallyDisconnected) {
      this.reconnect();
    }
  }

  /**
   * Handle the WebSocket 'error' event.
   * Emits an 'error' event for consumers to handle.
   */
  private handleError(err: Error, reject?: (error: Error) => void): void {
    this.emit('error', err);
    if (reject) {
      reject(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Reconnection Logic — Req 6.2, 6.3, 6.4, 6.5
  // ---------------------------------------------------------------------------

  /**
   * Attempt reconnection with exponential backoff.
   * Falls back to polling after max attempts.
   */
  private reconnect(): void {
    if (this.intentionallyDisconnected) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.startPolling();
      return;
    }

    this.reconnectAttempts++;
    this.setStatus('reconnecting');

    // Exponential backoff: delay = min(initialDelay * 2^(attempt-1), maxDelay)
    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.config.maxReconnectDelay
    );

    const info: ReconnectionInfo = {
      attempt: this.reconnectAttempts,
      delay,
    };

    this.emit('reconnecting', info);

    this.reconnectTimer = setTimeout(() => {
      // Check again in case disconnect() was called while waiting
      if (this.intentionallyDisconnected) {
        return;
      }
      this.connect().catch(() => {
        // connect() rejection is handled by handleError;
        // reconnect will be triggered again by handleClose
      });
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Polling Fallback — Req 17.3, 17.4
  // ---------------------------------------------------------------------------

  /**
   * Start polling fallback when WebSocket reconnection fails.
   * Emits 'poll' events at the configured polling interval.
   */
  private startPolling(): void {
    this.setStatus('polling');
    this.isPolling = true;
    this.emit('polling_started');

    this.pollingTimer = setInterval(() => {
      this.emit('poll');
    }, this.config.pollingInterval);
  }

  /** Stop the polling fallback. */
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

  /** Start sending ping messages at the configured heartbeat interval. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, this.config.heartbeatInterval * 1000);
  }

  /** Stop the heartbeat timer. */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Re-subscribe to all stored channels. */
  private resubscribe(): void {
    if (this.subscriptions.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'subscribe',
        channels: [...this.subscriptions] as Channel[],
      });
    }
  }

  /** Send a JSON message to the server. */
  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('DashboardWebSocketClient: failed to send message', error);
      }
    }
  }

  /** Clean up all active timers. */
  private cleanupTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }

  /** Update status and emit a status_change event. */
  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit('status_change', status);
    }
  }

  /**
   * Validate the WebSocket URL format.
   * Must start with ws:// or wss://.
   */
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
