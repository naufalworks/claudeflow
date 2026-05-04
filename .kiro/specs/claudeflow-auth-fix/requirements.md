# Requirements Document

## Introduction

ClaudeFlow's authentication architecture is fundamentally broken. It was designed to work with a "Kiro OAuth system" that doesn't exist. The system expects OAuth endpoints (`/auth/login`, `/auth/refresh`) on MITM routers, but real routers like 9router are simple proxies that use API keys directly—no OAuth, no machine IDs, no session tokens.

This causes ClaudeFlow to be completely unusable:
- Authentication attempts return 404 errors
- All requests fail with "Session expired"
- The account management system is non-functional
- Users cannot route any requests through the system

This spec fixes the authentication architecture to work with REAL router systems while maintaining backward compatibility and preserving ClaudeFlow's optimization features.

## Glossary

- **ClaudeFlow**: The intelligent API router system that optimizes Anthropic Claude API requests
- **Router**: A proxy service that forwards API requests (e.g., 9router, future MITM routers)
- **Direct_Account**: An account using Anthropic API keys directly without any proxy
- **Proxy_Account**: An account using a router/proxy service with API key authentication
- **OAuth_Account**: An account using OAuth-based authentication (future support)
- **Account_Pool_Manager**: The component that manages and selects accounts for requests
- **Auth_Manager**: The component responsible for authentication and session management
- **MITM_Client**: The client that communicates with router services
- **Config_Schema**: The Zod schema defining valid configuration structures
- **Session_Token**: An OAuth session token (only for OAuth accounts, not proxy accounts)
- **API_Key**: The authentication key used for API requests

## Requirements

### Requirement 1: Support Direct Anthropic API Keys

**User Story:** As a developer, I want to use my Anthropic API keys directly, so that I can use ClaudeFlow without any proxy or router.

#### Acceptance Criteria

1. THE Config_Schema SHALL accept accounts with provider type "anthropic" and only an apiKey field
2. WHEN a direct Anthropic account is configured, THE Account_Pool_Manager SHALL route requests directly to api.anthropic.com
3. THE Direct_Account SHALL NOT require machineId, sessionToken, or mitmRouterUrl fields
4. WHEN using a direct account, THE System SHALL use the apiKey in the x-api-key header
5. THE Direct_Account SHALL work identically to calling Anthropic API directly

### Requirement 2: Support Proxy-Based Routers

**User Story:** As a developer, I want to use proxy-based routers like 9router, so that I can route requests through a simple proxy without OAuth complexity.

#### Acceptance Criteria

1. THE Config_Schema SHALL accept accounts with provider type "proxy" with apiKey and baseURL fields
2. WHEN a proxy account is configured, THE Account_Pool_Manager SHALL route requests to the specified baseURL
3. THE Proxy_Account SHALL NOT require machineId, sessionToken, or OAuth authentication
4. WHEN using a proxy account, THE System SHALL forward the apiKey in the x-api-key header
5. THE Proxy_Account SHALL work with any router that accepts API keys directly (like 9router)
6. THE System SHALL NOT attempt OAuth authentication for proxy accounts

### Requirement 3: Remove Broken OAuth Dependencies

**User Story:** As a developer, I want ClaudeFlow to work without non-existent OAuth endpoints, so that the system is actually usable.

#### Acceptance Criteria

1. THE System SHALL NOT require /auth/login endpoints for proxy accounts
2. THE System SHALL NOT require /auth/refresh endpoints for proxy accounts
3. THE System SHALL NOT attempt to authenticate proxy accounts via OAuth
4. THE Kiro_Auth_Manager SHALL be refactored or removed to eliminate OAuth dependencies
5. WHEN a proxy account is used, THE System SHALL NOT create or manage session tokens

### Requirement 4: Maintain Optimization Features

**User Story:** As a developer, I want all optimization features to work regardless of account type, so that I get cost savings and performance improvements.

#### Acceptance Criteria

