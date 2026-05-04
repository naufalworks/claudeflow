# Implementation Plan: ClaudeFlow Authentication Fix

## Overview

This implementation plan breaks down the authentication architecture fix into discrete, executable tasks. The design uses TypeScript with concrete implementations, so all tasks will use TypeScript. The implementation is phased to minimize risk, starting with low-risk configuration changes and progressing to higher-risk core system modifications.

## Tasks

- [x] 1. Update configuration schema with discriminated unions
  - Update `src/config/schema.ts` to use discriminated union for account types
  - Add three account type schemas: `anthropic`, `proxy`, and `kiro`
  - Use Zod's `discriminatedUnion` for type-safe account configuration
  - Ensure each account type has proper validation rules
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ]* 1.1 Write property test for configuration schema
  - **Property 1: Round-trip consistency for all account types**
  - **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 17.1, 17.2, 17.3, 17.4**
  - Test that parsing then serializing produces equivalent configuration
  - Test all three account types (anthropic, proxy, kiro)
  - Test mixed account configurations

- [x] 2. Update configuration manager for environment variable loading
  - Modify `src/config/manager.ts` to load all three account types from environment variables
  - Add support for `ANTHROPIC_API_KEY_N` variables
  - Add support for `PROXY_API_KEY_N` and `PROXY_BASE_URL_N` variables
  - Add support for `KIRO_MACHINE_ID_N` and `KIRO_API_KEY_N` variables
  - Merge environment-based accounts with config file accounts
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ]* 2.1 Write unit tests for environment variable loading
  - Test loading direct Anthropic accounts from env vars
  - Test loading proxy accounts from env vars
  - Test loading OAuth accounts from env vars
  - Test merging env vars with config file accounts
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 3. Checkpoint - Verify configuration changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create authentication strategy interfaces and base classes
  - Create `src/auth/strategies/AuthStrategy.ts` with interface definition
  - Define `authenticate()`, `refreshSession()`, and `needsRefresh()` methods
  - Create `AuthResult` type for authentication responses
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 5. Implement AnthropicAuthStrategy
  - Create `src/auth/strategies/AnthropicAuthStrategy.ts`
  - Implement `authenticate()` method that validates API key format
  - Check for `sk-ant-` prefix in API keys
  - Return success result with validated API key
  - No session management needed for direct accounts
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.2_

- [ ]* 5.1 Write unit tests for AnthropicAuthStrategy
  - Test valid Anthropic API key authentication
  - Test invalid API key format rejection
  - Test missing API key handling
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 6. Implement ProxyAuthStrategy
  - Create `src/auth/strategies/ProxyAuthStrategy.ts`
  - Implement `authenticate()` method that validates API key and baseURL
  - Ensure both apiKey and baseURL are present
  - Return success result with API key and baseURL
  - No OAuth flow or session management
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 9.3_

- [ ]* 6.1 Write unit tests for ProxyAuthStrategy
  - Test valid proxy account authentication
  - Test missing API key handling
  - Test missing baseURL handling
  - Test invalid baseURL format
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 7. Implement OAuthAuthStrategy
  - Create `src/auth/strategies/OAuthAuthStrategy.ts`
  - Implement `authenticate()` method with OAuth flow (POST /auth/login)
  - Implement `refreshSession()` method (POST /auth/refresh)
  - Implement `needsRefresh()` method with 5-minute buffer
  - Handle session tokens and expiry times
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 9.4_

