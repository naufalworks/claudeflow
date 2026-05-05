# Requirements Document: ClaudeFlow Kiro OAuth Implementation

## Introduction

ClaudeFlow currently has a broken authentication system that attempts to use OAuth endpoints that don't exist, and relies on 9router which converts Anthropic format to OpenAI format (losing critical features like prompt caching and extended thinking).

This spec implements **direct Kiro OAuth authentication** based on the kiro-gateway architecture, enabling ClaudeFlow to:
- Authenticate directly with Kiro using web-based OAuth (AWS Builder ID, Google, GitHub)
- Call Kiro API directly without 9router
- Preserve 100% Anthropic format throughout the system
- Support multiple Kiro accounts (up to 100) with intelligent pooling
- Provide automatic token refresh and session management

**Critical Goal:** Replace 9router dependency with direct Kiro OAuth, maintaining all ClaudeFlow optimization features while preserving native Anthropic API capabilities.

## Glossary

- **Kiro**: AWS service providing free access to Claude models via AWS Builder ID authentication
- **OAuth**: Open Authorization protocol for secure authentication via third-party providers
- **AWS_Builder_ID**: Free AWS identity for developers, used for Kiro authentication
- **PKCE**: Proof Key for Code Exchange, security extension for OAuth public clients
- **Access_Token**: Short-lived JWT token for API authentication (typically 1 hour)
- **Refresh_Token**: Long-lived token for obtaining new access tokens (typically 90 days)
- **Profile_ARN**: AWS Resource Name identifying the user's Kiro profile
- **Session_Token**: Generic term for access token in the context of active sessions
- **Token_Refresh**: Process of obtaining new access token using refresh token
- **Token_Rotation**: Security practice of issuing new refresh token with each refresh
- **Account_Pool**: Collection of multiple Kiro accounts for load balancing and failover
- **Round_Robin**: Account selection strategy that cycles through accounts sequentially
- **Quota_Aware_Routing**: Account selection based on remaining quota and usage patterns
- **Kiro_Desktop_Auth**: Authentication mode for Kiro IDE users (no clientId/clientSecret)
- **AWS_SSO_OIDC**: Authentication mode for AWS SSO users (has clientId/clientSecret)
- **OS_Keychain**: Secure credential storage (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **JWT_Validation**: Verifying JSON Web Token signature and claims
- **Anthropic_Format**: Native Anthropic API response format (NOT OpenAI format)
- **Response_Format_Validation**: Ensuring API responses are in raw Anthropic format

## Requirements

### Requirement 1: Web-Based OAuth Login Flow

**User Story:** As a developer, I want to login via web browser with AWS Builder ID, Google, or GitHub, so that I can authenticate with Kiro without installing Kiro IDE.

#### Acceptance Criteria

1. WHEN user runs `claudeflow login`, THE System SHALL open default web browser to OAuth provider selection page
2. THE System SHALL support three OAuth providers: AWS Builder ID, Google, GitHub
3. WHEN user selects a provider, THE System SHALL redirect to provider's authentication page
4. THE System SHALL implement PKCE (Proof Key for Code Exchange) with SHA-256 code challenge
5. WHEN user completes authentication, THE System SHALL receive authorization code via callback
6. THE System SHALL exchange authorization code for access token and refresh token
7. THE System SHALL validate the OAuth state parameter to prevent CSRF attacks
8. WHEN authentication succeeds, THE System SHALL display success message with account details
9. WHEN authentication fails, THE System SHALL display clear error message with troubleshooting steps
10. THE OAuth callback server SHALL listen on localhost with a random available port

### Requirement 2: Dual Authentication Mode Support

**User Story:** As a developer, I want the system to automatically detect whether I'm using Kiro Desktop Auth or AWS SSO, so that authentication works seamlessly regardless of my setup.

#### Acceptance Criteria

1. THE System SHALL detect authentication mode based on presence of clientId and clientSecret in credentials
2. WHEN clientId and clientSecret are NOT present, THE System SHALL use Kiro Desktop Auth mode
3. WHEN clientId and clientSecret ARE present, THE System SHALL use AWS SSO (OIDC) mode
4. FOR Kiro Desktop Auth, THE System SHALL use endpoint: `https://prod.{region}.auth.desktop.kiro.dev/refreshToken`
5. FOR AWS SSO, THE System SHALL use endpoint: `https://oidc.{region}.amazonaws.com/token`
6. THE System SHALL auto-detect region from credentials or default to `us-east-1`
7. WHEN authentication mode is detected, THE System SHALL log the mode for debugging
8. THE System SHALL handle both modes transparently without user configuration

### Requirement 3: Secure Credential Storage

**User Story:** As a developer, I want my OAuth credentials stored securely in OS keychain, so that my tokens are protected from unauthorized access.

#### Acceptance Criteria

1. THE System SHALL store access tokens, refresh tokens, and client secrets in OS-native secure storage
2. ON macOS, THE System SHALL use macOS Keychain
3. ON Windows, THE System SHALL use Windows Credential Manager
4. ON Linux, THE System SHALL use libsecret (Secret Service API)
5. THE System SHALL encrypt credentials at rest using OS-provided encryption
6. THE System SHALL NOT store credentials in plaintext config files
7. THE Config file SHALL store only non-sensitive metadata: account ID, region, profileArn, expiresAt
8. WHEN retrieving credentials, THE System SHALL request OS keychain access with user permission
9. WHEN storing credentials, THE System SHALL set appropriate access control (current user only)
10. THE System SHALL clear credentials from memory immediately after use

### Requirement 4: Automatic Token Refresh

**User Story:** As a developer, I want tokens to refresh automatically before expiry, so that my sessions don't interrupt my work.

#### Acceptance Criteria

1. THE System SHALL monitor token expiry time for all accounts
2. WHEN token expires within 5 minutes, THE System SHALL automatically refresh the token
3. THE System SHALL use refresh token to obtain new access token
4. WHEN refresh succeeds, THE System SHALL update stored credentials with new tokens
5. WHEN refresh fails with 401/403, THE System SHALL mark account as requiring re-authentication
6. THE System SHALL implement token rotation (store new refresh token if provided)
7. THE System SHALL refresh tokens in background without blocking requests
8. WHEN multiple accounts need refresh, THE System SHALL refresh them in parallel
9. THE System SHALL retry failed refreshes with exponential backoff (max 3 attempts)
10. THE System SHALL log all token refresh events for audit

### Requirement 5: JWT Token Validation

**User Story:** As a developer, I want JWT tokens validated for security, so that compromised or malicious tokens are rejected.

#### Acceptance Criteria

1. THE System SHALL validate JWT signature using public keys from OIDC discovery endpoint
2. THE System SHALL verify the `iss` (issuer) claim matches expected OAuth provider
3. THE System SHALL verify the `aud` (audience) claim matches expected client ID
4. THE System SHALL verify the `exp` (expiration) claim is in the future
5. THE System SHALL verify the `iat` (issued at) claim is not in the future
6. THE System SHALL reject tokens with invalid signatures
7. THE System SHALL reject expired tokens
8. THE System SHALL cache OIDC public keys with 24-hour TTL
9. THE System SHALL refresh public keys when signature validation fails
10. THE System SHALL log all token validation failures for security audit

### Requirement 6: Multi-Account Support with Pooling

**User Story:** As a developer, I want to manage multiple Kiro accounts (up to 100), so that I can pool quota across accounts and maximize throughput.

#### Acceptance Criteria

1. THE System SHALL support adding up to 100 Kiro accounts
2. THE System SHALL assign unique account IDs in format: `kiro-{profileArn-hash}`
3. THE System SHALL store account metadata: id, region, profileArn, lastUsed, requestCount, errorCount
4. THE System SHALL track quota usage per account (requests per hour/day)
5. THE System SHALL implement account selection strategies: round-robin, priority-based, quota-aware
6. WHEN selecting account, THE System SHALL prefer accounts with available quota
7. WHEN account hits quota limit, THE System SHALL automatically failover to next available account
8. THE System SHALL mark accounts as unhealthy after 3 consecutive errors
9. THE System SHALL periodically health-check unhealthy accounts (every 5 minutes)
10. THE System SHALL display account pool status via `claudeflow account list` command

### Requirement 7: Direct Kiro API Communication

**User Story:** As a developer, I want ClaudeFlow to call Kiro API directly, so that I get 100% Anthropic format without 9router conversion.

#### Acceptance Criteria

1. THE System SHALL call Kiro API endpoint: `https://codewhisperer.{region}.amazonaws.com/v1/messages`
2. THE System SHALL include `Authorization: Bearer {accessToken}` header in all API requests
3. THE System SHALL include `anthropic-version: 2023-06-01` header
4. THE System SHALL send requests in raw Anthropic format (NOT OpenAI format)
5. THE System SHALL validate responses are in raw Anthropic format
6. WHEN response is NOT Anthropic format, THE System SHALL reject the response with error
7. THE System SHALL support streaming responses via Server-Sent Events (SSE)
8. THE System SHALL handle Kiro-specific error codes: 401 (auth), 429 (rate limit), 402 (quota)
9. WHEN receiving 401 error, THE System SHALL trigger token refresh
10. WHEN receiving 429 error, THE System SHALL implement exponential backoff

### Requirement 8: Response Format Validation

**User Story:** As a developer, I want automatic validation that responses are in Anthropic format, so that I'm alerted if format conversion occurs.

#### Acceptance Criteria

1. THE System SHALL validate all API responses against Anthropic format schema
2. THE Response SHALL have required fields: `id` (starts with "msg_"), `type: "message"`, `role: "assistant"`, `content` (array), `model`, `usage`
3. THE Response SHALL NOT have OpenAI-specific fields: `choices`, `object: "chat.completion"`
4. WHEN response validation fails, THE System SHALL log detailed error with response sample
5. WHEN response validation fails, THE System SHALL return error to client with explanation
6. THE System SHALL track response format validation failures per account
7. WHEN account consistently returns invalid format, THE System SHALL mark account as incompatible
8. THE System SHALL provide diagnostic command: `claudeflow debug validate-response`
9. THE Validation SHALL check content blocks: text, thinking, tool_use, tool_result
10. THE Validation SHALL verify usage object has: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens

### Requirement 9: CLI Login Command

**User Story:** As a developer, I want a simple CLI command to login, so that I can quickly add Kiro accounts.

#### Acceptance Criteria

1. THE CLI SHALL provide command: `claudeflow login`
2. THE Command SHALL accept optional flags: `--provider [aws|google|github]`, `--region [region]`
3. WHEN no provider specified, THE System SHALL prompt user to select provider
4. WHEN no region specified, THE System SHALL default to `us-east-1`
5. THE Command SHALL open browser for OAuth authentication
6. THE Command SHALL display waiting message: "Waiting for authentication in browser..."
7. WHEN authentication succeeds, THE Command SHALL display: "✓ Account added successfully! Account ID: kiro-{id}"
8. WHEN authentication fails, THE Command SHALL display error and suggest troubleshooting
9. THE Command SHALL support non-interactive mode with `--token` flag for CI/CD
10. THE Command SHALL validate that account doesn't already exist before adding

### Requirement 10: CLI Account Management

**User Story:** As a developer, I want to manage my Kiro accounts via CLI, so that I can view, remove, and configure accounts easily.

#### Acceptance Criteria

1. THE CLI SHALL provide command: `claudeflow account list` to display all accounts
2. THE List SHALL show: account ID, region, profileArn, status (active/expired/error), last used, request count
3. THE CLI SHALL provide command: `claudeflow account remove <account-id>` to remove account
4. WHEN removing account, THE System SHALL delete credentials from OS keychain
5. THE CLI SHALL provide command: `claudeflow account refresh <account-id>` to manually refresh token
6. THE CLI SHALL provide command: `claudeflow account test <account-id>` to test account connectivity
7. THE Test SHALL make a minimal API call and report success/failure
8. THE CLI SHALL provide command: `claudeflow account set-priority <account-id> <priority>` for priority-based routing
9. THE CLI SHALL use colored output: green (active), yellow (expiring soon), red (expired/error)
10. THE CLI SHALL support JSON output with `--json` flag for scripting

### Requirement 11: Configuration Schema Updates

**User Story:** As a developer, I want a clear configuration schema for Kiro accounts, so that I understand the account structure.

#### Acceptance Criteria

1. THE Config Schema SHALL define KiroAccount type with discriminated union: `provider: "kiro"`
2. THE KiroAccount SHALL have fields: id, provider, region, profileArn, expiresAt, lastUsed, requestCount, errorCount, priority
3. THE Config Schema SHALL NOT store sensitive fields (accessToken, refreshToken, clientSecret) in config file
4. THE Config Schema SHALL validate region against whitelist: us-east-1, us-west-2, eu-central-1, ap-southeast-1
5. THE Config Schema SHALL validate profileArn format: `arn:aws:codewhisperer:{region}:{account-id}:profile/{profile-id}`
6. THE Config Schema SHALL validate expiresAt is a valid ISO 8601 date string
7. THE Config Schema SHALL provide default values: priority=0, requestCount=0, errorCount=0
8. THE Config Schema SHALL reject invalid configurations with descriptive error messages
9. THE Config Schema SHALL support migration from old OAuth account format
10. THE Config Schema SHALL be documented in JSON Schema format

### Requirement 12: Secure Logging and Audit

**User Story:** As a developer, I want secure logging that doesn't expose tokens, so that my credentials remain protected in logs.

#### Acceptance Criteria

1. THE System SHALL sanitize all logs to remove access tokens, refresh tokens, and client secrets
2. WHEN logging credentials, THE System SHALL show only last 4 characters: `****abc123`
3. THE System SHALL log authentication events: login, logout, token refresh, token expiry
4. THE System SHALL log account selection decisions: which account selected and why
5. THE System SHALL log API errors with sanitized request/response (no tokens)
6. THE System SHALL log security events: invalid JWT, failed validation, suspicious activity
7. THE System SHALL use structured logging (JSON format) for easy parsing
8. THE System SHALL include correlation IDs for tracing requests across components
9. THE System SHALL support log levels: debug, info, warn, error
10. THE System SHALL rotate log files daily and retain for 30 days

### Requirement 13: TLS and Transport Security

**User Story:** As a developer, I want enforced TLS security, so that my credentials and data are protected in transit.

#### Acceptance Criteria

1. THE System SHALL enforce TLS 1.2 or higher for all HTTPS connections
2. THE System SHALL reject self-signed certificates in production mode
3. THE System SHALL validate certificate chains against system trust store
4. THE System SHALL implement certificate pinning for Kiro auth endpoints
5. THE System SHALL use secure cipher suites (no weak ciphers like RC4, DES)
6. THE System SHALL set connection timeout: 10 seconds
7. THE System SHALL set read timeout: 60 seconds for API calls
8. THE System SHALL retry failed connections with exponential backoff (max 3 attempts)
9. THE System SHALL log TLS errors with certificate details (no private keys)
10. THE System SHALL support custom CA certificates via environment variable: `KIRO_CA_CERT`

### Requirement 14: Rate Limiting and Quota Management

**User Story:** As a developer, I want intelligent rate limiting, so that I don't trigger API abuse detection or account bans.

#### Acceptance Criteria

1. THE System SHALL track requests per account: per minute, per hour, per day
2. THE System SHALL respect rate limit headers from Kiro API: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
3. WHEN rate limit is approaching (90% used), THE System SHALL switch to next account
4. WHEN receiving 429 (rate limit) error, THE System SHALL implement exponential backoff: 1s, 2s, 4s, 8s
5. THE System SHALL track quota reset times and resume using account after reset
6. THE System SHALL implement per-account request queue to prevent burst traffic
7. THE System SHALL limit concurrent requests per account: max 5 concurrent
8. THE System SHALL provide quota status via `claudeflow quota show` command
9. THE Quota display SHALL show: requests used, requests remaining, reset time
10. THE System SHALL alert when all accounts are near quota limits

### Requirement 15: Health Checks and Monitoring

**User Story:** As a developer, I want health checks for all accounts, so that I know which accounts are working.

#### Acceptance Criteria

1. THE System SHALL provide health check endpoint: `GET /health`
2. THE Health check SHALL test: Redis connectivity, Qdrant connectivity, Kiro API connectivity
3. THE System SHALL perform per-account health checks every 5 minutes
4. THE Account health check SHALL make minimal API call: `max_tokens: 1, messages: [{role: "user", content: "test"}]`
5. WHEN health check succeeds, THE System SHALL mark account as healthy
6. WHEN health check fails 3 times consecutively, THE System SHALL mark account as unhealthy
7. THE System SHALL NOT route requests to unhealthy accounts
8. THE System SHALL retry unhealthy accounts every 5 minutes
9. THE System SHALL provide health status via `claudeflow health` command
10. THE Health display SHALL show: overall status, per-account status, infrastructure status

### Requirement 16: Migration from 9router

**User Story:** As a developer currently using 9router, I want a clear migration path, so that I can switch to direct Kiro OAuth.

#### Acceptance Criteria

1. THE System SHALL provide migration guide in documentation
2. THE Migration guide SHALL explain why 9router is incompatible (OpenAI format conversion)
3. THE Migration guide SHALL provide step-by-step instructions for switching to direct Kiro OAuth
4. THE System SHALL detect old 9router configurations and display migration warning
5. THE System SHALL provide migration command: `claudeflow migrate from-9router`
6. THE Migration command SHALL backup old configuration before changes
7. THE Migration command SHALL remove 9router account configurations
8. THE Migration command SHALL guide user through `claudeflow login` for each account
9. THE Migration SHALL preserve optimization settings (caching, deduplication, etc.)
10. THE Migration SHALL validate new configuration before removing old configuration

### Requirement 17: Error Handling and Recovery

**User Story:** As a developer, I want clear error messages and automatic recovery, so that I can quickly resolve issues.

#### Acceptance Criteria

1. WHEN authentication fails, THE System SHALL display specific error: "Authentication failed: {reason}"
2. WHEN token refresh fails, THE System SHALL display: "Token expired. Please run: claudeflow login"
3. WHEN API call fails, THE System SHALL display: "API error: {status} {message}"
4. WHEN all accounts are unavailable, THE System SHALL display: "No healthy accounts available. Check: claudeflow health"
5. THE System SHALL distinguish between transient errors (retry) and permanent errors (alert)
6. THE System SHALL implement circuit breaker pattern: open circuit after 5 consecutive failures
7. THE System SHALL automatically close circuit after 60 seconds
8. THE System SHALL provide troubleshooting suggestions for common errors
9. THE System SHALL log full error details for debugging (with sanitized credentials)
10. THE System SHALL support debug mode: `CLAUDEFLOW_DEBUG=1` for verbose logging

### Requirement 18: Documentation and Examples

**User Story:** As a developer, I want comprehensive documentation, so that I can set up and use Kiro OAuth authentication easily.

#### Acceptance Criteria

1. THE Documentation SHALL include setup guide: "Getting Started with Kiro OAuth"
2. THE Documentation SHALL explain OAuth providers: AWS Builder ID, Google, GitHub
3. THE Documentation SHALL provide example commands for all CLI operations
4. THE Documentation SHALL document configuration schema with examples
5. THE Documentation SHALL explain account pooling strategies with use cases
6. THE Documentation SHALL provide troubleshooting guide for common issues
7. THE Documentation SHALL document security best practices
8. THE Documentation SHALL explain migration from 9router
9. THE Documentation SHALL include architecture diagrams showing OAuth flow
10. THE Documentation SHALL be available in README.md and docs/KIRO_OAUTH.md

## Parser and Serializer Requirements

### Requirement 19: Configuration Round-Trip Property

**User Story:** As a developer, I want configuration to serialize and deserialize correctly, so that I don't lose data when saving/loading config.

#### Acceptance Criteria

1. FOR ALL valid KiroAccount configurations, parsing then serializing SHALL produce equivalent JSON
2. FOR ALL valid Config objects, serializing then parsing SHALL produce equivalent object
3. THE Parser SHALL preserve field order for human readability
4. THE Parser SHALL validate all fields against schema before accepting
5. THE Serializer SHALL format JSON with 2-space indentation
6. THE Serializer SHALL NOT include sensitive fields (tokens, secrets) in output
7. THE Parser SHALL handle missing optional fields with defaults
8. THE Parser SHALL reject unknown fields with descriptive error
9. THE Round-trip property SHALL be verified by property-based tests
10. THE Parser SHALL support both snake_case and camelCase for backward compatibility

### Requirement 20: Credential Serialization Security

**User Story:** As a developer, I want credentials serialized securely, so that tokens are never written to disk in plaintext.

#### Acceptance Criteria

1. THE Serializer SHALL NEVER write access tokens to config file
2. THE Serializer SHALL NEVER write refresh tokens to config file
3. THE Serializer SHALL NEVER write client secrets to config file
4. THE Serializer SHALL write only non-sensitive metadata to config file
5. THE Serializer SHALL store sensitive credentials in OS keychain only
6. WHEN serializing account, THE Serializer SHALL include placeholder: `"credentials": "stored in keychain"`
7. WHEN deserializing account, THE Parser SHALL load credentials from OS keychain
8. THE Serializer SHALL validate that no sensitive data is in output before writing
9. THE Serializer SHALL log warning if sensitive data detected in config file
10. THE Serializer SHALL provide secure export command: `claudeflow export --encrypted` for backup

## Success Criteria

### Functional Success Criteria

1. ✅ User can login via web browser with AWS Builder ID, Google, or GitHub
2. ✅ User can manage up to 100 Kiro accounts via CLI
3. ✅ Tokens refresh automatically without user intervention
4. ✅ ClaudeFlow calls Kiro API directly (no 9router)
5. ✅ All responses are validated as raw Anthropic format
6. ✅ Account pooling works with round-robin and quota-aware strategies
7. ✅ Automatic failover when account hits quota or errors
8. ✅ All optimization features work with Kiro OAuth accounts
9. ✅ Migration from 9router is documented and supported
10. ✅ Health checks report status of all accounts

### Security Success Criteria

1. ✅ Credentials stored in OS keychain (not plaintext)
2. ✅ PKCE implemented for OAuth flow
3. ✅ JWT tokens validated with signature verification
4. ✅ Logs sanitized (no token exposure)
5. ✅ TLS 1.2+ enforced for all connections
6. ✅ Token rotation implemented
7. ✅ Rate limiting prevents abuse
8. ✅ Security audit logging enabled
9. ✅ No sensitive data in config files
10. ✅ Certificate pinning for auth endpoints

### Performance Success Criteria

1. ✅ OAuth login completes within 10 seconds
2. ✅ Token refresh completes within 2 seconds
3. ✅ Account selection completes within 50ms
4. ✅ API calls have <100ms routing overhead
5. ✅ Health checks complete within 5 seconds
6. ✅ Multi-account pooling supports 100 accounts without performance degradation
7. ✅ Parallel token refresh for all accounts completes within 10 seconds
8. ✅ Response format validation adds <10ms overhead
9. ✅ Configuration load time <100ms
10. ✅ Memory usage <50MB for 100 accounts

### User Experience Success Criteria

1. ✅ CLI commands are intuitive and self-documenting
2. ✅ Error messages are clear and actionable
3. ✅ Setup takes <5 minutes for new users
4. ✅ Migration from 9router takes <10 minutes
5. ✅ Documentation is comprehensive and easy to follow
6. ✅ Health status is visible at a glance
7. ✅ Account management is simple (add/remove/list)
8. ✅ No manual token refresh required
9. ✅ Automatic failover is transparent to user
10. ✅ Troubleshooting guides resolve common issues quickly