1. THE Semantic_Deduplication SHALL work with all account types (direct, proxy, OAuth)
2. THE Prompt_Caching_Optimizer SHALL work with all account types
3. THE Context_Optimizer SHALL work with all account types
4. THE Thinking_Budget_Optimizer SHALL work with all account types
5. THE Tool_Orchestrator SHALL work with all account types
6. THE Account_Pool_Manager SHALL select optimal accounts regardless of type

### Requirement 5: Support Multiple Account Types Simultaneously

**User Story:** As a developer, I want to use direct, proxy, and OAuth accounts together, so that I can leverage different account sources simultaneously.

#### Acceptance Criteria

1. THE Config_Schema SHALL accept a mix of direct, proxy, and OAuth accounts in the accounts array
2. THE Account_Pool_Manager SHALL score and select from all account types based on quota and performance
3. WHEN multiple account types are available, THE System SHALL prioritize based on cost efficiency and quota
4. THE System SHALL handle failures in one account type by falling back to other available accounts
5. THE Account_Pool_Manager SHALL track quota and performance separately for each account type

### Requirement 6: Preserve Backward Compatibility

**User Story:** As a developer with existing OAuth configurations, I want my setup to continue working, so that I don't have breaking changes.

#### Acceptance Criteria

1. WHERE OAuth accounts are configured with kiroConfig, THE System SHALL continue to support OAuth authentication
2. THE Config_Schema SHALL accept the existing kiroConfig structure for backward compatibility
3. WHEN OAuth accounts are present, THE System SHALL use the OAuth authentication flow
4. THE System SHALL NOT break existing OAuth-based deployments
5. WHERE OAuth is configured, THE System SHALL maintain session refresh and token management

### Requirement 7: Simplify Configuration Schema

**User Story:** As a developer, I want a clear and simple configuration schema, so that I can easily set up accounts without confusion.

#### Acceptance Criteria

1. THE Config_Schema SHALL use a discriminated union based on provider type
2. WHEN provider is "anthropic", THE Schema SHALL require only apiKey
3. WHEN provider is "proxy", THE Schema SHALL require apiKey and baseURL
4. WHEN provider is "kiro", THE Schema SHALL require kiroConfig with machineId and mitmRouterUrl
5. THE Schema SHALL provide clear validation errors for invalid configurations
6. THE Config_Schema SHALL reject invalid combinations (e.g., proxy with kiroConfig)

### Requirement 8: Update Account Pool Manager

**User Story:** As a developer, I want the account pool manager to work with all account types, so that requests are routed correctly.

#### Acceptance Criteria

1. THE Account_Pool_Manager SHALL identify account type from the provider field
2. WHEN routing a request with a direct account, THE System SHALL call api.anthropic.com
3. WHEN routing a request with a proxy account, THE System SHALL call the account's baseURL
4. WHEN routing a request with an OAuth account, THE System SHALL call the mitmRouterUrl
5. THE Account_Pool_Manager SHALL NOT attempt OAuth authentication for non-OAuth accounts
6. THE Account_Pool_Manager SHALL handle authentication errors appropriately for each account type

### Requirement 9: Refactor Authentication Manager

**User Story:** As a developer, I want a clean authentication manager that handles all account types, so that the codebase is maintainable.

#### Acceptance Criteria

1. THE Auth_Manager SHALL be refactored to support direct, proxy, and OAuth accounts
2. WHEN authenticating a direct account, THE Auth_Manager SHALL validate the apiKey format only
3. WHEN authenticating a proxy account, THE Auth_Manager SHALL validate the apiKey and baseURL only
4. WHEN authenticating an OAuth account, THE Auth_Manager SHALL perform OAuth flow with session management
5. THE Auth_Manager SHALL NOT mix authentication logic between account types
6. THE Auth_Manager SHALL provide clear error messages for authentication failures

### Requirement 10: Update MITM Client

**User Story:** As a developer, I want the MITM client to work with proxy routers, so that I can use simple proxy services.

#### Acceptance Criteria

1. THE MITM_Client SHALL support requests without session tokens
2. WHEN sending a request to a proxy router, THE MITM_Client SHALL use only the x-api-key header
3. THE MITM_Client SHALL NOT require x-machine-id or x-session-token headers for proxy accounts
4. WHEN a proxy router returns 404 for /auth endpoints, THE System SHALL NOT treat this as an error
5. THE MITM_Client SHALL handle both OAuth and non-OAuth routers transparently

