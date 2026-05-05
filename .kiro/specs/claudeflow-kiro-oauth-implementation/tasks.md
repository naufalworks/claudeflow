# Implementation Plan: ClaudeFlow Kiro OAuth Implementation

## Overview

This plan replaces ClaudeFlow's broken 9router-dependent authentication with direct Kiro OAuth authentication. Implementation is in TypeScript, following existing codebase patterns (Zod schemas, axios HTTP client, Jest testing). Tasks are organized in dependency order: foundation (types, config, keychain) → core auth (OAuth, tokens, JWT) → API client → account pooling → CLI commands → migration → testing.

## Tasks

- [x] 1. Set up project foundation and types
  - [x] 1.1 Install new dependencies
    - Install `fast-check` for property-based testing (dev dependency)
    - Install `keytar` or `@aspect-build/keychain` for OS keychain access
    - Install `jose` for JWT validation (lightweight, standards-compliant)
    - Install `crypto` types if needed (Node.js built-in)
    - _Requirements: 5.1, 12.1_
  
  - [x] 1.2 Create Kiro OAuth type definitions
    - Create `src/types/kiro-oauth.types.ts` with all new interfaces:
      - `OAuthClientConfig`, `OAuthTokens`, `PKCEChallenge`, `OAuthState`
      - `KeychainCredentials`, `KeychainEntry`
      - `TokenRefreshResult`, `JWTClaims`, `JWTValidationResult`
      - `KiroAPIConfig`, `KiroAPIError`
      - `AuthModeConfig`, `KiroPoolAccount`, `RuntimeAccountState`
      - `RateLimitInfo`, `AccountSelectionStrategy`
    - Export all types from `src/types/index.ts`
    - _Requirements: 1.4, 2.1, 3.1, 4.4, 5.1, 6.2, 7.1, 11.2_

  - [x] 1.3 Create custom error classes
    - Create `src/errors/kiro-errors.ts` with the error hierarchy from design:
      - `ClaudeFlowError` (base)
      - `AuthenticationError` (401/403)
      - `TokenRefreshError` (retryable)
      - `RateLimitError` (429 with retryAfter)
      - `QuotaExhaustedError` (402)
      - `ResponseFormatError` (non-Anthropic format)
      - `CircuitBreakerOpenError` (cooldown)
      - `NoHealthyAccountsError` (all accounts down)
    - Export from `src/errors/index.ts`
    - _Requirements: 7.8, 17.1-17.4_

- [x] 2. Implement configuration schema updates
  - [x] 2.1 Add KiroOAuthAccountSchema to config schema
    - In `src/config/schema.ts`, add `KiroOAuthAccountSchema` with:
      - `id: z.string().regex(/^kiro-[a-f0-9]+$/)`
      - `provider: z.literal('kiro-oauth')` (new provider literal to distinguish from legacy)
      - `region: z.enum(['us-east-1', 'us-west-2', 'eu-central-1', 'ap-southeast-1'])`
      - `profileArn: z.string().regex(...)` with AWS ARN pattern
      - `expiresAt: z.string().datetime()`
      - `lastUsed`, `requestCount`, `errorCount`, `priority` with defaults
      - `.strict()` to reject unknown fields
    - Add to `AccountSchema` discriminated union
    - Export `KiroOAuthAccount` type
    - _Requirements: 11.1-11.8_
  
  - [ ]* 2.2 Write property tests for config schema validation
    - Create `tests/property/schema-validation.property.test.ts`
    - **Property 17: Schema Validation Accepts/Rejects Correctly**
    - **Validates: Requirements 11.1, 11.4, 11.5, 11.6, 19.8**
    - Test: valid objects are accepted, unknown fields rejected, invalid regions rejected, bad profileArn rejected
    - Use `kiroAccountArbitrary` custom arbitrary from design

  - [x] 2.3 Add case-insensitive field parsing support
    - Create `src/config/field-mapper.ts` with mapper for snake_case ↔ camelCase
    - Map `profile_arn` → `profileArn`, `request_count` → `requestCount`, etc.
    - Integrate mapper into config loading in `src/config/manager.ts`
    - _Requirements: 19.10_

  - [ ]* 2.4 Write property test for case-insensitive parsing
    - Create `tests/property/case-insensitive.property.test.ts`
    - **Property 22: Case-Insensitive Field Parsing**
    - **Validates: Requirements 19.10**

