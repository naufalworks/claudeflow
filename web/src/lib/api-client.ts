/**
 * ClaudeFlow API Client
 *
 * TypeScript client library for ClaudeFlow dashboard API
 * Handles authentication, error handling, and retry logic
 */

// API Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 30000;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5; // Number of failures before opening circuit
const CIRCUIT_BREAKER_TIMEOUT = 30000; // Time to wait before trying again (30s)
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 2; // Successful requests needed to close circuit

// Request deduplication cache
const pendingRequests = new Map<string, Promise<any>>();

/**
 * API Error class
 */
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorType: string,
    public response?: any
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Circuit Breaker State
 */
type CircuitState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private nextAttempt = 0;

  recordSuccess() {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= CIRCUIT_BREAKER_SUCCESS_THRESHOLD) {
        this.state = 'closed';
        this.successCount = 0;
      }
    }
  }

  recordFailure() {
    this.failureCount++;
    this.successCount = 0;
    if (this.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      this.state = 'open';
      this.nextAttempt = Date.now() + CIRCUIT_BREAKER_TIMEOUT;
    }
  }

  canAttempt(): boolean {
    if (this.state === 'closed') {
      return true;
    }
    if (this.state === 'open') {
      if (Date.now() >= this.nextAttempt) {
        this.state = 'half-open';
        this.successCount = 0;
        return true;
      }
      return false;
    }
    // half-open
    return true;
  }

  getState(): CircuitState {
    return this.state;
  }

  reset() {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = 0;
  }
}

const circuitBreaker = new CircuitBreaker();

/**
 * Account status type
 */
export type AccountStatus = 'active' | 'quota_exceeded' | 'expired' | 'expiring';

/**
 * Account provider type
 */
export type AccountProvider = 'anthropic' | 'proxy' | 'kiro' | 'kiro-oauth';

/**
 * Account quota information
 */
export interface AccountQuota {
  requestsPerMinute: number;
  requestsPerMinuteUsed: number;
  tokensPerDay: number;
  tokensPerDayUsed: number;
  resetTime: number;
}

export interface KiroCreditQuota {
  limit: number;
  remaining: number;
  used: number;
  resetTime?: number;
  source: 'headers' | 'codewhisperer';
  updatedAt: number;
}

/**
 * Account performance metrics
 */
export interface AccountPerformance {
  averageLatency: number;
  successRate: number;
  lastUsed: number;
}

/**
 * Account summary (for list view)
 */
export interface AccountSummary {
  id: string;
  provider: AccountProvider;
  status: AccountStatus;
  quota: AccountQuota;
  kiroCreditQuota?: KiroCreditQuota;
  performance: AccountPerformance;
  costEfficiency: number;
  requestCount: number;
}

/**
 * Account details (for detail view)
 */
export interface AccountDetails extends AccountSummary {
  recentRequests: RequestRecord[];
}

/**
 * Request record
 */
export interface RequestRecord {
  requestId: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latency: number;
  success: boolean;
  error?: string;
}

/**
 * Activity event
 */
export interface ActivityEvent {
  id: string;
  timestamp: string;
  type: 'request' | 'token_refresh' | 'error' | 'quota_exceeded';
  accountId?: string;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Dashboard statistics
 */
export interface DashboardStats {
  accounts: {
    total: number;
    active: number;
    expiring: number;
    expired: number;
  };
  requests: {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
  };
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
    thinking: number;
    total: number;
  };
  performance: {
    averageLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
  };
  optimization: {
    cacheHitRate: number;
    deduplicationRate: number;
    costSavings: number;
    totalCost: number;
  };
  providers: {
    kiroRequests: number;
    anthropicRequests: number;
    kiroPercentage: number;
  };
  lastUpdated: string;
}

/**
 * Fetch wrapper with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new APIError('Request timeout. Is the API server running?', 408, 'timeout_error');
    }
    throw new APIError(
      `Cannot reach API server at ${API_BASE_URL || 'the current origin'}. Is the API running on port 20129?`,
      0,
      'network_error',
      { cause: error?.message || String(error) }
    );
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get API key from auth store
 */
function getAPIKey(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const authState = localStorage.getItem('claudeflow-auth');
    if (!authState) return null;

    const parsed = JSON.parse(authState);
    return parsed.state?.apiKey || null;
  } catch {
    return null;
  }
}

/**
 * Handle authentication error
 */
