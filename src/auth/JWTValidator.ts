/**
 * JWTValidator - JWT token validation for Kiro OAuth
 *
 * Responsibilities:
 * - Fetch OIDC public keys from discovery endpoint (cached 24h)
 * - Validate JWT signature using jose library
 * - Verify JWT claims: iss, aud, exp, iat, nbf
 * - Decode JWT without validation (inspection only)
 * - Check if token is expired
 *
 * Security measures:
 * - Signature verification using OIDC public keys
 * - Strict claim validation (iss, aud, exp > now, iat <= now, nbf <= now)
 * - Public key caching with 24h TTL and LRU eviction
 * - Automatic key refresh on signature validation failure
 * - TLS 1.2+ for OIDC discovery endpoint
 * - Promise deduplication to prevent race conditions
 * - Clock skew tolerance for distributed systems
 * - Sanitized error messages (no internal details leaked)
 *
 * Correctness Property 10:
 * Token SHALL be accepted if and only if ALL hold:
 * - iss matches expected issuer
 * - aud matches expected audience
 * - exp > now (with clock skew tolerance)
 * - iat <= now (with clock skew tolerance)
 * - nbf <= now (with clock skew tolerance, if present)
 *
 * Requirements: 5.1-5.10
 */

import * as jose from 'jose';
import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { logger } from '../cli/utils/logger.js';
import type { JWTClaims, JWTValidationResult } from '../types/kiro-oauth.types.js';

// ============================================================================
// Constants
// ============================================================================

/** Public key cache TTL (24 hours) */
const PUBLIC_KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum cache size for public keys (LRU eviction) */
const MAX_CACHE_SIZE = 100;

/** Clock skew tolerance in seconds (60 seconds) */
const CLOCK_SKEW_SECONDS = 60;

/** HTTP timeout for OIDC discovery requests (5 seconds) */
const HTTP_TIMEOUT_MS = 5000;

/** Maximum retry attempts for key refresh on signature failure */
const MAX_RETRY_ATTEMPTS = 1;

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Cached public key set with metadata
 */
interface CachedKeySet {
  /** JSON Web Key Set from OIDC provider */
  keys: jose.JSONWebKeySet;
  /** Timestamp when keys were fetched */
  fetchedAt: Date;
  /** Timestamp of last access (for LRU eviction) */
  lastAccessed: Date;
}

// ============================================================================
// JWTValidator Class
// ============================================================================

/**
 * JWT token validator for Kiro OAuth authentication
 */
export class JWTValidator {
  /** Cache for public keys by discovery URL */
  private readonly publicKeyCache: Map<string, CachedKeySet>;

  /** In-flight request promises for deduplication */
  private readonly inflightRequests: Map<string, Promise<jose.JSONWebKeySet>>;

  /** HTTP client for OIDC discovery requests */
  private readonly httpClient: AxiosInstance;

