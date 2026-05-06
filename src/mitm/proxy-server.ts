/**
 * MITM Proxy Server
 *
 * HTTPS proxy server that intercepts Kiro API requests and forwards them
 * to ClaudeFlow's account pool manager
 * - Runs on port 443 (requires root/admin)
 * - Intercepts q.*.amazonaws.com domains
 * - Uses account pool for smart routing
 * - Returns native Anthropic format
 */

import https from 'https';
import { promises as fs } from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { CertificateManager } from './certificate-manager.js';
import { AccountPoolManager } from '../accounts/account-pool-manager.js';
import { KiroAPIClient } from '../clients/KiroAPIClient.js';
import { KeychainStore } from '../auth/KeychainStore.js';
import { ConfigurationManager } from '../config/manager.js';
import type { KiroOAuthAccount } from '../config/schema.js';
import type { KiroAPIConfig } from '../types/kiro-oauth.types.js';
import { saveRequestUsage } from '../lib/usageDb.js';

export interface ProxyServerConfig {
  port: number;
  host: string;
  certManager: CertificateManager;
  configManager: ConfigurationManager;
  keychainStore: KeychainStore;
}

export interface ProxyStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  bytesTransferred: number;
  uptime: number;
  startTime: Date;
}

export class ProxyServer {
  private server?: https.Server;
  private accountPoolManager?: AccountPoolManager;
  private kiroAPIClient: KiroAPIClient;
  private stats: ProxyStats;
  private config: ProxyServerConfig;

  constructor(config: ProxyServerConfig) {
    this.config = config;
    this.kiroAPIClient = new KiroAPIClient();
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      bytesTransferred: 0,
      uptime: 0,
      startTime: new Date(),
    };
  }

  /**
   * Start MITM proxy server
   */
  async start(): Promise<void> {
    // Load certificates
    const certInfo = this.config.certManager.getCertificateInfo();
    const [key, cert] = await Promise.all([
      fs.readFile(certInfo.serverKeyPath, 'utf8'),
      fs.readFile(certInfo.serverCertPath, 'utf8'),
    ]);

    // Initialize account pool manager
    const config = this.config.configManager.getConfig();

    // Create a minimal redis client wrapper (not used in MITM mode)
    const redisClient = {
      get: async () => null,
      set: async () => {},
      del: async () => {},
      exists: async () => false,
    } as any;

    this.accountPoolManager = new AccountPoolManager(
      redisClient,
      config,
      this.config.keychainStore
    );

    // Create HTTPS server
    this.server = https.createServer(
      {
        key,
        cert,
        // Allow self-signed certificates
        rejectUnauthorized: false,
      },
      (req, res) => this.handleRequest(req, res)
    );

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(`🔒 MITM Proxy listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });

      this.server!.on('error', (error) => {
        reject(error);
      });
    });

    // Update stats timer
    setInterval(() => {
      this.stats.uptime = Date.now() - this.stats.startTime.getTime();
    }, 1000);
  }

  /**
   * Stop MITM proxy server
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
        } else {
          console.log('🛑 MITM Proxy stopped');
          resolve();
        }
      });
    });

    this.server = undefined;
  }

  /**
   * Handle incoming HTTPS request
   */
  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    this.stats.totalRequests++;

    try {
      // Log request
      console.log(`[MITM] ${req.method} ${req.url} from ${req.headers.host}`);

      // Check if this is a Kiro API request
      const host = req.headers.host || '';
      if (!this.isKiroDomain(host)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not a Kiro API domain' }));
        this.stats.failedRequests++;
        return;
      }

      // Extract region from hostname
      const region = this.extractRegion(host);

      // Only handle /v1/messages endpoint
      if (!req.url?.startsWith('/v1/messages')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only /v1/messages endpoint is supported' }));
        this.stats.failedRequests++;
        return;
      }

      // Read request body
      const body = await this.readRequestBody(req);
      const requestData = JSON.parse(body);

      // Get account from pool
      const selection = await this.accountPoolManager!.selectAccount();
      if (!selection || !selection.account) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No available accounts' }));
        this.stats.failedRequests++;
        return;
      }
      const account = selection.account;

      // Get credentials
      const credentials = await this.config.keychainStore.retrieve(account.id);
      if (!credentials) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to retrieve credentials' }));
        this.stats.failedRequests++;
        return;
      }

      // Build API config
      const kiroAccount = account as KiroOAuthAccount;
      const apiConfig: KiroAPIConfig = {
        region: region || kiroAccount.region,
        timeout: {
          connect: 10000,
          read: 60000,
        },
        retries: 3,
      };

      // Forward request to Kiro API
      console.log(`[MITM] Forwarding to Kiro account: ${account.id} (${apiConfig.region})`);

      const response = await this.kiroAPIClient.sendRequest(
        requestData,
        credentials.accessToken,
        apiConfig
      );

      // Track usage in database
      try {
        await saveRequestUsage({
          accountId: account.id,
          model: requestData.model || 'claude-sonnet-4',
          region: apiConfig.region,
          tokens: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
            cache_read_input_tokens: response.usage.cache_read_input_tokens,
          },
          status: 'success',
        });
        console.log(`[MITM] ✓ Usage tracked: ${response.usage.input_tokens + response.usage.output_tokens} tokens`);
      } catch (error) {
        console.error('[MITM] ⚠ Failed to track usage:', error);
      }

      // Return response (native Anthropic format)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      });
      const responseBody = JSON.stringify(response);
      res.end(responseBody);

      this.stats.successfulRequests++;
      this.stats.bytesTransferred += Buffer.byteLength(body) + Buffer.byteLength(responseBody);

      console.log(`[MITM] ✓ Request completed successfully`);
    } catch (error) {
      console.error('[MITM] ✗ Request failed:', error);

      this.stats.failedRequests++;

      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  /**
   * Read request body
   */
  private async readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      req.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Check if hostname is a Kiro domain
   */
  private isKiroDomain(hostname: string): boolean {
    const kiroDomains = [
      'q.us-east-1.amazonaws.com',
      'q.us-west-2.amazonaws.com',
      'q.eu-west-1.amazonaws.com',
      'q.ap-southeast-1.amazonaws.com',
    ];

    return kiroDomains.some(domain => hostname.includes(domain));
  }

  /**
   * Extract AWS region from hostname
   */
  private extractRegion(hostname: string): string | null {
    const match = hostname.match(/q\.([a-z0-9-]+)\.amazonaws\.com/);
    return match ? match[1] : null;
  }

  /**
   * Get proxy statistics
   */
  getStats(): ProxyStats {
    return {
      ...this.stats,
      uptime: Date.now() - this.stats.startTime.getTime(),
    };
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== undefined && this.server.listening;
  }
}
