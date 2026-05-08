/**
 * Dashboard WebSocket Client Type Definitions
 *
 * Defines the configuration, connection status, and reconnection info
 * for the dashboard WebSocket client.
 *
 * Requirements: 6.2, 6.3, 6.4, 6.5, 13.1, 13.2, 13.3, 13.4, 17.3, 17.4
 */

import { Channel } from './RealTimeUpdateService.types.js';

/** Configuration for the DashboardWebSocketClient */
export interface DashboardClientConfig {
  /** WebSocket server URL (ws:// or wss://) */
  url: string;
  /** Authentication token (optional — sent after connection if provided) */
  authToken?: string;
  /** Heartbeat interval in seconds (default: 30) */
  heartbeatInterval: number;
  /** Maximum reconnection attempts before falling back to polling (default: 5) */
  maxReconnectAttempts: number;
  /** Initial reconnection delay in milliseconds (default: 1000) */
  initialReconnectDelay: number;
  /** Maximum reconnection delay in milliseconds (default: 30000) */
  maxReconnectDelay: number;
  /** Polling interval in milliseconds when WebSocket is unavailable (default: 5000) */
  pollingInterval: number;
  /** Maximum number of channel subscriptions (default: 50) */
  maxSubscriptions: number;
}

/** Connection status of the dashboard client */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'polling';

/** Information about the current reconnection attempt */
export interface ReconnectionInfo {
  /** Current attempt number (1-based) */
  attempt: number;
  /** Delay before this reconnection attempt in ms */
  delay: number;
}

/** Default configuration values */
export const DEFAULT_DASHBOARD_CLIENT_CONFIG: DashboardClientConfig = {
  url: 'ws://localhost:8080',
  heartbeatInterval: 30,
  maxReconnectAttempts: 5,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  pollingInterval: 5000,
  maxSubscriptions: 50,
};

export type { Channel };
