# Design Document

## Overview

This design document describes the technical architecture for fixing ClaudeFlow's broken authentication system. The current system assumes all accounts use OAuth with endpoints like `/auth/login` and `/auth/refresh`, but this causes complete system failure.

**CRITICAL REQUIREMENT: Raw Anthropic Format Only, Everywhere**

ClaudeFlow ONLY supports sources that provide raw Anthropic API responses. NO format conversion is supported. This means:
- ❌ NO 9router (it converts to OpenAI format)
- ❌ NO OpenAI-format proxies
- ❌ NO format conversion anywhere in the system
- ✅ ONLY raw Anthropic format from all sources

The solution introduces a flexible authentication architecture supporting three account types, ALL using raw Anthropic format:
1. **Direct Anthropic** - Raw Anthropic format from api.anthropic.com
2. **Anthropic-compatible proxies** - Routers that forward raw Anthropic format unchanged (true MITM proxies)
3. **OAuth routers** - Raw Anthropic format with OAuth authentication (backward compatibility)

All account types use discriminated unions for type safety and strategy pattern for authentication logic.

## Root Cause Analysis

### Current Broken Architecture

```
User Request
    ↓
Account Pool Manager
    ↓
Kiro Auth Manager (assumes OAuth for ALL accounts)
    ↓
POST /auth/login {machineId, apiKey}  ← 404 Error! Endpoint doesn't exist
    ↓
Session expired error
    ↓
Request fails
```

**Problems:**
1. `KiroAuthManager` assumes all accounts need OAuth authentication
2. Hardcoded OAuth endpoints (`/auth/login`, `/auth/refresh`) that don't exist
3. All accounts forced through OAuth flow regardless of actual authentication method
4. No support for Anthropic-compatible proxies (true MITM proxies that preserve raw Anthropic format)
5. No support for direct Anthropic API calls
6. No validation that responses are in raw Anthropic format

### Why This Happened

ClaudeFlow was designed for a hypothetical "Kiro OAuth system" that doesn't exist yet.

### What ClaudeFlow Actually Needs

ClaudeFlow requires sources that provide **raw Anthropic API responses only**:

**✅ Supported Sources:**
- Direct Anthropic API (api.anthropic.com)
- True MITM proxies that forward raw Anthropic format unchanged
- OAuth routers that return raw Anthropic format

**❌ NOT Supported:**
- 9router (converts to OpenAI format)
- OpenAI-format proxies
- Any router that performs format conversion

**Critical Rule:** All responses MUST be in raw Anthropic format. No format conversion anywhere.

## High-Level Architecture

### New Authentication Flow

```
User Request
    ↓
Account Pool Manager
    ↓
Determine Account Type (provider field)
    ↓
    ├─ Direct Anthropic → Anthropic Client → api.anthropic.com → Raw Anthropic Response
    ├─ Proxy → Proxy Client → Anthropic-compatible proxy → Raw Anthropic Response
    └─ OAuth → OAuth Client → OAuth router → Raw Anthropic Response
    ↓
Validate Response Format (MUST be raw Anthropic format)
    ↓
Return Response
```

**Critical Validation:** All responses MUST be validated to ensure they are in raw Anthropic format. Any non-Anthropic format response is rejected.

### Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Request Handler                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              Account Pool Manager                        │
│  - Select optimal account based on quota/performance     │
│  - Route to appropriate client based on provider type    │
└─────────────────────────────────────────────────────────┘
                          ↓
        ┌─────────────────┼─────────────────┐
        ↓                 ↓                  ↓
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Anthropic   │  │    Proxy     │  │    OAuth     │
│   Client     │  │   Client     │  │   Client     │
│              │  │              │  │              │
│ Raw Anthropic│  │ Raw Anthropic│  │ Raw Anthropic│
│ Format Only  │  │ Format Only  │  │ Format Only  │
└──────────────┘  └──────────────┘  └──────────────┘
        ↓                 ↓                  ↓
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ api.anthropic│  │  Anthropic-  │  │ OAuth Router │
│    .com      │  │  compatible  │  │ (Raw Anthropic│
│              │  │    Proxy     │  │   format)    │
│ Raw Anthropic│  │ (MITM only,  │  │              │
│   Response   │  │ NO 9router)  │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
        ↓                 ↓                  ↓
        └─────────────────┴──────────────────┘
                          ↓
              ┌───────────────────────┐
              │ Response Format       │
              │ Validator             │
              │                       │
              │ ✅ Raw Anthropic OK   │
              │ ❌ OpenAI format FAIL │
              │ ❌ Other format FAIL  │
              └───────────────────────┘