- [x] 3. Implement secure credential storage (KeychainStore)
  - [x] 3.1 Create KeychainStore class
    - Create `src/auth/KeychainStore.ts` implementing:
      - `store(accountId, credentials)`: Store in OS keychain (keytar/credential-manager)
      - `retrieve(accountId)`: Get credentials from keychain
      - `delete(accountId)`: Remove credentials from keychain
      - `exists(accountId)`: Check if credentials exist
      - `detectBackend()`: Detect OS keychain backend (macOS/Windows/Linux)
    - Implement fallback: encrypted file `~/.claudeflow/credentials.enc` using AES-256-GCM with machine ID key
    - Service name: `claudeflow`, account: accountId string
    - _Requirements: 3.1-3.5, 3.8-3.10_

  - [x] 3.2 Implement config serialization security
    - Create `src/config/secure-serializer.ts`:
      - `serializeAccount(account)`: Strip sensitive fields (accessToken, refreshToken, clientSecret, apiKey, sessionToken)
      - `validateNoSensitiveData(json)`: Scan output for sensitive patterns
      - Add placeholder: `"credentials": "stored in keychain"`
      - Log warning if sensitive data detected in config file
    - _Requirements: 3.6-3.7, 19.6-19.7, 20.1-20.6_

  - [ ]* 3.3 Write property tests for config serialization security
    - Create `tests/property/config-serialization.property.test.ts`
    - **Property 5: Config Serialization Excludes Sensitive Data**
    - **Validates: Requirements 3.6, 3.7, 11.3, 19.6, 20.1-20.6**
    - **Property 20: Configuration Round-Trip**
    - **Validates: Requirements 19.1, 19.2**

  - [x] 4. Checkpoint - Validate foundation layer
  - Ensure all type definitions compile without errors
  - Ensure schema validates correctly with test fixtures
  - Ensure KeychainStore stores/retrieves correctly on current OS
  - Ensure serialization never includes sensitive fields
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement OAuth 2.0 + PKCE client
  - [x] 5.1 Create OAuthClient class
    - Create `src/auth/OAuthClient.ts` implementing:
      - `generatePKCE()`: Generate 43-128 char verifier + SHA-256 S256 challenge
      - `buildAuthorizationUrl(config, pkce, state)`: Build Kiro OAuth URL with provider selection
      - `startCallbackServer()`: Start HTTP server on localhost random port
      - `waitForCallback(state, timeoutMs)`: Wait for auth code with state validation
      - `exchangeCodeForTokens(code, codeVerifier, config)`: POST to token endpoint
      - `login(config)`: Full interactive flow (open browser → wait → exchange → return tokens)
      - `loginWithToken(token, config)`: Non-interactive for CI/CD
    - Support providers: AWS Builder ID, Google, GitHub
    - PKCE: SHA-256 hash, base64url encoding
    - State: crypto-random, constant-time comparison
    - Callback timeout: 5 minutes
    - _Requirements: 1.1-1.10_

  - [ ]* 5.2 Write property test for PKCE challenge round-trip
    - Create `tests/property/pkce.property.test.ts`
    - **Property 1: PKCE Challenge Round-Trip**
    - **Validates: Requirements 1.4**

  - [ ]* 5.3 Write property test for OAuth state validation
    - Create `tests/property/oauth-state.property.test.ts`
    - **Property 2: OAuth State Validation**
    - **Validates: Requirements 1.7**

  - [x] 5.4 Implement DualAuthModeHandler
    - Create `src/auth/DualAuthModeHandler.ts` implementing:
      - `detectMode(credentials)`: Check for clientId/clientSecret → aws-sso or kiro-desktop
      - `getTokenEndpoint(mode, region)`: Return correct endpoint per mode
      - `buildRefreshRequest(refreshToken, mode)`: Build mode-specific request body
    - Kiro Desktop: `https://prod.{region}.auth.desktop.kiro.dev/refreshToken`
    - AWS SSO: `https://oidc.{region}.amazonaws.com/token`
    - Default region: `us-east-1`
    - _Requirements: 2.1-2.8_

  - [ ]* 5.5 Write property tests for auth mode detection and endpoint URLs
    - Create `tests/property/auth-mode.property.test.ts`
    - **Property 3: Auth Mode Detection**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - **Property 4: Endpoint URL Construction**
    - **Validates: Requirements 2.4, 2.5, 2.6**

