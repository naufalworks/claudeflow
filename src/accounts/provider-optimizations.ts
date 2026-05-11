/**
 * Provider-Specific Optimizations
 *
 * Optimizations tailored to specific OAuth providers based on 9router's implementation.
 * Currently supports:
 * - kiro-oauth: AWS CodeWhisperer token caching and refresh optimization
 */

import type { KeychainCredentials } from '../types/kiro-oauth.types.js';

/**
 * Token cache entry
 */
interface TokenCacheEntry {
  accessToken: string;
  expiresAt: string;
  cachedAt: number;
}

/**
 * Provider-specific token cache
 * Keyed by account ID to prevent cross-account token reuse
 */
const tokenCache = new Map<string, TokenCacheEntry>();

/**
 * Cache TTL buffer - return cached token if it has more than this time remaining
 * Set to 5 minutes to match 9router's Vertex implementation
 */
const CACHE_TTL_BUFFER_MS = 5 * 60 * 1000;

/**
 * Maximum cache age - evict entries older than this regardless of expiry
 * Prevents stale entries from accumulating
 */
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get cached token if still valid
 *
 * @param accountId - Account ID
 * @returns Cached credentials or null if not cached or expired
 */
export function getCachedToken(accountId: string): KeychainCredentials | null {
  const cached = tokenCache.get(accountId);
  if (!cached) {
    return null;
  }

  // Check if cache entry is too old
  const cacheAge = Date.now() - cached.cachedAt;
  if (cacheAge > MAX_CACHE_AGE_MS) {
    tokenCache.delete(accountId);
    return null;
  }

  // Check if token is still valid (with buffer)
  const expiresAt = new Date(cached.expiresAt).getTime();
  const timeUntilExpiry = expiresAt - Date.now();

  if (timeUntilExpiry > CACHE_TTL_BUFFER_MS) {
    return {
      accessToken: cached.accessToken,
      expiresAt: cached.expiresAt,
      refreshToken: '', // Not stored in cache for security
    };
  }

  // Token expired or expiring soon, remove from cache
  tokenCache.delete(accountId);
  return null;
}

/**
 * Cache token for future use
 *
 * @param accountId - Account ID
 * @param credentials - Credentials to cache
 */
export function cacheToken(accountId: string, credentials: KeychainCredentials): void {
  tokenCache.set(accountId, {
    accessToken: credentials.accessToken,
    expiresAt: credentials.expiresAt,
    cachedAt: Date.now(),
  });
}

/**
 * Invalidate cached token for an account
 *
 * @param accountId - Account ID
 */
export function invalidateCache(accountId: string): void {
  tokenCache.delete(accountId);
}

/**
 * Clear all cached tokens
 */
export function clearAllCache(): void {
  tokenCache.clear();
}

/**
 * Get cache statistics
 *
 * @returns Cache statistics
 */
export function getCacheStats(): {
  size: number;
  entries: Array<{ accountId: string; expiresAt: string; cacheAge: number }>;
} {
  const entries = Array.from(tokenCache.entries()).map(([accountId, entry]) => ({
    accountId,
    expiresAt: entry.expiresAt,
    cacheAge: Date.now() - entry.cachedAt,
  }));

  return {
    size: tokenCache.size,
    entries,
  };
}

/**
 * Cleanup expired cache entries
 * Should be called periodically to prevent memory leaks
 */
export function cleanupExpiredCache(): void {
  const now = Date.now();
  const toDelete: string[] = [];

  for (const [accountId, entry] of tokenCache.entries()) {
    const expiresAt = new Date(entry.expiresAt).getTime();
    const cacheAge = now - entry.cachedAt;

    // Remove if expired or too old
    if (expiresAt <= now || cacheAge > MAX_CACHE_AGE_MS) {
      toDelete.push(accountId);
    }
  }

  for (const accountId of toDelete) {
    tokenCache.delete(accountId);
  }
}

/**
 * Provider-specific error code handling
 * Maps provider-specific error codes to standard error types
 */
export const PROVIDER_ERROR_CODES: Record<string, Record<string, string>> = {
  'kiro-oauth': {
    // AWS CodeWhisperer / SSO error codes
    'ExpiredTokenException': 'token_expired',
    'InvalidTokenException': 'invalid_token',
    'UnauthorizedException': 'invalid_grant',
    'AccessDeniedException': 'unauthorized_client',
  },
};

/**
 * Normalize provider-specific error code to standard OAuth error code
 *
 * @param provider - Provider name
 * @param errorCode - Provider-specific error code
 * @returns Standard OAuth error code or original code if no mapping exists
 */
export function normalizeErrorCode(provider: string, errorCode: string): string {
  const providerCodes = PROVIDER_ERROR_CODES[provider];
  if (!providerCodes) {
    return errorCode;
  }

  return providerCodes[errorCode] || errorCode;
}