```

**CRITICAL:** All three clients MUST return raw Anthropic format. Response format validation is mandatory.

## Data Models

### Account Type Discriminated Union

```typescript
// Base account interface
interface BaseAccount {
  id: string;
  provider: 'anthropic' | 'proxy' | 'kiro';
  apiKey: string;
}

// Direct Anthropic account
interface AnthropicAccount extends BaseAccount {
  provider: 'anthropic';
  // No additional fields needed
}

// Proxy-based account (like Anthropic-compatible MITM proxies)
interface ProxyAccount extends BaseAccount {
  provider: 'proxy';
  baseURL: string; // e.g., "http://localhost:20128"
  // CRITICAL: This proxy MUST forward raw Anthropic format unchanged
  // NOT for 9router (it converts to OpenAI format)
  // ONLY for true MITM proxies that preserve Anthropic format
}

// OAuth-based account (backward compatibility)
interface OAuthAccount extends BaseAccount {
  provider: 'kiro';
  kiroConfig: {
    machineId: string;
    mitmRouterUrl: string;
    sessionToken?: string;
    sessionExpiry?: Date;
    combo?: {
      accounts: string[];
      strategy: 'round-robin' | 'sticky-round-robin';
    };
  };
}

// Discriminated union
type Account = AnthropicAccount | ProxyAccount | OAuthAccount;
```

### Configuration Schema

```typescript
const AccountSchema = z.discriminatedUnion('provider', [
  // Direct Anthropic
  z.object({
    id: z.string(),
    provider: z.literal('anthropic'),
    apiKey: z.string().min(1),
  }),
  
  // Proxy-based
  z.object({
    id: z.string(),
    provider: z.literal('proxy'),
    apiKey: z.string().min(1),
    baseURL: z.string().url(),
  }),
  
  // OAuth-based
  z.object({
    id: z.string(),
    provider: z.literal('kiro'),
    apiKey: z.string().min(1),
    kiroConfig: z.object({
      machineId: z.string().min(1),
      mitmRouterUrl: z.string().url(),
      sessionToken: z.string().optional(),
      sessionExpiry: z.date().optional(),
      combo: z.object({
        accounts: z.array(z.string()).min(1),
        strategy: z.enum(['round-robin', 'sticky-round-robin']),
      }).optional(),
    }),
  }),
]);