- [ ] 6. Implement token management
  - [x] 6.1 Create TokenManager class
    - Create `src/auth/TokenManager.ts` implementing:
      - `detectAuthMode(accountId)`: Delegate to DualAuthModeHandler
      - `refresh(accountId)`: Refresh token using correct mode/endpoint
      - `refreshAll(accountIds)`: Parallel refresh with `Promise.allSettled`
      - `needsRefresh(accountId)`: Check if token expires within 5 minutes
      - `startRefreshWorker()`: Background interval (every 60 seconds)
      - `stopRefreshWorker()`: Clear interval
    - On refresh success: update KeychainStore with new tokens (rotation)
    - On 401/403 failure: mark account as `re-auth-required`
    - Retry failed refreshes with exponential backoff (max 3 attempts)
    - Log all refresh events
    - _Requirements: 4.1-4.10_

  - [ ]* 6.2 Write property tests for token refresh logic
    - Create `tests/property/token-refresh.property.test.ts`
    - **Property 6: Token Refresh Need Detection**
    - **Validates: Requirements 4.2**
    - **Property 7: Token Refresh Updates Stored Credentials**
    - **Validates: Requirements 4.4, 4.6**
    - **Property 8: Failed Refresh Marks Re-auth Required**
    - **Validates: Requirements 4.5**
    - **Property 9: Exponential Backoff Invariant**
    - **Validates: Requirements 4.9, 7.10, 13.8**

- [ ] 7. Implement JWT validation
  - [x] 7.1 Create JWTValidator class
    - Create `src/auth/JWTValidator.ts` implementing:
      - `fetchPublicKeys(discoveryUrl)`: Fetch OIDC public keys, cache 24h
      - `validate(token, expectedIssuer, expectedAudience)`: Full JWT validation
      - `decode(token)`: Decode without validation (inspection only)
      - `isExpired(token)`: Check exp claim
    - Use `jose` library for JWT parsing and signature verification
    - Verify: iss, aud, exp > now, iat <= now
    - Reject invalid signatures and expired tokens
    - Refresh public keys on signature validation failure
    - _Requirements: 5.1-5.10_

  - [ ]* 7.2 Write property test for JWT claim validation
    - Create `tests/property/jwt-validation.property.test.ts`
    - **Property 10: JWT Claim Validation**
    - **Validates: Requirements 5.1-5.7**

  - [ ] 8. Checkpoint - Validate authentication layer
  - Ensure OAuthClient generates valid PKCE challenges
  - Ensure DualAuthModeHandler detects modes correctly
  - Ensure TokenManager refreshes tokens and handles failures
  - Ensure JWTValidator accepts valid tokens and rejects invalid ones
  - Ensure all tests pass, ask the user if questions arise.

- [-] 9. Implement Kiro API client (direct, no proxy)
  - [x] 9.1 Create KiroAPIClient class
    - Create `src/clients/KiroAPIClient.ts` implementing:
      - `sendRequest(request, accessToken, config)`: POST to Kiro API with auth headers
      - `sendStreamingRequest(request, accessToken, config)`: SSE streaming
      - `healthCheck(accessToken, config)`: Minimal test request
      - `getEndpoint(region)`: `https://codewhisperer.{region}.amazonaws.com/v1/messages`
    - Headers: `Authorization: Bearer {token}`, `anthropic-version: 2023-06-01`
    - Timeouts: connect 10s, read 60s
    - Retries: max 3 with exponential backoff
    - Error classification: 401→auth, 429→rate-limit, 402→quota, 5xx→server, network→network
    - _Requirements: 7.1-7.10_

  - [ ]* 9.2 Write property tests for API request format and error classification
    - Create `tests/property/api-request.property.test.ts`
    - **Property 14: API Request Format Correctness**
    - **Validates: Requirements 7.2, 7.3, 7.4**
    - **Property 16: Error Classification**
    - **Validates: Requirements 7.8**

  - [x] 9.3 Enhance ResponseFormatValidator for Kiro responses
    - Update `src/clients/ResponseFormatValidator.ts` to add:
      - Validation of `cache_creation_input_tokens` and `cache_read_input_tokens` in usage
      - Detailed rejection logging for OpenAI-format responses
      - `validateDetailed()` method returning specific failure reasons
    - Ensure existing tests still pass
    - _Requirements: 8.1-8.10_

  - [ ]* 9.4 Write property test for response format validation
    - Create `tests/property/response-format.property.test.ts`
    - **Property 15: Response Format Validation**
    - **Validates: Requirements 7.5, 7.6, 8.1-8.5**