- [ ]* 7.1 Write unit tests for OAuthAuthStrategy
  - Test OAuth authentication flow with mock HTTP client
  - Test session refresh flow
  - Test needsRefresh logic with various expiry times
  - Test error handling for failed OAuth requests
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 8. Create AuthManager with strategy pattern
  - Create `src/auth/AuthManager.ts`
  - Initialize strategy map with all three strategies
  - Implement `authenticate()` method that delegates to appropriate strategy
  - Implement `refreshSession()` method that delegates to appropriate strategy
  - Implement `needsRefresh()` method that delegates to appropriate strategy
  - Handle unknown provider types with clear error messages
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ]* 8.1 Write integration tests for AuthManager
  - Test authentication with all three account types
  - Test session refresh for OAuth accounts
  - Test needsRefresh for OAuth accounts
  - Test error handling for unknown provider types
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 9. Checkpoint - Verify authentication strategies
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Create ResponseFormatValidator
  - Create `src/clients/ResponseFormatValidator.ts`
  - Implement `isAnthropicFormat()` method that validates raw Anthropic format
  - Check for required Anthropic fields: id (starts with "msg_"), type ("message"), role ("assistant"), content (array), model, usage
  - Reject OpenAI format (has "choices" array)
  - Reject any non-Anthropic format responses
  - _Requirements: 1.1, 2.1, 6.1 (implicit format validation requirement)_

- [ ]* 10.1 Write unit tests for ResponseFormatValidator
  - Test valid raw Anthropic format responses pass validation
  - Test OpenAI format responses fail validation
  - Test invalid/malformed responses fail validation
  - Test missing required fields fail validation
  - _Requirements: 1.1, 2.1, 6.1_

- [x] 11. Create AnthropicClient for direct API calls
  - Create `src/clients/AnthropicClient.ts`
  - Implement `sendRequest()` method that calls `https://api.anthropic.com/v1/messages`
  - Use `x-api-key` header for authentication
  - Include `anthropic-version` and `content-type` headers
  - **CRITICAL: Validate response format using ResponseFormatValidator**
  - Handle API responses and errors
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.2_

- [ ]* 11.1 Write unit tests for AnthropicClient
  - Test request construction with proper headers
  - Test successful API response handling
  - Test error response handling
  - **Test response format validation (must be raw Anthropic format)**
  - Mock axios for all tests
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 12. Create ProxyClient for Anthropic-compatible proxy calls
  - Create `src/clients/ProxyClient.ts`
  - Implement `sendRequest()` method that calls `{baseURL}/v1/messages`
  - Use `x-api-key` header for authentication
  - Include `anthropic-version` and `content-type` headers
  - Support dynamic baseURL from account configuration
  - **CRITICAL: Validate response format using ResponseFormatValidator**
  - **Throw clear error if proxy returns non-Anthropic format (e.g., OpenAI format)**
  - **Document that this is ONLY for Anthropic-compatible proxies (NOT 9router)**
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.3, 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ]* 12.1 Write unit tests for ProxyClient
  - Test request construction with baseURL
  - Test proper header inclusion
  - Test successful proxy response handling
  - Test error response handling
  - **Test response format validation (must be raw Anthropic format)**
  - **Test rejection of OpenAI format responses**
  - **Test clear error message when proxy returns wrong format**
  - Mock axios for all tests
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 13. Create OAuthClient for OAuth-based routers
  - Create `src/clients/OAuthClient.ts`
  - Implement `sendRequest()` method that calls `{mitmRouterUrl}/v1/messages`
  - Use `x-session-token` header for authentication
  - Include `anthropic-version` and `content-type` headers
  - Support session token from OAuth authentication
  - **CRITICAL: Validate response format using ResponseFormatValidator**
  - **Throw clear error if OAuth router returns non-Anthropic format**
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 8.4_

