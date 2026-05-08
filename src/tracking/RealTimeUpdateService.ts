/**
 * Real-Time Update Service
 *
 * WebSocket server that pushes usage events, quota updates, and account status
 * changes to connected dashboards in real-time. Supports token-based
 * authentication, rate limiting, heartbeat, and event batching.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 16.3, 18.1, 18.2, 18.3
 */

import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import {
  RealTimeConfig,
  ClientInfo,
  ClientMessage,
  ServerMessage,
  DEFAULT_REALTIME_CONFIG,
  Channel,
} from './RealTimeUpdateService.types.js';

/** Maps message type to the channel that carries it */
const MESSAGE_TYPE_TO_CHANNEL: Record<string, Channel> = {
  usage_event: 'usage',
  quota_update: 'quota',
  account_status: 'accounts',
};

/**
 * Real-Time Update Service
 *
 * Extends EventEmitter to emit lifecycle events (started, stopped,
 * client_connected, client_disconnected). Provides methods to push
 * usage events, quota updates, and account status changes to
 * subscribed WebSocket clients.
 */
export class RealTimeUpdateService extends EventEmitter {
  private config: RealTimeConfig;
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private eventBatch: ServerMessage[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config?: Partial<RealTimeConfig>) {
    super();
    this.config = { ...DEFAULT_REALTIME_CONFIG, ...config };
  }

  /**
   * Start the WebSocket server and begin listening for connections.
   * Sets up batch flush timer and connection handler.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.wss = new WebSocketServer({
      port: this.config.port,
      maxPayload: this.config.maxPayload,
    });

    this.running = true;

    await new Promise<void>((resolve) => {
      this.wss!.on('listening', () => {
        this.startBatchTimer();
        this.emit('started');
        resolve();
      });
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.wss.on('error', (error: Error) => {
      console.error('WebSocket server error:', error);
    });
  }

  /**
   * Stop the WebSocket server gracefully.
   * Closes all client connections, clears timers, and closes the server.
   */
  async stop(): Promise<void> {
    if (!this.running || !this.wss) {
      return;
    }

    this.running = false;

    // Clear batch timer
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    // Close all client connections and clear their heartbeat timers
    for (const [ws, info] of this.clients) {
      if (info.heartbeatInterval) {
        clearInterval(info.heartbeatInterval);
      }
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // Ignore close errors during shutdown
      }
    }
    this.clients.clear();

