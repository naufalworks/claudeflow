/**
 * Token refresh utilities for OAuth providers
 *
 * Provider-specific refresh lead times - refresh tokens before expiry
 * to avoid API failures. Synced with 9router's refresh_registry.
 */

// Token expiry buffer for providers without specific lead times
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

// Provider-specific early refresh lead times (ms)
// Refresh happens when: expiresAt - now < leadTime
export const REFRESH_LEAD_MS = {
  codex: 5 * 24 * 60 * 60 * 1000,        // 5 days
  claude: 4 * 60 * 60 * 1000,            // 4 hours
  iflow: 24 * 60 * 60 * 1000,            // 24 hours
  qwen: 20 * 60 * 1000,                  // 20 minutes
  'kimi-coding': 5 * 60 * 1000,          // 5 minutes
  antigravity: 5 * 60 * 1000,            // 5 minutes
  // ClaudeFlow providers
  kiro: 5 * 60 * 1000,                   // 5 minutes (legacy OAuth)
  'kiro-oauth': 5 * 60 * 1000,           // 5 minutes (AWS CodeWhisperer)
};

/**
 * Get refresh lead time for a provider
 *
 * @param provider - Provider name
 * @returns Lead time in milliseconds before expiry to refresh
 */
export function getRefreshLeadMs(provider: string): number {
  return (REFRESH_LEAD_MS as any)[provider] ?? TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Check if a token needs refresh based on expiry time
 *
 * @param expiresAt - Token expiry timestamp (ISO string or number)
 * @param provider - Provider name for lead time lookup
 * @returns true if token should be refreshed
 */
export function needsTokenRefresh(expiresAt: string | number | undefined, provider: string): boolean {
  if (!expiresAt) return false;

  const expiryTime = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt;
  const now = Date.now();
  const leadMs = getRefreshLeadMs(provider);

  return expiryTime - now < leadMs;
}

/**
 * In-flight deduplication for token refresh
 *
 * Prevents multiple concurrent refreshes for the same account by
 * caching the pending refresh promise.
 */
export class TokenRefreshDeduplicator {
  private pendingRefreshes: Map<string, Promise<any>> = new Map();

  /**
   * Check if refresh is already in progress
   */
  hasPending(accountId: string): boolean {
    return this.pendingRefreshes.has(accountId);
  }

  /**
   * Start a new refresh with automatic cleanup
   */
  async runWithLock<T>(accountId: string, refreshFn: () => Promise<T>): Promise<T> {
    // Check if refresh already in progress
    if (this.pendingRefreshes.has(accountId)) {
      // Wait for existing refresh to complete
      await this.pendingRefreshes.get(accountId);
      // Refresh already happened, return undefined to signal caller
      return undefined as unknown as T;
    }

    // Start new refresh with automatic cleanup
    const refreshPromise = (async () => {
      try {
        return await refreshFn();
      } finally {
        // Always clean up the lock, even on failure
        this.pendingRefreshes.delete(accountId);
      }
    })();

    // Store promise in map before awaiting
    this.pendingRefreshes.set(accountId, refreshPromise);
    return refreshPromise;
  }

  /**
   * Clear any pending refresh for an account
   */
  clear(accountId: string): void {
    this.pendingRefreshes.delete(accountId);
  }
}