- [ ]* 13.1 Write unit tests for OAuthClient
  - Test request construction with session token
  - Test proper header inclusion
  - Test successful OAuth router response handling
  - Test error response handling
  - **Test response format validation (must be raw Anthropic format)**
  - **Test rejection of non-Anthropic format responses**
  - Mock axios for all tests
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 14. Checkpoint - Verify API clients
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Update Account Pool Manager to support all account types
  - Modify `src/accounts/account-pool-manager.ts`
  - Update `selectAccount()` to work with discriminated union types
  - Add authentication check using AuthManager before returning account
  - Implement `routeRequest()` method with switch statement for account types
  - Route to AnthropicClient for `anthropic` provider
  - Route to ProxyClient for `proxy` provider
  - Route to OAuthClient for `kiro` provider
  - **CRITICAL: Add response format validation after routing**
  - **Throw clear error if response is not raw Anthropic format**
  - **Include account type and ID in error messages**
  - Remove OAuth-only assumptions from account selection logic
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ]* 15.1 Write unit tests for Account Pool Manager
  - Test account selection with all three account types
  - Test routing to correct client based on provider type
  - Test authentication check before account selection
  - Test fallback logic when accounts fail
  - **Test response format validation in routeRequest**
  - **Test error handling when response is not raw Anthropic format**
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ]* 15.2 Write integration tests for end-to-end request flow
  - Test complete request flow with direct Anthropic account
  - Test complete request flow with Anthropic-compatible proxy account
  - Test complete request flow with OAuth account
  - Test mixed account type scenarios
  - Test account fallback on failure
  - **Test rejection of non-Anthropic format responses**
  - **Test clear error messages for format violations**
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 16. Checkpoint - Verify account pool manager integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Deprecate KiroAuthManager
  - Mark `src/accounts/kiro-auth-manager.ts` as deprecated with JSDoc comments
  - Add deprecation notice explaining migration to AuthManager
  - Keep implementation intact for backward compatibility
  - Update imports in main entry point to use new AuthManager
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ]* 17.1 Write regression tests for backward compatibility
  - Test that existing OAuth configurations still work
  - Test that KiroAuthManager still functions (deprecated but working)
  - Test migration path from old to new system
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 18. Update MITM client to support non-OAuth routers
  - Modify `src/accounts/kiro-mitm-client.ts`
  - Support requests without session tokens for proxy accounts
  - Use `x-api-key` header when session token not available
  - Remove requirement for `x-machine-id` and `x-session-token` for proxy accounts
  - Handle 404 responses from /auth endpoints gracefully
  - **CRITICAL: Add response format validation**
  - **Reject non-Anthropic format responses**
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ]* 18.1 Write unit tests for MITM client updates
  - Test proxy router requests with API key only
  - Test OAuth router requests with session token
  - Test graceful handling of 404 from /auth endpoints
  - **Test response format validation**
  - **Test rejection of non-Anthropic format responses**
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 19. Update CLI account add command
  - Modify `src/cli/commands/account.ts`
  - Add support for adding direct Anthropic accounts
  - Add support for adding Anthropic-compatible proxy accounts with baseURL
  - Add support for adding OAuth accounts with machineId and mitmRouterUrl
  - Add interactive prompts to select account type
  - Validate account configuration before saving
  - **Add warning when adding proxy account: "Proxy must return raw Anthropic format (NOT OpenAI format like 9router)"**
  - **Document that proxy accounts are ONLY for Anthropic-compatible proxies**
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ]* 19.1 Write CLI integration tests for account management
  - Test adding direct Anthropic account via CLI
  - Test adding Anthropic-compatible proxy account via CLI
  - Test adding OAuth account via CLI
  - Test validation errors for invalid configurations
  - **Test warning message for proxy accounts**
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 20. Update CLI account list command
  - Modify `src/cli/commands/account.ts`
  - Display account type (provider) clearly in list output
  - Show relevant fields for each account type
  - Remove session refresh attempts for non-OAuth accounts
  - Format output to distinguish between account types
  - **Add note for proxy accounts: "Proxy must return raw Anthropic format"**
  - _Requirements: 12.4, 12.5_

