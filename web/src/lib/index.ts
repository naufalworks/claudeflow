/**
 * Lib Exports
 *
 * Central export point for library utilities.
 */

export { WebSocketClient, getWebSocketClient, resetWebSocketClient } from './websocket-client';

export type {
  ConnectionStatus,
  Channel,
  WebSocketConfig,
  ServerMessage,
  ReconnectionInfo
} from './websocket-client';