const ConfigSchema = z.object({
  server: z.object({
    port: z.number().int().positive().default(20129),
    host: z.string().default('0.0.0.0'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
  infrastructure: z.object({
    qdrant: z.object({ url: z.string().url() }),
    redis: z.object({ url: z.string() }),
    voyage: z.object({ apiKey: z.string().min(1) }),
  }),
  accounts: z.array(AccountSchema).min(1),
  optimization: z.object({
    semanticDeduplication: z.object({
      enabled: z.boolean().default(true),
      similarityThreshold: z.number().min(0).max(1).default(0.95),
      cacheTTL: z.number().int().positive().default(86400),
    }),
    promptCaching: z.object({
      enabled: z.boolean().default(true),
      minTokens: z.number().int().positive().default(1024),
    }),
    thinkingBudget: z.object({
      enabled: z.boolean().default(true),
      simple: z.number().int().nonnegative().default(0),
      moderate: z.number().int().nonnegative().default(2000),
      complex: z.number().int().nonnegative().default(10000),
    }),
    contextCompression: z.object({
      enabled: z.boolean().default(true),
      minTokens: z.number().int().positive().default(8000),
      recentMessagesToKeep: z.number().int().positive().default(3),
    }),
  }),
});
```

## Component Designs

### 1. AuthManager (Strategy Pattern)

Replace `KiroAuthManager` with a flexible `AuthManager` that delegates to account-type-specific strategies.

```typescript
interface AuthStrategy {
  authenticate(account: Account): Promise<AuthResult>;
  refreshSession?(account: Account): Promise<AuthResult>;
  needsRefresh?(account: Account): boolean;
}

class AnthropicAuthStrategy implements AuthStrategy {
  async authenticate(account: AnthropicAccount): Promise<AuthResult> {
    // Direct Anthropic accounts don't need authentication
    // Just validate API key format
    if (!account.apiKey.startsWith('sk-ant-')) {
      throw new Error('Invalid Anthropic API key format');
    }
    return { success: true, apiKey: account.apiKey };
  }
}

class ProxyAuthStrategy implements AuthStrategy {
  async authenticate(account: ProxyAccount): Promise<AuthResult> {
    // Proxy accounts don't need authentication
    // Just validate API key and baseURL
    if (!account.apiKey || !account.baseURL) {
      throw new Error('Proxy account requires apiKey and baseURL');
    }
    return { success: true, apiKey: account.apiKey, baseURL: account.baseURL };
  }
}

class OAuthAuthStrategy implements AuthStrategy {
  async authenticate(account: OAuthAccount): Promise<AuthResult> {
    // OAuth flow: POST /auth/login
    const response = await axios.post(
      `${account.kiroConfig.mitmRouterUrl}/auth/login`,
      {
        machineId: account.kiroConfig.machineId,
        apiKey: account.apiKey,
      }
    );
    
    return {
      success: true,
      sessionToken: response.data.sessionToken,
      expiresAt: new Date(response.data.expiresAt),
    };
  }
  
  async refreshSession(account: OAuthAccount): Promise<AuthResult> {
    // OAuth refresh: POST /auth/refresh
    const response = await axios.post(
      `${account.kiroConfig.mitmRouterUrl}/auth/refresh`,
      {
        machineId: account.kiroConfig.machineId,
        sessionToken: account.kiroConfig.sessionToken,
      }
    );
    
    return {
      success: true,
      sessionToken: response.data.sessionToken,
      expiresAt: new Date(response.data.expiresAt),
    };
  }
  
  needsRefresh(account: OAuthAccount): boolean {
    if (!account.kiroConfig.sessionExpiry) return true;
    const now = Date.now();
    const expiryTime = account.kiroConfig.sessionExpiry.getTime();
    const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
    return expiryTime - now < REFRESH_BUFFER_MS;
  }
}

class AuthManager {
  private strategies: Map<string, AuthStrategy>;
  
  constructor() {
    this.strategies = new Map([
      ['anthropic', new AnthropicAuthStrategy()],
      ['proxy', new ProxyAuthStrategy()],
      ['kiro', new OAuthAuthStrategy()],
    ]);
  }
  
  async authenticate(account: Account): Promise<AuthResult> {
    const strategy = this.strategies.get(account.provider);
    if (!strategy) {
      throw new Error(`Unknown account provider: ${account.provider}`);
    }
    return strategy.authenticate(account);
  }
  
  async refreshSession(account: Account): Promise<AuthResult> {
    const strategy = this.strategies.get(account.provider);
    if (!strategy?.refreshSession) {
      throw new Error(`Account type ${account.provider} does not support session refresh`);
    }
    return strategy.refreshSession(account);
  }
  
  needsRefresh(account: Account): boolean {
    const strategy = this.strategies.get(account.provider);
    return strategy?.needsRefresh?.(account) ?? false;
  }
}
```

### 2. Account Pool Manager Updates

```typescript
class AccountPoolManager {
  private accounts: Map<string, Account>;
  private authManager: AuthManager;
  private responseValidator: ResponseFormatValidator;
  
  async selectAccount(requestContext: RequestContext): Promise<Account> {
    // Score all accounts based on quota, performance, cost
    const scoredAccounts = await this.scoreAccounts(requestContext);
    
    // Select best account
    const selectedAccount = scoredAccounts[0];
    
    // Authenticate if needed (only for OAuth accounts)
    if (this.authManager.needsRefresh(selectedAccount)) {
      await this.authManager.refreshSession(selectedAccount);
    }
    
    return selectedAccount;
  }
  
  async routeRequest(
    account: Account,
    request: AnthropicRequest
  ): Promise<AnthropicResponse> {
    let response: AnthropicResponse;
    
    // Route based on account type
    switch (account.provider) {
      case 'anthropic':
        response = await this.anthropicClient.sendRequest(request, account.apiKey);
        break;
      
      case 'proxy':
        response = await this.proxyClient.sendRequest(
          request,
          account.apiKey,
          account.baseURL
        );
        break;
      
      case 'kiro':
        response = await this.oauthClient.sendRequest(
          request,
          account.kiroConfig.sessionToken!,
          account.kiroConfig.mitmRouterUrl
        );
        break;
      
      default:
        throw new Error(`Unknown account provider: ${(account as any).provider}`);
    }
    
    // CRITICAL: Validate response is in raw Anthropic format
    if (!this.responseValidator.isAnthropicFormat(response)) {
      throw new Error(
        `Response from ${account.provider} account ${account.id} is not in raw Anthropic format. ` +
        `ClaudeFlow only supports raw Anthropic format. ` +
        `If using a proxy, ensure it forwards Anthropic format unchanged (not OpenAI format).`
      );
    }
    
    return response;
  }
}
```

### 3. API Clients

```typescript
// Response format validator
class ResponseFormatValidator {
  isAnthropicFormat(response: any): boolean {
    // Raw Anthropic format has these required fields:
    // - id: string (starts with "msg_")
    // - type: "message"
    // - role: "assistant"
    // - content: array
    // - model: string
    // - stop_reason: string | null
    // - usage: object with input_tokens and output_tokens
    
    if (!response || typeof response !== 'object') return false;
    
    // Check required Anthropic fields
    if (!response.id?.startsWith('msg_')) return false;
    if (response.type !== 'message') return false;
    if (response.role !== 'assistant') return false;
    if (!Array.isArray(response.content)) return false;
    if (!response.model) return false;
    if (!response.usage?.input_tokens) return false;
    if (!response.usage?.output_tokens) return false;
    
    // Check it's NOT OpenAI format (has "choices" array)
    if (response.choices) return false;
    
    return true;
  }
}

// Direct Anthropic client
class AnthropicClient {
  private validator = new ResponseFormatValidator();
  
  async sendRequest(
    request: AnthropicRequest,
    apiKey: string
  ): Promise<AnthropicResponse> {
    const response = await axios.post('https://api.anthropic.com/v1/messages', request, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    });
    
    // Validate response format
    if (!this.validator.isAnthropicFormat(response.data)) {
      throw new Error('Response from Anthropic API is not in expected format');
    }
    
    return response.data;
  }
}

// Proxy client (for Anthropic-compatible MITM proxies ONLY)
class ProxyClient {
  private validator = new ResponseFormatValidator();
  
  async sendRequest(
    request: AnthropicRequest,
    apiKey: string,
    baseURL: string
  ): Promise<AnthropicResponse> {
    const response = await axios.post(`${baseURL}/v1/messages`, request, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    });
    
    // CRITICAL: Validate response is raw Anthropic format
    if (!this.validator.isAnthropicFormat(response.data)) {
      throw new Error(
        `Proxy at ${baseURL} returned non-Anthropic format response. ` +
        `ClaudeFlow only supports proxies that forward raw Anthropic format unchanged. ` +
        `This proxy appears to convert to OpenAI or another format, which is not supported.`
      );
    }
    
    return response.data;
  }
}

// OAuth client (for MITM routers with OAuth)
class OAuthClient {
  private validator = new ResponseFormatValidator();
  
  async sendRequest(
    request: AnthropicRequest,
    sessionToken: string,
    mitmRouterUrl: string
  ): Promise<AnthropicResponse> {
    const response = await axios.post(`${mitmRouterUrl}/v1/messages`, request, {
      headers: {
        'x-session-token': sessionToken,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    });
    
    // CRITICAL: Validate response is raw Anthropic format
    if (!this.validator.isAnthropicFormat(response.data)) {
      throw new Error(
        `OAuth router at ${mitmRouterUrl} returned non-Anthropic format response. ` +
        `ClaudeFlow only supports routers that return raw Anthropic format.`
      );
    }
    
    return response.data;
  }
}
```

### 4. Configuration Manager Updates

```typescript
class ConfigurationManager {
  private loadFromEnvironment(config: Config): Config {
    const envConfig = { ...config };
    const accounts: Account[] = [];
    
    // Load Direct Anthropic accounts
    let anthropicIndex = 1;
    while (process.env[`ANTHROPIC_API_KEY_${anthropicIndex}`]) {
      accounts.push({
        id: `anthropic-account-${anthropicIndex}`,
        provider: 'anthropic',
        apiKey: process.env[`ANTHROPIC_API_KEY_${anthropicIndex}`]!,
      });
      anthropicIndex++;
    }
    
    // Load Proxy accounts
    let proxyIndex = 1;
    while (process.env[`PROXY_API_KEY_${proxyIndex}`]) {
      const apiKey = process.env[`PROXY_API_KEY_${proxyIndex}`];
      const baseURL = process.env[`PROXY_BASE_URL_${proxyIndex}`];
      
      if (apiKey && baseURL) {
        accounts.push({
          id: `proxy-account-${proxyIndex}`,
          provider: 'proxy',
          apiKey,
          baseURL,
        });
      }
      proxyIndex++;
    }
    
    // Load OAuth/Kiro accounts
    let kiroIndex = 1;
    while (process.env[`KIRO_MACHINE_ID_${kiroIndex}`]) {
      const machineId = process.env[`KIRO_MACHINE_ID_${kiroIndex}`];
      const apiKey = process.env[`KIRO_API_KEY_${kiroIndex}`];
      const mitmRouterUrl = process.env[`KIRO_MITM_ROUTER_URL_${kiroIndex}`] || 
                            'http://3.68.219.151:20128';
      
      if (machineId && apiKey) {
        accounts.push({
          id: `kiro-account-${kiroIndex}`,
          provider: 'kiro',
          apiKey,
          kiroConfig: {
            machineId,
            mitmRouterUrl,
          },
        });
      }
      kiroIndex++;
    }
    
    if (accounts.length > 0) {
      envConfig.accounts = accounts;
    }
    
    return envConfig;
  }
}
```

## Implementation Approach

### Phase 1: Update Configuration Schema (Low Risk)

**Files to modify:**
- `src/config/schema.ts` - Add discriminated union for account types
- `src/config/manager.ts` - Update environment variable loading

**Changes:**
1. Replace single account schema with discriminated union
2. Add validation for each account type
3. Update environment variable parsing for all three types

**Testing:**
- Unit tests for schema validation
- Test all three account types parse correctly
- Test invalid configurations are rejected

### Phase 2: Create New Auth Strategies (Medium Risk)

**Files to create:**
- `src/auth/strategies/anthropic-auth-strategy.ts`
- `src/auth/strategies/proxy-auth-strategy.ts`
- `src/auth/strategies/oauth-auth-strategy.ts`
- `src/auth/auth-manager.ts`

**Changes:**
1. Implement three auth strategies
2. Create AuthManager with strategy pattern
3. Move OAuth logic from KiroAuthManager to OAuthAuthStrategy

**Testing:**
- Unit tests for each strategy
- Integration tests with mock servers
- Test authentication flows for all types

### Phase 3: Create API Clients (Low Risk)

**Files to create:**
- `src/clients/anthropic-client.ts`
- `src/clients/proxy-client.ts`
- `src/clients/oauth-client.ts`

**Changes:**
1. Extract Anthropic API client logic
2. Create proxy client for simple routers
3. Create OAuth client for MITM routers

**Testing:**
- Unit tests with mock axios
- Integration tests with real endpoints
- Test error handling for all clients

### Phase 4: Update Account Pool Manager (High Risk)

**Files to modify:**
- `src/accounts/account-pool-manager.ts`

**Changes:**
1. Update selectAccount to work with all account types
2. Update routeRequest to use appropriate client
3. Remove OAuth-only assumptions

**Testing:**
- Unit tests for account selection
- Integration tests with all account types
- Test fallback logic when accounts fail

### Phase 5: Deprecate KiroAuthManager (Medium Risk)

**Files to modify:**
- `src/accounts/kiro-auth-manager.ts` - Mark as deprecated
- `src/index.ts` - Use new AuthManager

**Changes:**
1. Mark KiroAuthManager as deprecated
2. Update main entry point to use new AuthManager
3. Keep KiroAuthManager for backward compatibility

**Testing:**
- Regression tests for existing OAuth setups
- Test backward compatibility
- Test migration path

### Phase 6: Update CLI Tools (Low Risk)

**Files to modify:**
- `src/cli/commands/account.ts`
- `src/cli/services/auth-service.ts`

**Changes:**
1. Update account add command to support all types
2. Update account list to show account type
3. Remove session refresh for non-OAuth accounts

**Testing:**
- CLI integration tests
- Test adding all account types
- Test listing mixed account types

### Phase 7: Update Documentation (Low Risk)

**Files to modify:**
- `README.md`
- `docs/CONFIGURATION.md`
- `.env.example`
- `config.example.json`

**Changes:**
1. Document all three account types
2. Provide examples for each type
3. Explain migration from broken OAuth
4. Update environment variable documentation

## Migration Strategy

### For Users with Broken OAuth Configs

**Current broken config:**
```json
{
  "accounts": [
    {
      "id": "kiro-account-1",
      "apiKey": "sk-6005783058ec762b-ej7cxd-99255e97",
      "provider": "kiro",
      "kiroConfig": {
        "machineId": "some-machine-id",
        "mitmRouterUrl": "http://3.68.219.151:20128"
      }
    }
  ]
}
```

**Migration to direct Anthropic (RECOMMENDED):**
```json
{
  "accounts": [
    {
      "id": "anthropic-direct",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-..."
    }
  ]
}
```

**Or use Anthropic-compatible proxy (if you have one that preserves raw Anthropic format):**
```json
{
  "accounts": [
    {
      "id": "anthropic-mitm-proxy",
      "provider": "proxy",
      "apiKey": "sk-ant-api03-...",
      "baseURL": "http://localhost:20128"
    }
  ]
}
```

**IMPORTANT:** Do NOT use 9router as a proxy account. 9router converts responses to OpenAI format, which ClaudeFlow does not support. Only use proxies that forward raw Anthropic format unchanged.

### Backward Compatibility

OAuth accounts with valid `kiroConfig` will continue to work:
- If OAuth endpoints exist, they'll be used
- If OAuth endpoints return 404, system will log error and suggest migration
- No breaking changes for working OAuth setups

### Environment Variable Migration

**Old (broken):**
```bash
KIRO_MACHINE_ID_1=some-machine-id
KIRO_API_KEY_1=sk-6005783058ec762b-ej7cxd-99255e97
```

**New (direct Anthropic - RECOMMENDED):**
```bash
ANTHROPIC_API_KEY_1=sk-ant-api03-...
```

**Or Anthropic-compatible proxy (if you have one):**
```bash
PROXY_API_KEY_1=sk-ant-api03-...
PROXY_BASE_URL_1=http://localhost:20128
```

**IMPORTANT:** Do NOT use 9router with proxy accounts. 9router converts to OpenAI format, which is not supported.

## Configuration Examples

### Example 1: Direct Anthropic Only

```json
{
  "server": {
    "port": 20129,
    "host": "0.0.0.0",
    "logLevel": "info"
  },
  "infrastructure": {
    "qdrant": { "url": "http://localhost:6333" },
    "redis": { "url": "redis://localhost:6379" },
    "voyage": { "apiKey": "pa-..." }
  },
  "accounts": [
    {
      "id": "anthropic-primary",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-..."
    }
  ],
  "optimization": {
    "semanticDeduplication": { "enabled": true },
    "promptCaching": { "enabled": true },
    "thinkingBudget": { "enabled": true },
    "contextCompression": { "enabled": true }
  }
}
```

### Example 2: Anthropic-Compatible Proxy (NOT 9router)

```json
{
  "accounts": [
    {
      "id": "anthropic-mitm-proxy",
      "provider": "proxy",
      "apiKey": "sk-ant-api03-...",
      "baseURL": "http://localhost:20128"
    }
  ]
}
```

**CRITICAL:** This proxy MUST forward raw Anthropic format unchanged. 9router is NOT supported because it converts to OpenAI format.

### Example 3: Mixed Account Types

```json
{
  "accounts": [
    {
      "id": "anthropic-direct",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-..."
    },
    {
      "id": "anthropic-mitm-proxy",
      "provider": "proxy",
      "apiKey": "sk-ant-api03-...",
      "baseURL": "http://localhost:20128"
    },
    {
      "id": "oauth-mitm",
      "provider": "kiro",
      "apiKey": "sk-ant-api03-...",
      "kiroConfig": {
        "machineId": "machine-123",
        "mitmRouterUrl": "http://oauth-router:20128"
      }
    }
  ]
}
```

**CRITICAL:** All three account types MUST return raw Anthropic format. Response format validation will reject any non-Anthropic format responses.

## Testing Strategy

### Unit Tests

1. **Config Schema Tests**
   - Test all three account types validate correctly
   - Test invalid configurations are rejected
   - Test discriminated union type safety

2. **Auth Strategy Tests**
   - Test AnthropicAuthStrategy validates API keys
   - Test ProxyAuthStrategy validates baseURL
   - Test OAuthAuthStrategy performs OAuth flow

3. **Client Tests**
   - Test AnthropicClient calls correct endpoint
   - Test ProxyClient uses baseURL correctly
   - Test OAuthClient includes session token

### Integration Tests

1. **End-to-End Flow Tests**
   - Test request with direct Anthropic account
   - Test request with proxy account
   - Test request with OAuth account
   - Test mixed account types

2. **Fallback Tests**
   - Test fallback when primary account fails
   - Test account rotation
   - Test quota exhaustion handling

3. **Migration Tests**
   - Test loading old OAuth configs
   - Test backward compatibility
   - Test migration warnings

### Property-Based Tests

1. **Round-Trip Properties**
   - Config serialization → deserialization → equals original
   - Account serialization → deserialization → equals original

2. **Invariant Properties**
   - Account selection always returns valid account
   - Authentication always produces valid credentials
   - Routing always uses correct endpoint

## Security Considerations

### API Key Storage

- API keys stored in config files should be encrypted at rest
- Environment variables preferred over config files
- Never log API keys in plaintext
- Mask API keys in CLI output (show only last 4 characters)

### Session Token Management (OAuth only)

- Session tokens stored in Redis with TTL
- Automatic refresh before expiry
- Secure token transmission (HTTPS only in production)
- Token rotation on refresh

### Network Security

- HTTPS required for production deployments
- TLS certificate validation enabled
- No insecure HTTP in production
- Rate limiting per account to prevent abuse

## Performance Considerations

### Account Selection

- Cache account scores for 60 seconds
- Parallel health checks for all accounts
- Lazy authentication (only when needed)
- Connection pooling for all clients

### Request Routing

- Reuse HTTP connections (keep-alive)
- Parallel optimization pipeline
- Async/await throughout
- No blocking operations in hot path

### Memory Management

- Limit cached responses to 1000 items
- LRU eviction for semantic deduplication cache
- Stream large responses
- Cleanup expired sessions automatically

## Monitoring and Observability

### Metrics

- Request count per account type
- Authentication success/failure rate
- Account selection latency
- Client request latency
- Cache hit rates

### Logging

- Log account type in all requests
- Log authentication attempts
- Log account selection decisions
- Log fallback events
- Structured JSON logging

### Health Checks

- Per-account health checks
- Authentication health (OAuth only)
- Infrastructure health (Redis, Qdrant)
- Overall system health

## Rollout Plan

### Phase 1: Internal Testing (Week 1)
- Deploy to development environment
- Test all three account types
- Verify backward compatibility
- Performance testing

### Phase 2: Beta Testing (Week 2)
- Deploy to staging environment
- Invite beta users to test
- Collect feedback
- Fix critical issues

### Phase 3: Gradual Rollout (Week 3)
- Deploy to 10% of production traffic
- Monitor metrics and errors
- Increase to 50% if stable
- Full rollout if no issues

### Phase 4: Deprecation (Week 4+)
- Mark KiroAuthManager as deprecated
- Provide migration guide
- Support both old and new for 3 months
- Remove old code after migration period

## Success Criteria

### Functional Requirements
- ✅ Direct Anthropic accounts work without OAuth
- ✅ Proxy accounts work with simple API key forwarding
- ✅ OAuth accounts work for backward compatibility
- ✅ All optimization features work with all account types
- ✅ Account selection works across all types

### Non-Functional Requirements
- ✅ No performance regression (<5% latency increase)
- ✅ 100% backward compatibility for working OAuth setups
- ✅ Clear error messages for all failure modes
- ✅ Complete documentation for all account types
- ✅ Migration path for broken OAuth configs

### Quality Requirements
- ✅ 90%+ test coverage for new code
- ✅ All property-based tests pass
- ✅ No critical security vulnerabilities
- ✅ All linting and type checks pass
- ✅ Performance benchmarks meet targets

## Conclusion

This design fixes ClaudeFlow's broken authentication by introducing a flexible, type-safe architecture supporting three account types: Direct Anthropic, Proxy-based, and OAuth-based. The solution uses discriminated unions for type safety, strategy pattern for authentication logic, and maintains backward compatibility while enabling simple proxy routers like 9router to work correctly.

The implementation is phased to minimize risk, with comprehensive testing at each stage. The migration strategy provides clear paths for users with broken OAuth configs to move to working configurations, while preserving existing working setups.
