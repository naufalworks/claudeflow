/**
 * Kiro OAuth Type Definitions
 *
 * Type definitions for direct Kiro OAuth authentication.
 * This replaces the broken 9router-dependent authentication with
 * direct OAuth 2.0 + PKCE flow communicating with Kiro's AWS infrastructure.
 *
 * Key design decisions:
 * - PKCE for OAuth (no client secret) — ClaudeFlow is a public CLI client
 * - OS keychain for credential storage — no plaintext config files
 * - Dual auth mode (Desktop vs SSO) — auto-detected from credentials
 * - Direct API calls (no proxy) — preserves native Anthropic format
 */

// ============================================================================
// OAuth Configuration Types
// ============================================================================

/**
 * Supported OAuth providers for Kiro authentication
 */
export type OAuthProvider = 'aws' | 'google' | 'github';

/**
 * Configuration for OAuth client
 */
export interface OAuthClientConfig {
  /** OAuth provider to use for authentication */
  provider: OAuthProvider;
  /** AWS region for Kiro endpoints */
  region: string;
  /** Optional specific callback port (random available port if not specified) */
  callbackPort?: number;
}

/**
 * OAuth tokens received after successful authentication
 */
export interface OAuthTokens {
  /** Short-lived JWT token for API authentication */
  accessToken: string;
  /** Long-lived token for obtaining new access tokens */
  refreshToken: string;
  /** Token expiration time */
  expiresAt: Date;
  /** Token type (always 'Bearer') */
  tokenType: 'Bearer';
}

/**
 * PKCE challenge pair for OAuth security
 */
export interface PKCEChallenge {
  /** Random URL-safe string (43-128 chars) used as code verifier */
  verifier: string;
  /** SHA-256 hash of verifier, base64url-encoded */
  challenge: string;
  /** Challenge method (always 'S256') */
  method: 'S256';
}

/**
 * OAuth state tracking for CSRF prevention
 */
export interface OAuthState {
  /** Random state parameter for CSRF protection */
  state: string;
  /** PKCE code verifier associated with this flow */
  codeVerifier: string;
  /** OAuth provider being used */
  provider: OAuthProvider;
  /** Callback redirect URI */
  redirectUri: string;
}

// ============================================================================
// Keychain / Credential Storage Types
// ============================================================================

/**
 * Credentials stored securely in OS keychain
 */
export interface KeychainCredentials {
  /** Short-lived access token */
  accessToken: string;
  /** Long-lived refresh token */
  refreshToken: string;
  /** Token expiration time (ISO 8601) */
  expiresAt: string;
  /** Token scopes (optional) */
  scopes?: string[];
  /** Client secret (only for AWS SSO mode) */
  clientSecret?: string;
  /** Client ID (only for AWS SSO mode) */
  clientId?: string;
}

/**
 * Keychain storage entry format
 */
export interface KeychainEntry {
  /** Service identifier (always 'claudeflow') */
  service: 'claudeflow';
  /** Account identifier (e.g., 'kiro-abc123') */
  account: string;
  /** The stored credentials */
  credentials: KeychainCredentials;
}

/**
 * Supported OS keychain backends
 */
export type KeychainBackend =
  | 'macos-keychain'
  | 'windows-credential-manager'
  | 'libsecret'
  | 'fallback-encrypted';

// ============================================================================
// Token Management Types
// ============================================================================

/**
 * Result of a token refresh operation
 */
export interface TokenRefreshResult {
  /** Whether the refresh succeeded */
  success: boolean;
  /** New access token */
  accessToken: string;
  /** New refresh token (may be rotated) */
  refreshToken: string;
  /** New token expiration time */
  expiresAt: Date;
  /** Timestamp of when refresh occurred */
  refreshedAt: Date;
}

// ============================================================================
// JWT Validation Types
// ============================================================================

/**
 * Decoded JWT claims for token validation
 */
export interface JWTClaims {
  /** Token issuer (e.g., Kiro Auth Service URL) */
  iss: string;
  /** Expected audience (e.g., client ID) */
  aud: string;
  /** Subject (user identifier) */
  sub: string;
  /** Expiration time (Unix timestamp) */
  exp: number;
  /** Issued at time (Unix timestamp) */
  iat: number;
  /** Token scope (optional) */
  scope?: string;
}

/**
 * Result of JWT validation
 */
export interface JWTValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Decoded claims if valid */
  claims?: JWTClaims;
  /** Error description if invalid */
  error?: string;
}

// ============================================================================
// Kiro API Client Types
// ============================================================================

/**
 * Configuration for Kiro API client
 */
export interface KiroAPIConfig {
  /** AWS region for API endpoint */
  region: string;
  /** Connection timeouts */
  timeout: {
    /** Connection timeout in seconds (default: 10) */
    connect: number;
    /** Read timeout in seconds (default: 60) */
    read: number;
  };
  /** Maximum retry attempts (default: 3) */
  retries: number;
}

