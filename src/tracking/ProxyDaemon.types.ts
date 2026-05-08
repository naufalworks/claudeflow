/**
 * Type definitions for ProxyDaemon
 *
 * Defines types for daemon configuration and status.
 */

export interface DaemonConfig {
  pidFilePath: string;
  shutdownTimeout: number; // milliseconds
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  pidFile: string;
  uptime?: number; // milliseconds since daemon started
}
