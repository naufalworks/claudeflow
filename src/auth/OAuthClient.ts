/**
 * OAuth 2.0 + PKCE Client for Kiro Authentication
 *
 * Implements the complete OAuth flow with PKCE for secure authentication
 * with Kiro's AWS-based infrastructure.
 *
 * Security measures:
 * - PKCE with 64-byte verifier (86 chars) for strong entropy
 * - State parameter with constant-time comparison (CSRF protection)
 * - Callback server binds to 127.0.0.1 only
 * - Single-use callback server (closes after receiving request)
 * - 5-minute timeout for auth flow
 * - HTTPS enforcement for all OAuth endpoints
 * - Token response validation
 */

import * as crypto from 'crypto';
import * as http from 'http';
import { exec } from 'child_process';
import * as url from 'url';
import axios, { AxiosError } from 'axios';
import type {
  OAuthClientConfig,
  OAuthTokens,
  PKCEChallenge,
  OAuthProvider,
} from '../types/kiro-oauth.types.js';
import { AuthenticationError } from '../errors/kiro-errors.js';
import { createTLSAgent } from '../utils/tls-config.js';

/**
 * OAuth client for Kiro authentication
 */
export class OAuthClient {
  // Configuration constants
  private static readonly KIRO_AUTH_BASE = 'https://prod.{region}.auth.desktop.kiro.dev';
  private static readonly KIRO_CLIENT_ID = 'kiro-desktop-client';
  private static readonly SCOPES = [
    'codewhisperer:completions',
    'codewhisperer:conversations'
  ];

  // Security constants
  private static readonly VERIFIER_BYTES = 64;
  private static readonly STATE_BYTES = 32;
  private static readonly CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

  // In-memory state tracking
  private static activeStates = new Map<string, { codeVerifier: string; expiresAt: number }>();

  /**
   * Generate PKCE code verifier and challenge
   */
  generatePKCE(): PKCEChallenge {
    const verifier = this.base64url(crypto.randomBytes(OAuthClient.VERIFIER_BYTES));
    const challenge = this.base64url(
      crypto.createHash('sha256').update(verifier).digest()
    );

    return {
      verifier,
      challenge,
      method: 'S256',
    };
  }

  /**
   * Generate random state parameter for CSRF protection
   */
  private generateState(): string {
    return this.base64url(crypto.randomBytes(OAuthClient.STATE_BYTES));
  }