- [ ] 10. Implement secure logging
  - [x] 10.1 Create log sanitization utility
    - Create `src/utils/log-sanitizer.ts` implementing:
      - `sanitize(message)`: Replace Bearer tokens, long hex (>20 chars), base64 (>20 chars) with `****{last4}`
      - Pattern matching for common token formats
    - Integrate into existing logger in `src/cli/utils/logger.ts`
    - Ensure structured JSON logging support
    - _Requirements: 12.1-12.9_

  - [ ]* 10.2 Write property test for log sanitization
    - Create `tests/property/log-sanitization.property.test.ts`
    - **Property 18: Log Sanitization**
    - **Validates: Requirements 12.1, 12.2**

- [x] 11. Checkpoint - Validate API client layer
  - Ensure KiroAPIClient sends correct headers and format
  - Ensure ResponseFormatValidator catches OpenAI format and accepts Anthropic format
  - Ensure log sanitizer never exposes tokens
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement enhanced account pool management
  - [x] 12.1 Create circuit breaker implementation
    - Create `src/accounts/circuit-breaker.ts` implementing:
      - State machine: closed → open (after 5 failures) → half-open (after 60s) → closed (on success)
      - `recordSuccess()`, `recordFailure()`, `canExecute()`, `getState()`
      - In open state: reject all requests immediately
    - _Requirements: 17.6, 17.7_

  - [ ]* 12.2 Write property test for circuit breaker state machine
    - Create `tests/property/circuit-breaker.property.test.ts`
    - **Property 19: Circuit Breaker State Machine**
    - **Validates: Requirements 17.6, 17.7**

  - [x] 12.3 Create rate limiter
    - Create `src/accounts/rate-limiter.ts` implementing:
      - Per-account request tracking: per minute, per hour, per day
      - Parse rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
      - Preemptive switching at 90% usage
      - Exponential backoff on 429: 1s, 2s, 4s, 8s
      - Per-account request queue, max 5 concurrent
    - _Requirements: 14.1-14.10_

  - [x] 12.4 Create health monitor
    - Create `src/accounts/health-monitor.ts` implementing:
      - Periodic health checks (every 5 minutes)
      - Minimal API call: `max_tokens: 1, messages: [{role: "user", content: "test"}]`
      - Mark healthy on success, unhealthy after 3 consecutive failures
      - Skip unhealthy accounts in routing, retry periodically
    - _Requirements: 15.1-15.10_

  - [x] 12.5 Create quota tracker
    - Create `src/accounts/quota-tracker.ts` implementing:
      - Track requests per account with time windows
      - Parse and store rate limit headers
      - Report quota status: used, remaining, reset time
      - Alert when all accounts near limits
    - _Requirements: 14.1, 14.2, 14.5, 14.8-14.10_

  - [x] 12.6 Update AccountPoolManager for Kiro OAuth accounts
    - Modify `src/accounts/account-pool-manager.ts` to:
      - Support `KiroOAuthAccount` type in addition to existing types
      - Implement account selection strategies: round-robin, priority-based, quota-aware
      - Integrate circuit breaker per account
      - Integrate rate limiter per account
      - Integrate health monitor
      - Implement failover: on error, select next available account
      - Generate account ID from profileArn hash: `kiro-{hash}`
    - _Requirements: 6.1-6.10_

  - [ ]* 12.7 Write property tests for account selection and health tracking
    - Create `tests/property/account-id.property.test.ts`
    - **Property 11: Account ID Format**
    - **Validates: Requirements 6.2**
    - Create `tests/property/account-selection.property.test.ts`
    - **Property 12: Account Selection Returns Valid Healthy Account**
    - **Validates: Requirements 6.5, 6.6, 6.7**
    - **Property 13: Unhealthy After Three Consecutive Errors**
    - **Validates: Requirements 6.8, 15.5, 15.6**