function handleAuthError() {
  if (typeof window === 'undefined') return;

  // Clear auth state
  try {
    localStorage.removeItem('claudeflow-auth');
  } catch {
    // Ignore errors
  }

  // Redirect to login if not already there
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

/**
 * Make API request with retry logic, circuit breaker, and deduplication
 */
async function makeRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  retries: number = MAX_RETRIES
): Promise<T> {
  // Check circuit breaker
  if (!circuitBreaker.canAttempt()) {
    throw new APIError(
      'Service temporarily unavailable. Please try again later.',
      503,
      'circuit_breaker_open'
    );
  }

  // Request deduplication for GET requests
  const method = options.method || 'GET';
  const deduplicationKey = method === 'GET' ? `${method}:${endpoint}` : null;

  if (deduplicationKey && pendingRequests.has(deduplicationKey)) {
    return pendingRequests.get(deduplicationKey)!;
  }

  const url = `${API_BASE_URL}${endpoint}`;

  // Add headers
  const headers: Record<string, string> = {};

  // Only add Content-Type if there's a body
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    });
  }

  // Get API key from auth store
  const apiKey = getAPIKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const requestPromise = (async () => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetchWithTimeout(url, {
          ...options,
          headers,
        });

        // Handle non-OK responses
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error?.message || response.statusText;
          const errorType = errorData.error?.type || 'api_error';

          // Handle authentication errors
          if (response.status === 401 || response.status === 403) {
            handleAuthError();
            circuitBreaker.recordFailure();
            throw new APIError(errorMessage, response.status, errorType, errorData);
          }

          // Don't retry on client errors (4xx except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            circuitBreaker.recordFailure();
            throw new APIError(errorMessage, response.status, errorType, errorData);
          }

          // Retry on server errors (5xx) and rate limits (429)
          if (attempt < retries) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
            await sleep(delay);
            continue;
          }

          circuitBreaker.recordFailure();
          throw new APIError(errorMessage, response.status, errorType, errorData);
        }

        // Parse and return response
        const data = await response.json();
        circuitBreaker.recordSuccess();
        return data as T;
      } catch (error: any) {
        lastError = error;

        // Retry network/timeouts, but don't retry handled HTTP/API errors.
        if (error instanceof APIError) {
          if (
            (error.errorType === 'network_error' || error.errorType === 'timeout_error') &&
            attempt < retries
          ) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
            await sleep(delay);
            continue;
          }
          throw error;
        }

        // Retry on network errors
        if (attempt < retries) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }

        circuitBreaker.recordFailure();
      }
    }

    // Max retries reached
    throw lastError || new APIError('Request failed', 500, 'api_error');
  })();

  // Store promise for deduplication
  if (deduplicationKey) {
    pendingRequests.set(deduplicationKey, requestPromise);
    requestPromise.finally(() => {
      pendingRequests.delete(deduplicationKey);
    });
  }

  return requestPromise;
}

/**
 * API Client class
 */
export class ClaudeFlowAPIClient {
  /**
   * Get all accounts
   */
  async getAccounts(): Promise<{ accounts: AccountSummary[]; total: number }> {
    return makeRequest<{ accounts: AccountSummary[]; total: number }>('/api/dashboard/accounts', {
      method: 'GET',
    });
  }

  /**
   * Get account details by ID
   */
  async getAccountDetails(accountId: string): Promise<AccountDetails> {
    return makeRequest<AccountDetails>(`/api/dashboard/accounts/${encodeURIComponent(accountId)}`, {
      method: 'GET',
    });
  }

  async startKiroLogin(region: string = 'us-east-1'): Promise<{
    sessionId: string;
    verificationUri: string;
    verificationUriComplete: string;
    userCode: string;
    expiresIn: number;
    interval: number;
  }> {
    return makeRequest('/api/dashboard/accounts/kiro/start-login', {
      method: 'POST',
      body: JSON.stringify({ region }),
    });
  }

  async pollKiroLogin(sessionId: string): Promise<{
    status: 'pending' | 'complete';
    account?: AccountSummary;
  }> {
    return makeRequest('/api/dashboard/accounts/kiro/poll-login', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  /**
   * Get recent activity events
   */
  async getActivity(): Promise<{ events: ActivityEvent[]; total: number }> {
    return makeRequest<{ events: ActivityEvent[]; total: number }>('/api/dashboard/activity', {
      method: 'GET',
    });
  }

  /**
   * Get dashboard statistics
   */
  async getStats(): Promise<DashboardStats> {
    return makeRequest<DashboardStats>('/api/dashboard/stats', { method: 'GET' });
  }

  /**
   * Refresh account token (Kiro OAuth only)
   */
  async refreshAccountToken(accountId: string): Promise<{
    success: boolean;
    skipped?: boolean;
    account: {
      id: string;
      provider: string;
      expiresAt?: string;
      kiroCreditQuota?: KiroCreditQuota;
    };
  }> {
    return makeRequest<{
      success: boolean;
      skipped?: boolean;
      account: {
        id: string;
        provider: string;
        expiresAt?: string;
        kiroCreditQuota?: KiroCreditQuota;
      };
    }>(`/api/dashboard/accounts/${encodeURIComponent(accountId)}/refresh`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  /**
   * Delete account by ID
   */
  async deleteAccount(accountId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    return makeRequest<{
      success: boolean;
      message: string;
    }>(`/api/dashboard/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return makeRequest<{ status: string; timestamp: string }>('/health', { method: 'GET' });
  }

  /**
   * Readiness check
   */
  async readinessCheck(): Promise<{
    status: string;
    services: Record<string, boolean>;
    timestamp: string;
  }> {
    return makeRequest<{
      status: string;
      services: Record<string, boolean>;
      timestamp: string;
    }>('/ready', { method: 'GET' });
  }
}

/**
 * Default API client instance
 */
export const apiClient = new ClaudeFlowAPIClient();

/**
 * React hooks for API client (optional - for Next.js integration)
 */
export function useAPIClient() {
  return apiClient;
}