  /**
   * URL-safe base64 encoding (RFC 7636)
   */
  private base64url(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Build OAuth authorization URL with PKCE
   */
  buildAuthorizationUrl(
    config: OAuthClientConfig,
    pkce: PKCEChallenge,
    state: string,
    redirectUri: string
  ): string {
    const authBase = OAuthClient.KIRO_AUTH_BASE.replace('{region}', config.region);

    const params = new URLSearchParams({
      client_id: OAuthClient.KIRO_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: pkce.challenge,
      code_challenge_method: pkce.method,
      state: state,
      scope: OAuthClient.SCOPES.join(' '),
    });

    if (config.provider) {
      params.set('identity_provider', this.getProviderId(config.provider));
    }

    const authUrl = `${authBase}/authorize?${params.toString()}`;

    if (!authUrl.startsWith('https://')) {
      throw new Error('OAuth endpoints must use HTTPS for security');
    }

    return authUrl;
  }

  /**
   * Get OAuth provider identifier for Kiro
   */
  private getProviderId(provider: OAuthProvider): string {
    const providerMap: Record<OAuthProvider, string> = {
      aws: 'AWSBuilderId',
      google: 'Google',
      github: 'GitHub',
    };
    return providerMap[provider];
  }

  /**
   * Start local callback server
   */
  async startCallbackServer(preferredPort?: number): Promise<{
    server: http.Server;
    port: number;
    redirectUri: string;
  }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer();

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          server.close();
          reject(new Error('Port already in use'));
        } else {
          reject(error);
        }
      });

      const host = '127.0.0.1';
      server.listen(preferredPort || 0, host, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('Failed to get server address'));
          return;
        }

        const port = address.port;
        const redirectUri = `http://${host}:${port}/callback`;

        resolve({ server, port, redirectUri });
      });
    });
  }

  /**
   * Wait for OAuth callback and extract authorization code
   */
  async waitForCallback(
    server: http.Server,
    expectedState: string,
    timeoutMs: number = OAuthClient.CALLBACK_TIMEOUT_MS
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error(
          `OAuth callback timed out after ${timeoutMs / 1000} seconds. ` +
          `Please try running 'claudeflow login' again.`
        ));
      }, timeoutMs);

      server.on('request', (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        const { code, state, error, error_description } = parsedUrl.query;

        res.writeHead(200, { 'Content-Type': 'text/html' });

        if (error) {
          res.end(`<html><body><h1>Authentication Failed</h1><p>Error: ${error}</p><p>${error_description || ''}</p><p>You can close this window and try again.</p></body></html>`);
          clearTimeout(timeout);
          server.close();
          reject(new Error(`Authentication failed: ${error} - ${error_description}`));
          return;
        }

        if (!code || !state) {
          res.end(`<html><body><h1>Invalid Callback</h1><p>Missing required parameters.</p><p>You can close this window and try again.</p></body></html>`);
          clearTimeout(timeout);
          server.close();
          reject(new Error('Invalid OAuth callback: missing code or state'));
          return;
        }

        const stateBuffer = Buffer.from(state as string, 'utf8');
        const expectedBuffer = Buffer.from(expectedState, 'utf8');

        if (stateBuffer.length !== expectedBuffer.length ||
            !crypto.timingSafeEqual(stateBuffer, expectedBuffer)) {
          res.end(`<html><body><h1>Security Error</h1><p>State parameter mismatch. This could indicate a CSRF attack.</p><p>You can close this window and try again.</p></body></html>`);
          clearTimeout(timeout);
          server.close();
          reject(new Error('OAuth state mismatch - possible CSRF attack'));
          return;
        }

        res.end(`<html><body><h1>Authentication Successful!</h1><p>You can close this window and return to your terminal.</p><script>window.close();</script></body></html>`);

        clearTimeout(timeout);
        server.close();
        resolve(code as string);
      });
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    config: OAuthClientConfig,
    redirectUri: string
  ): Promise<OAuthTokens> {
    const tokenEndpoint = `${OAuthClient.KIRO_AUTH_BASE.replace('{region}', config.region)}/token`;

    if (!tokenEndpoint.startsWith('https://')) {
      throw new Error('Token endpoint must use HTTPS for security');
    }

    try {
      const response = await axios.post(
        tokenEndpoint,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          client_id: OAuthClient.KIRO_CLIENT_ID,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
          httpsAgent: createTLSAgent(),
        }
      );

      const { access_token, refresh_token, token_type, expires_in } = response.data;

      if (!access_token || !refresh_token) {
        throw new Error('Token response missing required fields');
      }

      if (token_type !== 'Bearer') {
        throw new Error(`Unexpected token_type: ${token_type}`);
      }

      if (!expires_in || expires_in <= 0 || expires_in > 86400) {
        throw new Error('Invalid expires_in value');
      }

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
        tokenType: 'Bearer',
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new AuthenticationError('OAuth token exchange', 'Authorization code invalid or expired');
        }
        throw new Error(`Token exchange failed: ${error.response?.data?.error_description || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Full interactive OAuth login flow
   */
  async login(config: OAuthClientConfig): Promise<OAuthTokens> {
    // Step 1: Generate PKCE + state
    const pkce = this.generatePKCE();
    const state = this.generateState();

    // Store state for validation
    OAuthClient.activeStates.set(state, {
      codeVerifier: pkce.verifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    this.cleanupExpiredStates();

    // Step 2-3: Start callback server
    const { server, port, redirectUri } = await this.startCallbackServer(config.callbackPort);

    // Step 2: Build authorization URL
    const authUrl = this.buildAuthorizationUrl(config, pkce, state, redirectUri);

    console.log('\n🔐 Opening browser for authentication...');
    console.log(`   Provider: ${config.provider || 'auto-detect'}`);
    console.log(`   Region: ${config.region}`);
    console.log(`   Callback: http://127.0.0.1:${port}/callback`);
    console.log('\n   If the browser doesn\'t open automatically, visit:');
    console.log(`   ${authUrl}\n`);

    // Step 4: Open browser
    await this.openBrowser(authUrl);

    // Step 5: Wait for callback
    const code = await this.waitForCallback(server, state);

    // Step 6: Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(code, pkce.verifier, config, redirectUri);

    // Clean up state
    OAuthClient.activeStates.delete(state);

    console.log('\n✓ Authentication successful!\n');

    return tokens;
  }

  /**
   * Non-interactive login with existing token (for CI/CD)
   */
  async loginWithToken(refreshToken: string, config: OAuthClientConfig): Promise<OAuthTokens> {
    const tokenEndpoint = `${OAuthClient.KIRO_AUTH_BASE.replace('{region}', config.region)}/token`;

    if (!tokenEndpoint.startsWith('https://')) {
      throw new Error('Token endpoint must use HTTPS for security');
    }

    console.log('\n🔐 Refreshing authentication token...');
    console.log(`   Region: ${config.region}\n`);

    try {
      const response = await axios.post(
        tokenEndpoint,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: OAuthClient.KIRO_CLIENT_ID,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
          httpsAgent: createTLSAgent(),
        }
      );

      const { access_token, refresh_token: new_refresh_token, token_type, expires_in } = response.data;

      if (!access_token) {
        throw new Error('Token response missing access_token');
      }

      if (token_type !== 'Bearer') {
        throw new Error(`Unexpected token_type: ${token_type}`);
      }

      if (!expires_in || expires_in <= 0 || expires_in > 86400) {
        throw new Error('Invalid expires_in value');
      }

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      console.log('✓ Token refreshed successfully!\n');

      return {
        accessToken: access_token,
        refreshToken: new_refresh_token || refreshToken,
        expiresAt,
        tokenType: 'Bearer',
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new AuthenticationError('Token refresh', 'Refresh token expired or invalid');
        }
        throw new Error(`Token refresh failed: ${error.response?.data?.error_description || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Open browser to authorization URL (cross-platform)
   */
  private async openBrowser(url: string): Promise<void> {
    const platform = process.platform;
    let command: string;

    switch (platform) {
      case 'darwin':
        command = `open "${url}"`;
        break;
      case 'win32':
        command = `start "" "${url}"`;
        break;
      case 'linux':
        command = `xdg-open "${url}"`;
        break;
      default:
        console.log(`Please open this URL manually: ${url}`);
        return;
    }

    return new Promise((resolve) => {
      exec(command, (error) => {
        if (error) {
          console.log(`Failed to open browser automatically. Please open: ${url}`);
        }
        resolve();
      });
    });
  }

  /**
   * Clean up expired OAuth states
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, data] of OAuthClient.activeStates.entries()) {
      if (data.expiresAt < now) {
        OAuthClient.activeStates.delete(state);
      }
    }
  }
}
