/**
 * Real-Time Update Service Type Definitions
 *
 * Defines the configuration, client info, channels, and message types
 * for the WebSocket-based real-time update service.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 18.1, 18.2, 18.3
 */

/** Configuration for the Real-Time Update Service */
export interface RealTimeConfig {
  /** Server port (default: 3130) */
  port: number;
  /** Authentication token (optional - if not set, no auth required) */
  authToken?: string;
  /** Event batch interval in ms (default: 100) */
  batchInterval: number;
  /** Max events per batch (default: 10) */
  maxBatchSize: number;
  /** Max message payload in bytes (default: 10240 = 10KB) */
  maxPayload: number;
  /** Max subscriptions per client (default: 50) */
  maxSubscriptions: number;
  /** Max concurrent connections (default: 1000) */
  maxConnections: number;
  /** Heartbeat interval in seconds (default: 30) */
  heartbeatInterval: number;
  /** Rate limit: max messages per second per connection (default: 100) */
  rateLimitPerSecond: number;
}

/** Default configuration values */
export const DEFAULT_REALTIME_CONFIG: RealTimeConfig = {
  port: 3130,
  batchInterval: 100,
  maxBatchSize: 10,
  maxPayload: 10240,
  maxSubscriptions: 50,
  maxConnections: 1000,
  heartbeatInterval: 30,
  rateLimitPerSecond: 100,
};

/** Client connection info tracked by the server */
export interface ClientInfo {
  /** Whether the client has authenticated successfully */
  authenticated: boolean;
  /** Set of channel names the client is subscribed to */
  subscriptions: Set<string>;
  /** Number of messages in the current rate-limit window */
  messageCount: number;
  /** Timestamp of the current rate-limit window start */
  windowStart: number;
  /** Interval handle for heartbeat ping */
  heartbeatInterval: NodeJS.Timeout | null;
  /** Connection timestamp */
  connectedAt: Date;
}

/** Valid channel names for subscriptions */
export type Channel = 'usage' | 'quota' | 'accounts';

/** Client → Server messages */
export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; channels: Channel[] }
  | { type: 'unsubscribe'; channels: Channel[] }
  | { type: 'ping' };

/** Server → Client message: usage event */
export interface UsageEventMessage {
  type: 'usage_event';
  data: Record<string, unknown>;
}

/** Server → Client message: quota update */
export interface QuotaUpdateMessage {
  type: 'quota_update';
  data: Record<string, unknown>;
}

/** Server → Client message: account status change */
export interface AccountStatusMessage {
  type: 'account_status';
  data: Record<string, unknown>;
}

/** Server → Client message: pong response */
export interface PongMessage {
  type: 'pong';
}

/** Union of all Server → Client messages */
export type ServerMessage =
  | UsageEventMessage
  | QuotaUpdateMessage
  | AccountStatusMessage
  | PongMessage;