- [x] 21. Update health check system
  - Modify health check implementation to test all account types
  - Add connectivity test for direct Anthropic accounts
  - Add connectivity test for Anthropic-compatible proxy accounts using baseURL
  - Add OAuth authentication test for OAuth accounts
  - Run health checks independently for each account
  - Report failures with account type and ID
  - **Add response format validation in health checks**
  - **Report if proxy returns non-Anthropic format**
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ]* 21.1 Write unit tests for health checks
  - Test health check for direct Anthropic accounts
  - Test health check for Anthropic-compatible proxy accounts
  - Test health check for OAuth accounts
  - Test independent execution (no blocking)
  - Test failure reporting with account details
  - **Test detection of non-Anthropic format responses**
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 22. Checkpoint - Verify CLI and health check updates
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Update error handling and diagnostics
  - Implement account-type-specific error messages
  - Add "Anthropic API authentication failed" for direct accounts
  - Add "Proxy router authentication failed" with baseURL for proxy accounts
  - Add "OAuth authentication failed" with session details for OAuth accounts
  - Include account type and provider in all error logs
  - Add corrective action suggestions based on account type
  - **Add specific error for non-Anthropic format responses: "Response format validation failed. ClaudeFlow only supports raw Anthropic format. This proxy/router appears to return OpenAI or another format."**
  - **Suggest using direct Anthropic account if proxy returns wrong format**
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [ ]* 23.1 Write unit tests for error handling
  - Test error messages for each account type
  - Test error logging includes account type and provider
  - Test corrective action suggestions
  - **Test format validation error messages**
  - **Test suggestions when format validation fails**
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 24. Update documentation
  - Update `README.md` with all three account types and examples
  - Create/update `docs/CONFIGURATION.md` with detailed account type documentation
  - Update `.env.example` with environment variable examples for all account types
  - Update `config.example.json` with configuration examples for all account types
  - Document migration path from broken OAuth to working configurations
  - Explain when to use each account type
  - **CRITICAL: Document that proxy accounts are ONLY for Anthropic-compatible proxies**
  - **Explicitly state that 9router is NOT supported (converts to OpenAI format)**
  - **Document response format validation and what happens when format is wrong**
  - **Provide examples of supported vs unsupported proxy types**
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [x] 25. Create migration guide
  - Document how to migrate from broken OAuth configs to direct Anthropic (recommended)
  - Provide step-by-step migration instructions
  - Include before/after configuration examples
  - Explain backward compatibility guarantees
  - Document environment variable migration
  - **Warn against using 9router or other format-converting proxies**
  - **Explain the difference between Anthropic-compatible proxies and format-converting proxies**
  - _Requirements: 15.4, 15.5_

- [x] 26. Final checkpoint - Complete system validation
  - Run full test suite and ensure all tests pass
  - Verify all three account types work end-to-end
  - Test mixed account configurations
  - Verify backward compatibility with existing OAuth setups
  - Verify all optimization features work with all account types
  - **Verify response format validation works for all account types**
  - **Test that non-Anthropic format responses are properly rejected**
  - **Verify error messages are clear when format validation fails**
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties (round-trip consistency)
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end flows across multiple components
- The implementation is phased to minimize risk: configuration → auth strategies → clients → integration
- All optimization features (semantic deduplication, prompt caching, etc.) continue to work with all account types

**CRITICAL IMPLEMENTATION REQUIREMENTS:**

1. **Raw Anthropic Format Only, Everywhere**
   - ALL three account types (Direct Anthropic, Proxy, OAuth) MUST return raw Anthropic format
   - NO format conversion is supported anywhere in the system
   - Response format validation is MANDATORY in all clients

2. **Proxy Accounts Are NOT for 9router**
   - 9router converts responses to OpenAI format, which is NOT supported
   - Proxy accounts are ONLY for true MITM proxies that forward raw Anthropic format unchanged
   - Response format validation will reject any non-Anthropic format responses

3. **Response Format Validation**
   - Every client (AnthropicClient, ProxyClient, OAuthClient) MUST validate response format
   - Validation checks for required Anthropic fields: id (msg_*), type (message), role (assistant), content (array), usage
   - Validation rejects OpenAI format (has "choices" array)
   - Clear error messages when validation fails, suggesting direct Anthropic account

4. **Documentation Must Be Explicit**
   - Documentation MUST explicitly state that 9router is NOT supported
   - Documentation MUST explain the difference between Anthropic-compatible proxies and format-converting proxies
   - Documentation MUST warn users about format requirements for proxy accounts