  /**
   * Create a new JWTValidator
   */
  constructor() {
    this.publicKeyCache = new Map();
    this.inflightRequests = new Map();
    this.httpClient = this.createHttpClient();
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Fetch OIDC public keys from discovery endpoint
   *
   * Features:
   * - 24h cache with automatic expiration check
   * - LRU eviction when cache reaches MAX_CACHE_SIZE
   * - Promise deduplication to prevent race conditions
   * - TLS 1.2+ enforcement with strict certificate validation
   *
   * @param discoveryUrl - OIDC discovery endpoint URL
   * @param forceRefresh - Force refresh even if cache is valid (default: false)
   * @returns JSON Web Key Set from OIDC provider
   */
  async fetchPublicKeys(discoveryUrl: string, forceRefresh = false): Promise<jose.JSONWebKeySet> {
    // Check cache if not forcing refresh
    if (!forceRefresh) {
      const cached = this.publicKeyCache.get(discoveryUrl);
      if (cached && this.isCacheValid(cached)) {
        // Update last accessed time for LRU
        cached.lastAccessed = new Date();
        logger.debug('Using cached public keys', { discoveryUrl });
        return cached.keys;
      }
    }

    // Check for in-flight request (promise deduplication)
    const inflight = this.inflightRequests.get(discoveryUrl);
    if (inflight) {
      logger.debug('Waiting for in-flight request', { discoveryUrl });
      return inflight;
    }

    // Create new request promise
    const requestPromise = this.fetchPublicKeysFromNetwork(discoveryUrl);

    // Store promise for deduplication
    this.inflightRequests.set(discoveryUrl, requestPromise);

    try {
      const keys = await requestPromise;
      return keys;
    } finally {
      // Remove from in-flight map when done
      this.inflightRequests.delete(discoveryUrl);
    }
  }

  /**
   * Validate JWT token signature and claims
   *
   * Correctness Property 10:
   * Token SHALL be accepted if and only if ALL hold:
   * - iss matches expected issuer
   * - aud matches expected audience
   * - exp > now (with clock skew tolerance)
   * - iat <= now (with clock skew tolerance)
   * - nbf <= now (with clock skew tolerance, if present)
   *
   * @param token - JWT token string
   * @param expectedIssuer - Expected issuer (iss claim)
   * @param expectedAudience - Expected audience (aud claim)
   * @returns Validation result with claims if valid
   */
  async validate(
    token: string,
    expectedIssuer: string,
    expectedAudience: string
  ): Promise<JWTValidationResult> {
    try {
      // Build OIDC discovery URL from issuer
      const discoveryUrl = this.buildDiscoveryUrl(expectedIssuer);

      logger.debug('Starting JWT validation', {
        issuer: expectedIssuer,
        audience: expectedAudience,
        discoveryUrl
      });

      // Attempt validation with retry on signature failure
      let retryCount = 0;
      let lastError: Error | null = null;

      while (retryCount <= MAX_RETRY_ATTEMPTS) {
        try {
          // Fetch public keys
          const keys = await this.fetchPublicKeys(discoveryUrl, retryCount > 0);

          // Create JWKS for verification
          const JWKS = jose.createLocalJWKSet(keys);

          // Verify JWT signature and claims
          // jose.jwtVerify automatically validates: signature, iss, aud, exp, nbf
          const { payload } = await jose.jwtVerify(token, JWKS, {
            issuer: expectedIssuer,
            audience: expectedAudience,
            clockTolerance: CLOCK_SKEW_SECONDS,
          });

          // Manual iat validation (jose doesn't check this by default)
          const now = Math.floor(Date.now() / 1000);
          if (payload.iat && payload.iat > now + CLOCK_SKEW_SECONDS) {
            return {
              valid: false,
              error: 'Token issued in the future'
            };
          }

          logger.info('JWT validation successful', {
            issuer: payload.iss,
            subject: payload.sub,
            expiresAt: new Date((payload.exp as number) * 1000).toISOString()
          });

          return {
            valid: true,
            claims: payload as JWTClaims
          };
        } catch (error: any) {
          lastError = error;

          // If signature validation failed, retry with fresh keys
          if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' && retryCount === 0) {
            logger.warn('Signature validation failed, retrying with fresh keys', {
              discoveryUrl
            });
            retryCount++;
            continue;
          }

          // For other errors, break and return error
          break;
        }
      }

      // Return error result
      const sanitizedError = this.sanitizeError(lastError);
      logger.warn('JWT validation failed', { error: sanitizedError });
      return {
        valid: false,
        error: sanitizedError
      };
    } catch (error: any) {
      const sanitizedError = this.sanitizeError(error);
      logger.error('JWT validation error', { error: sanitizedError });
      return {
        valid: false,
        error: sanitizedError
      };
    }
  }

  /**
   * Decode JWT token without validation
   *
   * WARNING: This does NOT validate the signature or claims.
   * Use only for inspection and debugging.
   *
   * @param token - JWT token string
   * @returns Decoded JWT claims
   */
  decode(token: string): JWTClaims {
    try {
      const claims = jose.decodeJwt(token);
      return claims as JWTClaims;
    } catch (error: any) {
      logger.error('Failed to decode JWT', { error: error.message });
      throw new Error('Invalid JWT format');
    }
  }

  /**
   * Check if JWT token is expired
   *
   * @param token - JWT token string
   * @returns true if token is expired, false otherwise
   */
  isExpired(token: string): boolean {
    try {
      const claims = this.decode(token);

      if (!claims.exp) {
        // Token without exp claim is considered non-expiring
        return false;
      }

      const now = Math.floor(Date.now() / 1000);
      return claims.exp <= now;
    } catch (error: any) {
      // If we can't decode the token, consider it expired
      logger.warn('Failed to check token expiry', { error: error.message });
      return true;
    }
  }