### Requirement 11: Environment Variable Support

**User Story:** As a developer, I want to configure accounts via environment variables, so that I can deploy without config files.

#### Acceptance Criteria

1. THE Config_Manager SHALL load direct Anthropic accounts from ANTHROPIC_API_KEY_N variables
2. THE Config_Manager SHALL load proxy accounts from PROXY_API_KEY_N and PROXY_BASE_URL_N variables
3. THE Config_Manager SHALL load OAuth accounts from KIRO_MACHINE_ID_N and KIRO_API_KEY_N variables
4. WHEN environment variables are present, THE System SHALL merge them with config file accounts
5. THE Config_Manager SHALL validate all environment-based accounts against the schema

### Requirement 12: CLI Tool Updates

**User Story:** As a developer, I want the CLI tool to support all account types, so that I can manage accounts easily.

#### Acceptance Criteria

1. THE CLI SHALL support adding direct Anthropic accounts via `claudeflow account add`
2. THE CLI SHALL support adding proxy accounts with baseURL specification
3. THE CLI SHALL support adding OAuth accounts with machineId and mitmRouterUrl
4. WHEN listing accounts, THE CLI SHALL display the account type clearly
5. THE CLI SHALL NOT attempt session refresh for non-OAuth accounts

### Requirement 13: Error Handling and Diagnostics

**User Story:** As a developer, I want clear error messages when authentication fails, so that I can debug issues quickly.

#### Acceptance Criteria

1. WHEN a direct account fails, THE System SHALL report "Anthropic API authentication failed"
2. WHEN a proxy account fails, THE System SHALL report "Proxy router authentication failed" with the baseURL
3. WHEN an OAuth account fails, THE System SHALL report "OAuth authentication failed" with session details
4. THE System SHALL log the account type and provider in all error messages
5. WHEN authentication fails, THE System SHALL suggest corrective actions based on account type

### Requirement 14: Health Check Updates

**User Story:** As a developer, I want health checks to validate all account types, so that I know the system is properly configured.

#### Acceptance Criteria

1. THE Health_Check SHALL test connectivity for direct Anthropic accounts
2. THE Health_Check SHALL test connectivity for proxy accounts using their baseURL
3. THE Health_Check SHALL test OAuth authentication for OAuth accounts
4. WHEN a health check fails, THE System SHALL report which account type and ID failed
5. THE Health_Check SHALL run independently for each account without blocking others

### Requirement 15: Documentation Updates

**User Story:** As a developer, I want clear documentation on account types, so that I can configure ClaudeFlow correctly.

#### Acceptance Criteria

1. THE README SHALL document all three account types with examples
2. THE Documentation SHALL explain when to use each account type
3. THE Documentation SHALL provide example configurations for each account type
4. THE Documentation SHALL explain the migration path from broken OAuth to working configurations
5. THE Documentation SHALL clarify that OAuth is optional, not required

## Parser and Serializer Requirements

### Requirement 16: Configuration Parser

**User Story:** As a developer, I want the configuration parser to handle all account types correctly, so that my config is loaded properly.

#### Acceptance Criteria

1. WHEN a valid configuration file is provided, THE Config_Parser SHALL parse it into a Config object
2. WHEN an invalid configuration file is provided, THE Config_Parser SHALL return descriptive validation errors
3. THE Config_Pretty_Printer SHALL format Config objects back into valid JSON configuration files
4. FOR ALL valid Config objects, parsing then printing then parsing SHALL produce an equivalent object (round-trip property)

### Requirement 17: Account Configuration Serialization

**User Story:** As a developer, I want account configurations to serialize correctly, so that I can save and restore configurations.

#### Acceptance Criteria

1. WHEN an account configuration is serialized, THE Serializer SHALL preserve all required fields for the account type
2. WHEN an account configuration is deserialized, THE Parser SHALL validate the account type and required fields
3. THE Account_Serializer SHALL format account objects back into valid configuration format
4. FOR ALL valid account configurations, serializing then deserializing SHALL produce an equivalent object (round-trip property)