    // Close server
    await new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.emit('stopped');
          resolve();
        });
        this.wss = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Emit a usage event to all clients subscribed to the 'usage' channel.
   *
   * @param event - Usage event data
   */
  emitUsageEvent(event: Record<string, unknown>): void {
    this.addToBatch({ type: 'usage_event', data: event });
  }

  /**
   * Emit a quota update to all clients subscribed to the 'quota' channel.
   *
   * @param update - Quota update data
   */
  emitQuotaUpdate(update: Record<string, unknown>): void {
    this.addToBatch({ type: 'quota_update', data: update });
  }

  /**
   * Emit an account status change to all clients subscribed to the 'accounts' channel.
   *
   * @param change - Account status change data
   */
  emitAccountStatusChange(change: Record<string, unknown>): void {
    this.addToBatch({ type: 'account_status', data: change });
  }

  /**
   * Get the number of currently connected clients.
   */
  getConnectedClientCount(): number {
    return this.clients.size;
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Handle a new WebSocket connection.
   * Enforces max connections, sets up message/close handlers,
   * and optionally auto-authenticates when no auth token is configured.
   */
  private handleConnection(ws: WebSocket): void {
    // Enforce max connections limit
    if (this.clients.size >= this.config.maxConnections) {
      ws.close(1008, 'Max connections exceeded');
      return;
    }

    const clientInfo: ClientInfo = {
      authenticated: !this.config.authToken,
      subscriptions: new Set(),
      messageCount: 0,
      windowStart: Date.now(),
      heartbeatInterval: null,
      connectedAt: new Date(),
    };

    this.clients.set(ws, clientInfo);

    // Set up heartbeat (Requirement 6.1)
    this.setupHeartbeat(ws, clientInfo);

    // Emit client_connected event
    this.emit('client_connected', { count: this.clients.size });

    ws.on('message', (data: Buffer) => {
      this.handleMessage(ws, data, clientInfo);
    });

    ws.on('close', () => {
      this.handleDisconnect(ws, clientInfo);
    });

    ws.on('error', (error: Error) => {
      console.error('WebSocket client error:', error);
    });
  }

  /**
   * Set up periodic heartbeat pings for a client.
   * The ws library automatically handles pong responses.
   */
  private setupHeartbeat(ws: WebSocket, info: ClientInfo): void {
    info.heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, this.config.heartbeatInterval * 1000);
  }

  /**
   * Handle an incoming message from a client.
   * Parses JSON, checks rate limits, enforces auth, and dispatches.
   */
  private handleMessage(ws: WebSocket, data: Buffer, info: ClientInfo): void {
    // Check rate limit (Requirement 18.3)
    if (!this.checkRateLimit(ws, info)) {
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      // JSON parse errors → log and ignore
      console.error('Invalid JSON message received');
      return;
    }

    // If auth is required, enforce it (Requirement 18.1)
    if (this.config.authToken && !info.authenticated) {
      if (message.type !== 'auth') {
        ws.close(1008, 'Invalid authentication');
        return;
      }
      this.authenticateClient(ws, message, info);
      return;
    }

    // Dispatch message
    switch (message.type) {
      case 'auth':
        // Auth when not required is a no-op (already authenticated)
        break;
      case 'subscribe':
        this.handleSubscribe(ws, message, info);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(ws, message, info);
        break;
      case 'ping':
        this.sendToClient(ws, { type: 'pong' });
        break;
    }
  }

  /**
   * Authenticate a client using constant-time token comparison.
   *
   * Requirements: 18.1, 18.2
   */
  private authenticateClient(
    ws: WebSocket,
    message: Extract<ClientMessage, { type: 'auth' }>,
    info: ClientInfo
  ): void {
    const isValid = this.validateToken(message.token);
    if (isValid) {
      info.authenticated = true;
    } else {
      ws.close(1008, 'Invalid authentication');
    }
  }

  /**
   * Validate an authentication token using constant-time comparison.
   * Uses crypto.timingSafeEqual to prevent timing attacks.
   */
  private validateToken(token: string): boolean {
    if (!this.config.authToken) {
      return true;
    }

    const tokenBuffer = Buffer.from(token, 'utf-8');
    const expectedBuffer = Buffer.from(this.config.authToken, 'utf-8');

    // Lengths must match for timing-safe comparison
    if (tokenBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
  }

  /**
   * Check rate limit for a client using a sliding window.
   * Closes the connection if the limit is exceeded.
   *
   * Requirement: 18.3
   */
  private checkRateLimit(ws: WebSocket, info: ClientInfo): boolean {
    const now = Date.now();

    // Reset window every second
    if (now - info.windowStart > 1000) {
      info.messageCount = 0;
      info.windowStart = now;
    }

    info.messageCount++;

    if (info.messageCount > this.config.rateLimitPerSecond) {
      ws.close(1008, 'Rate limit exceeded');
      return false;
    }

    return true;
  }

  /**
   * Handle a subscribe message from a client.
   * Adds requested channels up to the max subscriptions limit.
   */
  private handleSubscribe(
    _ws: WebSocket,
    message: Extract<ClientMessage, { type: 'subscribe' }>,
    info: ClientInfo
  ): void {
    for (const channel of message.channels) {
      if (info.subscriptions.size >= this.config.maxSubscriptions) {
        break;
      }
      info.subscriptions.add(channel);
    }
  }

  /**
   * Handle an unsubscribe message from a client.
   * Removes the specified channels from the client's subscriptions.
   */
  private handleUnsubscribe(
    _ws: WebSocket,
    message: Extract<ClientMessage, { type: 'unsubscribe' }>,
    info: ClientInfo
  ): void {
    for (const channel of message.channels) {
      info.subscriptions.delete(channel);
    }
  }

  /**
   * Handle client disconnection.
   * Cleans up heartbeat intervals and removes the client from the map.
   */
  private handleDisconnect(ws: WebSocket, info: ClientInfo): void {
    if (info.heartbeatInterval) {
      clearInterval(info.heartbeatInterval);
    }
    this.clients.delete(ws);
    this.emit('client_disconnected', { count: this.clients.size });
  }

  /**
   * Add a message to the event batch.
   * Respects maxBatchSize by dropping excess events.
   */
  private addToBatch(message: ServerMessage): void {
    if (this.eventBatch.length >= this.config.maxBatchSize) {
      return;
    }
    this.eventBatch.push(message);
  }

  /**
   * Start the periodic batch flush timer.
   * Flushes accumulated events every batchInterval milliseconds.
   */
  private startBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }

    this.batchTimer = setInterval(() => {
      this.flushBatch();
    }, this.config.batchInterval);
  }

  /**
   * Flush the current event batch to all subscribed clients.
   * Routes each event to only those clients subscribed to the relevant channel.
   * Clears the batch after sending.
   *
   * Requirements: 5.2, 5.3, 5.4, 5.5
   */
  private flushBatch(): void {
    if (this.eventBatch.length === 0) {
      return;
    }

    const batch = [...this.eventBatch];
    this.eventBatch = [];

    for (const message of batch) {
      const channel = MESSAGE_TYPE_TO_CHANNEL[message.type];
      if (!channel) continue;

      for (const [ws, info] of this.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (!info.authenticated) continue;
        if (!info.subscriptions.has(channel)) continue;

        this.sendToClient(ws, message);
      }
    }
  }

  /**
   * Safely send a message to a WebSocket client.
   * Catches and logs any send errors to prevent server crashes.
   */
  private sendToClient(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message to client:', error);
    }
  }
}