  /**
   * Invalidate cached public keys
   *
   * @param discoveryUrl - Specific URL to invalidate (optional, clears all if not provided)
   */
  invalidateCache(discoveryUrl?: string): void {
    if (discoveryUrl) {
      this.publicKeyCache.delete(discoveryUrl);
      logger.debug('Invalidated cache for discovery URL', { discoveryUrl });
    } else {
      this.publicKeyCache.clear();
      logger.debug('Cleared entire public key cache');
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Create HTTP client with TLS validation
   */
  private createHttpClient(): AxiosInstance {
    return axios.create({
      timeout: HTTP_TIMEOUT_MS,
      httpsAgent: new https.Agent({
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      }),
    });
  }

  /**
   * Fetch public keys from network
   */
  private async fetchPublicKeysFromNetwork(discoveryUrl: string): Promise<jose.JSONWebKeySet> {
    logger.info('Fetching public keys from OIDC discovery endpoint', { discoveryUrl });

    try {
      const response = await this.httpClient.get<jose.JSONWebKeySet>(discoveryUrl);

      if (!response.data || !response.data.keys) {
        throw new Error('Invalid OIDC discovery response: missing keys');
      }

      const keys = response.data;

      // Evict LRU entry if cache is full
      this.evictLRUIfNeeded();

      // Cache the keys
      const cached: CachedKeySet = {
        keys,
        fetchedAt: new Date(),
        lastAccessed: new Date()
      };
      this.publicKeyCache.set(discoveryUrl, cached);

      logger.info('Public keys cached successfully', {
        discoveryUrl,
        keyCount: keys.keys.length
      });

      return keys;
    } catch (error: any) {
      logger.error('Failed to fetch public keys', {
        discoveryUrl,
        error: error.message
      });
      throw new Error(`Failed to fetch OIDC public keys from ${discoveryUrl}`);
    }
  }

  /**
   * Check if cached key set is still valid
   */
  private isCacheValid(cached: CachedKeySet): boolean {
    const age = Date.now() - cached.fetchedAt.getTime();
    return age < PUBLIC_KEY_CACHE_TTL_MS;
  }

  /**
   * Evict LRU entry if cache is full
   */
  private evictLRUIfNeeded(): void {
    if (this.publicKeyCache.size >= MAX_CACHE_SIZE) {
      // Find entry with oldest lastAccessed
      let oldest: { url: string; lastAccessed: Date } | null = null;

      for (const [url, cached] of this.publicKeyCache.entries()) {
        if (!oldest || cached.lastAccessed < oldest.lastAccessed) {
          oldest = { url, lastAccessed: cached.lastAccessed };
        }
      }

      if (oldest) {
        this.publicKeyCache.delete(oldest.url);
        logger.debug('Evicted LRU cache entry', { discoveryUrl: oldest.url });
      }
    }
  }

  /**
   * Build OIDC discovery URL from issuer
   */
  private buildDiscoveryUrl(issuer: string): string {
    // Standard OIDC discovery endpoint is at /.well-known/jwks.json
    // For Kiro, issuer is like: https://prod.us-east-1.auth.desktop.kiro.dev
    return `${issuer}/.well-known/jwks.json`;
  }

  /**
   * Sanitize error message for external consumption
   *
   * Removes internal implementation details while providing useful feedback.
   */
  private sanitizeError(error: unknown): string {
    if (!error) {
      return 'Token validation failed';
    }

    const err = error as Error;

    // Map jose error codes to user-friendly messages
    if ('code' in err) {
      switch ((err as any).code) {
        case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
          return 'Invalid token signature';
        case 'ERR_JWT_EXPIRED':
          return 'Token has expired';
        case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
          return 'Token claim validation failed';
        case 'ERR_JWT_INVALID':
          return 'Invalid token format';
        case 'ERR_JWKS_NO_MATCHING_KEY':
          return 'No matching key found for token';
        default:
          // Fall through to generic message
          break;
      }
    }

    // Generic error message (don't expose internal details)
    return 'Token validation failed';
  }
}