- [x] 13. Checkpoint - Validate account pool layer
  - Ensure circuit breaker transitions correctly
  - Ensure rate limiter prevents burst traffic
  - Ensure health monitor detects unhealthy accounts
  - Ensure account pool selects healthy accounts and fails over
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement TLS and transport security
  - [x] 14.1 Configure TLS security for all HTTP clients
    - Create `src/utils/tls-config.ts` with:
      - TLS 1.2+ enforcement for all HTTPS connections
      - Certificate chain validation against system trust store
      - Reject self-signed certificates in production
      - Secure cipher suites only (no RC4, DES)
      - Connection timeout: 10s, read timeout: 60s
      - Support custom CA via `KIRO_CA_CERT` env var
    - Apply to KiroAPIClient, OAuthClient, TokenManager
    - _Requirements: 13.1-13.10_

- [x] 15. Implement CLI commands
  - [x] 15.1 Rewrite login command
    - Modify `src/cli/commands/login.ts` to implement:
      - `claudeflow login` with optional `--provider [aws|google|github]`, `--region [region]`
      - Interactive provider selection when no flag given
      - Default region: `us-east-1`
      - Open browser → wait for auth → store tokens in keychain → save account to config
      - Success message: `✓ Account added successfully! Account ID: kiro-{id}`
      - Error messages with troubleshooting steps
      - `--token` flag for non-interactive CI/CD mode
      - Duplicate account detection
    - Wire OAuthClient → TokenManager → KeychainStore → ConfigManager
    - _Requirements: 9.1-9.10_

  - [x] 15.2 Update account management commands
    - Modify `src/cli/commands/account.ts` to add:
      - `account list` with colored output: green (active), yellow (expiring), red (expired/error)
      - `account list --json` for scripting
      - `account remove <id>`: delete from config AND keychain
      - `account refresh <id>`: manual token refresh via TokenManager
      - `account test <id>`: connectivity test via KiroAPIClient.healthCheck
      - `account set-priority <id> <priority>`: update priority for routing
    - Display: account ID, region, profileArn, status, last used, request count
    - _Requirements: 10.1-10.10_

  - [x] 15.3 Add quota show command
    - Modify `src/cli/commands/quota.ts` (or create if not exists):
      - `claudeflow quota show`: display per-account quota status
      - Show: requests used, remaining, reset time
      - Alert when all accounts near limits
    - _Requirements: 14.8-14.9_

  - [x] 15.4 Update health command
    - Modify `src/cli/commands/health.ts` to include:
      - Per-account health status from HealthMonitor
      - Overall status, infrastructure status, account status
    - _Requirements: 15.1, 15.9-15.10_

  - [x] 15.5 Add debug validate-response command
    - Create `src/cli/commands/debug.ts`:
      - `claudeflow debug validate-response`: make test API call and validate response format
      - Show detailed validation results
    - _Requirements: 8.8_

- [ ] 16. Implement migration from 9router
  - [x] 16.1 Create migration handler
    - Create `src/cli/commands/migrate.ts` implementing:
      - `claudeflow migrate from-9router`
      - Detect old `OAuthAccountSchema` configurations (provider: 'kiro' with kiroConfig)
      - Backup old config to `config.json.backup.{timestamp}`
      - Remove old 9router account entries
      - Guide user through `claudeflow login` for each migrated account
      - Preserve optimization settings (caching, deduplication, etc.)
      - Validate new config before removing old config
    - _Requirements: 16.1-16.10_

  - [ ]* 16.2 Write property test for migration equivalence
    - Create `tests/property/migration.property.test.ts`
    - **Property 21: Migration Preserves Equivalence**
    - **Validates: Requirements 11.9, 16.7, 16.10**

- [x] 17. Integrate with existing auth system
  - [x] 17.1 Create KiroOAuthAuthStrategy
    - Create `src/auth/strategies/KiroOAuthAuthStrategy.ts` implementing `AuthStrategy`:
      - `authenticate(account)`: Get token from KeychainStore, validate via JWTValidator
      - `refreshSession(account)`: Delegate to TokenManager
      - `needsRefresh(account)`: Check token expiry
    - Register in `src/auth/AuthManager.ts` strategies map: `'kiro-oauth'` → new strategy
    - _Requirements: 2.1, 4.1-4.3_

  - [x] 17.2 Wire KiroAPIClient into request routing
    - Modify request routing in `src/orchestrators/tool-orchestrator.ts` and/or `src/server/routes.ts`:
      - When account provider is `kiro-oauth`, use KiroAPIClient instead of OAuthClient
      - Route through AccountPoolManager for account selection
      - Handle error recovery: 401 → refresh → retry, 429 → backoff, 402 → failover
      - Validate response format before returning to client
    - _Requirements: 7.1, 7.7, 8.1_

  - [x] 17.3 Add CLI migrate command registration
    - Register `migrate` command in CLI entry point (`src/cli/bin/`)
    - Wire to migration handler
    - _Requirements: 16.5_

