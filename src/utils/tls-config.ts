/**
 * TLS Configuration Utility
 *
 * Centralized TLS/SSL configuration for all HTTPS clients.
 * Enforces security best practices across the application.
 *
 * Security features:
 * - TLS 1.2+ enforcement (no TLS 1.0/1.1)
 * - Secure cipher suites only (AEAD with forward secrecy)
 * - Certificate chain validation against system trust store
 * - Reject self-signed certificates in production
 * - Custom CA certificate support via KIRO_CA_CERT env var
 * - Connection pooling with keepAlive
 *
 * Usage:
 * ```typescript
 * import { createTLSAgent } from './utils/tls-config.js';
 *
 * const httpsAgent = createTLSAgent();
 * const axiosInstance = axios.create({
 *   httpsAgent,
 *   timeout: 60000,
 * });
 * ```
 */

import * as https from 'https';
import * as fs from 'fs';
import { logger } from '../cli/utils/logger.js';

/**
 * Secure cipher suites for TLS 1.2 and TLS 1.3
 *
 * Selection criteria:
 * - Forward secrecy (ECDHE key exchange)
 * - Authenticated encryption (GCM, ChaCha20-Poly1305)
 * - Excludes: RC4, DES, 3DES, MD5, SHA1-only
 *
 * Prioritizes TLS 1.3 ciphers, falls back to TLS 1.2
 */
const SECURE_CIPHER_SUITES = [
  // TLS 1.3 (preferred - fastest and most secure)
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',

  // TLS 1.2 (fallback - still secure)
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
].join(':');

/**
 * Load custom CA certificate from environment variable
 *
 * Reads certificate from path specified in KIRO_CA_CERT environment variable.
 * Useful for enterprise environments with internal CAs.
 *
 * @returns Array of CA certificates, or undefined if not configured
 */
function loadCustomCA(): Buffer[] | undefined {
  const customCAPath = process.env.KIRO_CA_CERT;

  if (!customCAPath) {
    return undefined;
  }

  try {
    const caContent = fs.readFileSync(customCAPath, 'utf8');

    // Validate PEM format
    if (!caContent.includes('BEGIN CERTIFICATE')) {
      logger.warn('Invalid CA certificate format in KIRO_CA_CERT', {
        path: customCAPath,
      });
      return undefined;
    }

    logger.info('Loaded custom CA certificate', { path: customCAPath });
    return [Buffer.from(caContent, 'utf8')];
  } catch (error: any) {
    logger.warn('Failed to load custom CA certificate', {
      path: customCAPath,
      error: error.message,
    });
    return undefined;
  }
}

/**
 * Check if running in production mode
 *
 * @returns True if NODE_ENV is 'production'
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Create configured HTTPS agent with security hardening
 *
 * Returns an https.Agent configured with:
 * - TLS 1.2+ enforcement
 * - Secure cipher suites
 * - Certificate validation
 * - Custom CA support
 * - Connection pooling
 *
 * @param options - Optional configuration overrides
 * @returns Configured https.Agent instance
 */
export function createTLSAgent(options?: {
  /** Override certificate validation (default: true in production, false in dev) */
  rejectUnauthorized?: boolean;
  /** Custom CA certificates (default: loaded from KIRO_CA_CERT env var) */
  customCA?: Buffer[];
}): https.Agent {
  const customCA = options?.customCA ?? loadCustomCA();
  const rejectUnauthorized = options?.rejectUnauthorized ?? isProduction();

  const agent = new https.Agent({
    // TLS version enforcement
    minVersion: 'TLSv1.2', // Minimum TLS 1.2
    maxVersion: 'TLSv1.3', // Allow TLS 1.3

    // Certificate validation
    rejectUnauthorized, // Reject invalid/self-signed certs in production

    // Cipher suite configuration
    ciphers: SECURE_CIPHER_SUITES,

    // Custom CA certificates (if provided)
    ca: customCA,

    // Connection pooling for performance
    keepAlive: true,
    keepAliveMsecs: 30000, // 30 seconds

    // Connection limits
    maxSockets: 50, // Max concurrent connections per host
    maxFreeSockets: 10, // Max idle connections to keep open
  });

  // Log TLS configuration (non-sensitive info only)
  logger.debug('Created TLS agent', {
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    rejectUnauthorized,
    customCA: !!customCA,
    cipherCount: SECURE_CIPHER_SUITES.split(':').length,
  });

  return agent;
}

/**
 * Get secure cipher suites string
 *
 * Exported for testing and documentation purposes.
 *
 * @returns Colon-separated cipher suite string
 */
export function getSecureCipherSuites(): string {
  return SECURE_CIPHER_SUITES;
}