/**
 * Error classification for Kiro API errors
 */
export type KiroAPIErrorType = 'auth' | 'rate-limit' | 'quota' | 'server' | 'network';

/**
 * Structured error from Kiro API
 */
export interface KiroAPIError {
  /** HTTP status code */
  statusCode: number;
  /** Human-readable error message */
  message: string;
  /** Error classification */
  type: KiroAPIErrorType;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Seconds to wait before retrying (for rate limits) */
  retryAfter?: number;
}

// ============================================================================
// Authentication Mode Types
// ============================================================================

/**
 * Supported authentication modes
 */
export type AuthMode = 'kiro-desktop' | 'aws-sso';

/**
 * Configuration for a detected authentication mode
 */
export interface AuthModeConfig {
  /** Detected authentication mode */
  mode: AuthMode;
  /** Token endpoint URL for this mode */
  tokenEndpoint: string;
  /** Whether this mode requires a client secret */
  requiresClientSecret: boolean;
}

// ============================================================================
// Account Pool Types
// ============================================================================

/**
 * Account health status
 */
export type AccountStatus = 'healthy' | 'unhealthy' | 'expired' | 're-auth-required' | 'unknown';

/**
 * Account quota usage information
 */
export interface AccountQuota {
  requestsPerMinute: QuotaWindow;
  requestsPerHour: QuotaWindow;
  requestsPerDay: QuotaWindow;
}

/**
 * Quota tracking for a time window
 */
export interface QuotaWindow {
  /** Number of requests used */
  used: number;
  /** Maximum allowed requests */
  limit: number;
  /** When the quota resets */
  resetTime: Date;
}

/**
 * Kiro OAuth account with runtime state for pool management
 */
export interface KiroPoolAccount {
  /** Unique account ID in format: kiro-{hash} */
  id: string;
  /** Account provider (always 'kiro-oauth') */
  provider: 'kiro-oauth';
  /** AWS region */
  region: string;
  /** AWS ARN for the Kiro profile */
  profileArn: string;
  /** Token expiration time (ISO 8601) */
  expiresAt: string;
  /** Last usage timestamp */
  lastUsed: number;
  /** Total request count */
  requestCount: number;
  /** Consecutive error count */
  errorCount: number;
  /** Routing priority (0-100, higher = more preferred) */
  priority: number;
  /** Current account status */
  status: AccountStatus;
  /** Quota usage tracking */
  quota: AccountQuota;
}

/**
 * Account selection strategy type
 */
export type AccountStrategyType = 'round-robin' | 'priority-based' | 'quota-aware';

/**
 * Context for account selection decisions
 */
export interface SelectionContext {
  /** Current time */
  now: Date;
  /** Previously used account ID (for round-robin avoidance) */
  previousAccountId?: string;
  /** Request priority level */
  priority?: number;
}

/**
 * Account selection strategy interface
 */
export interface AccountSelectionStrategy {
  /** Strategy type identifier */
  type: AccountStrategyType;
  /** Select the best account from available accounts */
  selectAccount(accounts: KiroPoolAccount[], context: SelectionContext): KiroPoolAccount;
}

// ============================================================================
// Runtime State Types
// ============================================================================

/**
 * Circuit breaker states
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker state for an account
 */
export interface CircuitBreakerInfo {
  /** Current circuit breaker state */
  state: CircuitBreakerState;
  /** Number of consecutive failures */
  failureCount: number;
  /** Time of last failure */
  lastFailureTime?: Date;
  /** Time when circuit transitions from open to half-open */
  openUntil?: Date;
}

/**
 * Complete runtime state for an account (in-memory only)
 */
export interface RuntimeAccountState {
  /** Account identifier */
  accountId: string;
  /** Current health status */
  status: AccountStatus;
  /** Number of consecutive errors */
  consecutiveErrors: number;
  /** Last health check timestamp */
  lastHealthCheck: Date;
  /** Last error description */
  lastError?: string;
  /** Current quota tracking */
  currentQuota: {
    requestsPerMinute: { used: number; limit: number };
    requestsPerHour: { used: number; limit: number };
    requestsPerDay: { used: number; limit: number };
    resetTime: Date;
  };
  /** Circuit breaker state */
  circuitBreaker: CircuitBreakerInfo;
}

// ============================================================================
// Rate Limit Types
// ============================================================================

/**
 * Rate limit information from API response headers
 */
export interface RateLimitInfo {
  /** Maximum requests allowed */
  limit: number;
  /** Requests remaining */
  remaining: number;
  /** Reset time (Unix timestamp) */
  reset: number;
  /** Seconds to wait before retrying (from 429 response) */
  retryAfter?: number;
}