- [x] 18. Checkpoint - Validate integration layer
  - Ensure login command completes full OAuth flow end-to-end
  - Ensure account commands correctly manage keychain + config
  - Ensure migration correctly converts old accounts
  - Ensure request routing uses KiroAPIClient for kiro-oauth accounts
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Write unit tests for core components
  - [ ]* 19.1 Write unit tests for OAuthClient
    - Create `tests/unit/oauth-client.test.ts`
    - Test PKCE generation examples, URL construction per provider, callback server lifecycle
    - Test error conditions: timeout, invalid state, token exchange failure
    - _Requirements: 1.1-1.10_

  - [ ]* 19.2 Write unit tests for KeychainStore
    - Create `tests/unit/keychain-store.test.ts`
    - Test store/retrieve/delete round-trip, backend detection, fallback encryption
    - _Requirements: 3.1-3.10_

  - [ ]* 19.3 Write unit tests for TokenManager
    - Create `tests/unit/token-manager.test.ts`
    - Test refresh flow for both modes, parallel refresh, background worker
    - _Requirements: 4.1-4.10_

  - [ ]* 19.4 Write unit tests for KiroAPIClient
    - Create `tests/unit/kiro-api-client.test.ts`
    - Test request headers, streaming, error classification, retry logic
    - _Requirements: 7.1-7.10_

  - [ ]* 19.5 Write unit tests for rate limiter and health monitor
    - Create `tests/unit/rate-limiter.test.ts` and `tests/unit/health-monitor.test.ts`
    - Test rate tracking, backoff timing, health check cycles
    - _Requirements: 14.1-14.10, 15.1-15.10_

- [ ] 20. Write integration tests
  - [ ]* 20.1 Write integration test for full OAuth flow
    - Create `tests/integration/oauth-flow.integration.test.ts`
    - Mock browser + callback server + Kiro auth endpoint
    - Test complete login → token exchange → storage flow
    - _Requirements: 1.1-1.10_

  - [ ]* 20.2 Write integration test for token refresh flow
    - Create `tests/integration/token-refresh.integration.test.ts`
    - Mock Kiro token endpoint with various responses
    - Test refresh success, failure, rotation, parallel refresh
    - _Requirements: 4.1-4.10_

  - [ ]* 20.3 Write integration test for account pool failover
    - Create `tests/integration/account-pool.integration.test.ts`
    - Simulate account failures and verify failover behavior
    - Test circuit breaker integration with pool
    - _Requirements: 6.5-6.8_

  - [ ]* 20.4 Write integration test for migration flow
    - Create `tests/integration/migration.integration.test.ts`
    - Test old config → migration → verify new config + keychain storage
    - _Requirements: 16.1-16.10_

  - [ ]* 20.5 Write integration test for CLI commands
    - Create `tests/integration/cli-commands.integration.test.ts`
    - Test command parsing, output formatting, error handling
    - _Requirements: 9.1-9.10, 10.1-10.10_

- [x] 21. Final checkpoint - Full validation
  - Run all property tests, unit tests, and integration tests
  - Verify TLS enforcement on all connections
  - Verify no sensitive data in logs or config files
  - Verify account pooling works with 100 accounts without degradation
  - Verify migration preserves all non-sensitive settings
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints (4, 8, 11, 13, 18, 21) ensure incremental validation
- Property tests validate the 22 universal correctness properties from the design
- Unit tests cover specific examples, edge cases, and error conditions
- Integration tests verify end-to-end flows with mocked external services
- The implementation language is TypeScript, matching the existing codebase
- New files follow existing codebase patterns (Zod schemas, axios HTTP client, Jest tests)
- The existing `OAuthClient.ts` (9router-based) remains for backward compatibility; new `KiroAPIClient.ts` handles direct Kiro OAuth
- The `ResponseFormatValidator.ts` is enhanced in-place, not replaced
