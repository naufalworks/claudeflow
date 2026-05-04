# High Priority Issues - Detailed Recommendations

**Generated:** May 3, 2026
**Priority:** High (Should be addressed soon)
**Total Issues:** 23

---

## ARCH-003: God Object - cli/bin/claudeflow.ts (739 lines, complexity 94)

### Issue Details
- **Location:** `src/cli/bin/claudeflow.ts`
- **Lines:** 739
- **Complexity:** 94 (in setupCommands function)
- **Commands:** 14

### Problem
CLI entry point handles too many responsibilities:
- CLI initialization
- Command registration (14 commands)
- Argument parsing
- Help text generation
- Error handling

### Recommendation

**Extract command registry:**

```typescript
// src/cli/command-registry.ts
import type { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { accountCommand } from './commands/account.js';
// ... import all commands

export interface CommandDefinition {
  name: string;
  description: string;
  handler: (program: Command) => void;
}

export const commands: CommandDefinition[] = [
  {
    name: 'login',
    description: 'Authenticate with Kiro',
    handler: loginCommand
  },
  {
    name: 'account',
    description: 'Manage accounts',
    handler: accountCommand
  },
  // ... all 14 commands
];

export function registerCommands(program: Command): void {
  for (const cmd of commands) {
    cmd.handler(program);
  }
}

// src/cli/bin/claudeflow.ts (simplified)
import { Command } from 'commander';
import { registerCommands } from '../command-registry.js';

const program = new Command();

program
  .name('claudeflow')
  .description('ClaudeFlow CLI')
  .version('0.1.0');

registerCommands(program);

program.parse();
```

### Effort Estimate
- **Time:** 1 day
- **Complexity:** Medium

---

## QUAL-001: Inconsistent Naming Conventions (106 instances)

### Issue Details
- **Location:** Multiple files, especially `src/parsers/request-parser.ts`
- **Instances:** 106 snake_case variables mixed with camelCase

### Problem
```typescript
// Inconsistent naming
const max_tokens = request.max_tokens;
const stopSequences = request.stop_sequences;
const tool_choice = request.tool_choice;
const cacheControl = request.cache_control;
```

### Recommendation

**Use camelCase internally, snake_case only for API:**

```typescript
// src/parsers/request-parser.ts
interface ClaudeAPIRequest {
  max_tokens?: number;      // API uses snake_case
  stop_sequences?: string[];
  tool_choice?: object;
  cache_control?: object;
}

interface InternalRequest {
  maxTokens?: number;       // Internal uses camelCase
  stopSequences?: string[];
  toolChoice?: object;
  cacheControl?: object;
}

function parseRequest(apiRequest: ClaudeAPIRequest): InternalRequest {
  return {
    maxTokens: apiRequest.max_tokens,
    stopSequences: apiRequest.stop_sequences,
    toolChoice: apiRequest.tool_choice,
    cacheControl: apiRequest.cache_control
  };
}
```

### Effort Estimate
- **Time:** 1-2 days
- **Complexity:** Medium
- **Breaking Changes:** Yes (internal APIs)

---

## QUAL-002: Magic Numbers (47 instances)

### Issue Details
- **Location:** `src/server/routes.ts`, `src/accounts/account-pool-manager.ts`
- **Instances:** 47 magic numbers

### Problem
```typescript
// Magic numbers without context
if (retryCount < 3) { ... }
await sleep(1000 * Math.pow(2, retryCount));
if (quota.remaining / quota.total < 0.9) { ... }
```

### Recommendation

**Extract to named constants:**

```typescript
// src/constants/retry.ts
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
  BACKOFF_MULTIPLIER: 2,
  MAX_DELAY_MS: 10000
} as const;

// src/constants/quota.ts
export const QUOTA_THRESHOLDS = {
  WARNING: 0.9,      // 90% used
  CRITICAL: 0.95,    // 95% used
  LOW: 0.1,          // 10% remaining
  MEDIUM: 0.5        // 50% remaining
} as const;

// Usage
import { RETRY_CONFIG } from './constants/retry.js';
import { QUOTA_THRESHOLDS } from './constants/quota.js';

if (retryCount < RETRY_CONFIG.MAX_ATTEMPTS) {
  const delay = RETRY_CONFIG.BASE_DELAY_MS * 
    Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, retryCount);
  await sleep(Math.min(delay, RETRY_CONFIG.MAX_DELAY_MS));
}

if (quota.remaining / quota.total < QUOTA_THRESHOLDS.WARNING) {
  console.warn('Quota warning: 90% used');
}
```

### Effort Estimate
- **Time:** 1 day
- **Complexity:** Medium

---

## QUAL-003: Magic Strings (28 instances)

### Issue Details
- **Location:** Multiple files
- **Instances:** 28 magic strings

### Problem
```typescript
// Magic strings
if (role === 'user') { ... }
if (provider === 'kiro') { ... }
if (cacheType === 'ephemeral') { ... }
```

### Recommendation

**Use enums or constants:**

```typescript
// src/types/constants.ts
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system'
}

export enum Provider {
  KIRO = 'kiro',
  ANTHROPIC = 'anthropic',
  BEDROCK = 'bedrock'
}

export enum CacheType {
  EPHEMERAL = 'ephemeral',
  PERSISTENT = 'persistent'
}

// Usage
import { MessageRole, Provider, CacheType } from './types/constants.js';

if (role === MessageRole.USER) { ... }
if (provider === Provider.KIRO) { ... }
if (cacheType === CacheType.EPHEMERAL) { ... }
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Low

---

## ERR-004: Kiro Auth - Missing Try-Catch

### Issue Details
- **Location:** `src/accounts/kiro-auth-manager.ts`
- **Functions:** `selectAccountFromCombo()`, `rotateAccount()`, `initializeCombosFromRedis()`

### Problem
Multiple async Redis operations without error handling.

### Recommendation

**Add try-catch to all async operations:**

```typescript
// src/accounts/kiro-auth-manager.ts
export async function selectAccountFromCombo(
  comboId: string
): Promise<Account | null> {
  try {
    const combo = await redis.get(`combo:${comboId}`);
    
    if (!combo) {
      console.warn(`Combo ${comboId} not found`);
      return null;
    }
    
    const parsed = JSON.parse(combo);
    return parsed.account;
  } catch (error) {
    console.error(`Failed to select account from combo ${comboId}:`, error);
    throw new AccountError(
      `Failed to select account from combo: ${error.message}`,
      { cause: error }
    );
  }
}

export async function rotateAccount(comboId: string): Promise<void> {
  try {
    const combo = await redis.get(`combo:${comboId}`);
    
    if (!combo) {
      throw new AccountError(`Combo ${comboId} not found`);
    }
    
    // Rotation logic
    await redis.set(`combo:${comboId}`, JSON.stringify(updatedCombo));
  } catch (error) {
    console.error(`Failed to rotate account for combo ${comboId}:`, error);
    throw new AccountError(
      `Failed to rotate account: ${error.message}`,
      { cause: error }
    );
  }
}

// Custom error type
export class AccountError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AccountError';
  }
}
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Medium

---

## ERR-005: Inconsistent Logging

### Issue Details
- **Location:** `src/infrastructure/`, `src/streaming/`, `src/accounts/`
- **Problem:** Mix of `console.log/error` and structured logging

### Recommendation

**Replace all console.log with structured logger:**

```typescript
// src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

// Usage
import { logger } from './utils/logger.js';

// Replace console.log
logger.info('Connecting to Qdrant', { host, port });

// Replace console.error
logger.error('Failed to connect to Redis', { 
  error: error.message,
  stack: error.stack 
});

// Add context
logger.info('Request processed', {
  requestId,
  duration: Date.now() - startTime,
  statusCode: 200
});
```

### Effort Estimate
- **Time:** 1 day
- **Complexity:** Medium

---

## ERR-006: Missing Retry Logic for Infrastructure

### Issue Details
- **Location:** `src/infrastructure/`
- **Problem:** No retry logic for transient failures

### Recommendation

**Add retry with exponential backoff:**

```typescript
// src/utils/retry.ts
import { RETRY_CONFIG } from '../constants/retry.js';

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS,
    baseDelay = RETRY_CONFIG.BASE_DELAY_MS,
    maxDelay = RETRY_CONFIG.MAX_DELAY_MS,
    onRetry
  } = options;
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        break;
      }
      
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt - 1),
        maxDelay
      );
      
      onRetry?.(attempt, lastError);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Usage in infrastructure
import { retryWithBackoff } from '../utils/retry.js';

export async function connect(): Promise<void> {
  await retryWithBackoff(
    async () => {
      await qdrant.connect();
    },
    {
      maxAttempts: 3,
      onRetry: (attempt, error) => {
        logger.warn(`Qdrant connection attempt ${attempt} failed`, {
          error: error.message
        });
      }
    }
  );
}
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Medium

---

## TEST-004: Infrastructure Module Low Coverage (38%)

### Issue Details
- **Location:** `src/infrastructure/`
- **Coverage:** 38%

### Recommendation

**Add infrastructure tests:**

```typescript
// src/infrastructure/__tests__/redis.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedisClient } from '../redis.js';

describe('RedisClient', () => {
  let client: RedisClient;
  
  beforeEach(() => {
    client = new RedisClient({
      url: 'redis://localhost:6379'
    });
  });
  
  afterEach(async () => {
    await client.disconnect();
  });
  
  it('should connect successfully', async () => {
    await expect(client.connect()).resolves.not.toThrow();
  });
  
  it('should handle connection errors', async () => {
    const badClient = new RedisClient({
      url: 'redis://invalid:9999'
    });
    
    await expect(badClient.connect()).rejects.toThrow();
  });
  
  it('should retry on transient failures', async () => {
    // Test retry logic
  });
  
  it('should perform health check', async () => {
    await client.connect();
    const health = await client.healthCheck();
    expect(health.status).toBe('healthy');
  });
});
```

### Effort Estimate
- **Time:** 1 day
- **Complexity:** Medium

---

## TEST-005: Config Module Low Coverage (55%)

### Issue Details
- **Location:** `src/config/`
- **Coverage:** 55%

### Recommendation

**Add config tests:**

```typescript
// src/config/__tests__/manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager } from '../manager.js';

describe('ConfigManager', () => {
  let config: ConfigManager;
  
  beforeEach(() => {
    config = new ConfigManager();
  });
  
  it('should load from environment variables', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    config.loadFromEnvironment();
    expect(config.get('redisUrl')).toBe('redis://localhost:6379');
  });
  
  it('should validate required fields', () => {
    expect(() => config.validate()).toThrow('Missing required config');
  });
  
  it('should use default values', () => {
    expect(config.get('port')).toBe(3000);
  });
  
  it('should handle hot reload', async () => {
    // Test hot reload
  });
});
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Low

---

## SEC-004: No HTTPS Enforcement

### Issue Details
- **Location:** `src/server/index.ts`
- **Problem:** Server accepts HTTP connections

### Recommendation

**Enforce HTTPS in production:**

```typescript
// src/server/middleware/https.ts
import type { Request, Response, NextFunction } from 'express';

export function enforceHttps(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (process.env.NODE_ENV === 'production') {
    if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
  }
  next();
}

export function hstsHeaders(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  next();
}

// Usage
import { enforceHttps, hstsHeaders } from './middleware/https.js';

app.use(enforceHttps);
app.use(hstsHeaders);
```

### Effort Estimate
- **Time:** 2-3 hours
- **Complexity:** Low
- **Breaking Changes:** Yes (HTTP clients will be redirected)

---

## SEC-005: Plaintext Session Storage in Redis

### Issue Details
- **Location:** `src/accounts/kiro-auth-manager.ts`
- **Problem:** Session tokens stored as plaintext

### Recommendation

**Encrypt session data:**

```typescript
// src/utils/encryption.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return: iv + authTag + encrypted
  return iv.toString('hex') + authTag.toString('hex') + encrypted;
}

export function decrypt(encrypted: string): string {
  const iv = Buffer.from(encrypted.slice(0, IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(
    encrypted.slice(IV_LENGTH * 2, (IV_LENGTH + AUTH_TAG_LENGTH) * 2),
    'hex'
  );
  const ciphertext = encrypted.slice((IV_LENGTH + AUTH_TAG_LENGTH) * 2);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Usage in kiro-auth-manager.ts
import { encrypt, decrypt } from '../utils/encryption.js';

export async function storeSession(sessionId: string, data: SessionData) {
  const encrypted = encrypt(JSON.stringify(data));
  await redis.set(`session:${sessionId}`, encrypted);
}

export async function getSession(sessionId: string): Promise<SessionData | null> {
  const encrypted = await redis.get(`session:${sessionId}`);
  if (!encrypted) return null;
  
  const decrypted = decrypt(encrypted);
  return JSON.parse(decrypted);
}
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Medium

---

## SEC-006: Sensitive Headers Logged

### Issue Details
- **Location:** `src/server/index.ts`
- **Problem:** Headers including `x-api-key` and `x-session-token` logged in plaintext

### Recommendation

**Sanitize sensitive headers:**

```typescript
// src/utils/sanitize.ts
const SENSITIVE_HEADERS = [
  'x-api-key',
  'x-session-token',
  'authorization',
  'cookie'
];

export function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const sanitized = { ...headers };
  
  for (const key of SENSITIVE_HEADERS) {
    if (sanitized[key]) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

// Usage in logging middleware
import { sanitizeHeaders } from '../utils/sanitize.js';

app.use((req, res, next) => {
  logger.info('Request received', {
    method: req.method,
    path: req.path,
    headers: sanitizeHeaders(req.headers)
  });
  next();
});
```

### Effort Estimate
- **Time:** 2-3 hours
- **Complexity:** Low

---

## SEC-007: Weak Query Parameter Validation

### Issue Details
- **Location:** `src/server/routes.ts`
- **Endpoint:** `/admin/analytics`

### Recommendation

**Add comprehensive validation:**

```typescript
// src/middleware/validation.ts
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

const analyticsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  metric: z.enum(['requests', 'tokens', 'latency', 'errors']).optional(),
  groupBy: z.enum(['hour', 'day', 'week', 'month']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

export function validateAnalyticsQuery(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    req.query = analyticsQuerySchema.parse(req.query);
    next();
  } catch (error) {
    res.status(400).json({
      error: 'Invalid query parameters',
      details: error.errors
    });
  }
}

// Usage
app.get('/admin/analytics', validateAnalyticsQuery, handleAnalyticsRequest);
```

### Effort Estimate
- **Time:** 3-4 hours
- **Complexity:** Low

---

## SEC-008: No Redis Authentication Enforcement

### Issue Details
- **Location:** `src/config/manager.ts`
- **Problem:** Redis can be used without authentication

### Recommendation

**Enforce Redis auth in production:**

```typescript
// src/config/manager.ts
export function validateRedisConfig(config: Config): void {
  const redisUrl = new URL(config.redisUrl);
  
  if (process.env.NODE_ENV === 'production') {
    // Require password
    if (!redisUrl.password) {
      throw new ConfigError(
        'Redis password is required in production. ' +
        'Set REDIS_URL with password: redis://:password@host:port'
      );
    }
    
    // Require TLS
    if (redisUrl.protocol !== 'rediss:') {
      throw new ConfigError(
        'Redis TLS is required in production. ' +
        'Use rediss:// protocol instead of redis://'
      );
    }
  }
}

// Call during startup
validateRedisConfig(config);
```

### Effort Estimate
- **Time:** 2-3 hours
- **Complexity:** Low

---

## PERF-002: Missing Parallelization in Request Pipeline

### Issue Details
- **Location:** `src/server/routes.ts`
- **Potential Savings:** 110-220ms per request (26-30%)

### Recommendation

**Parallelize independent operations:**

```typescript
// Current (sequential)
const cached = await checkCache(request);
const classification = await classifyRequest(request);
const optimized = await optimizeContext(request);
const account = await selectAccount();

// Improved (parallel)
const [cached, classification, optimized, account] = await Promise.all([
  checkCache(request),
  classifyRequest(request),
  optimizeContext(request),
  selectAccount()
]);
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Low

---

## PERF-003: No Connection Pooling for External APIs

### Issue Details
- **Location:** `src/optimizers/semantic-deduplication.ts`
- **Problem:** No connection pooling for Voyage AI, Qdrant, Anthropic

### Recommendation

**Configure HTTP agents with pooling:**

```typescript
// src/infrastructure/http-agent.ts
import http from 'http';
import https from 'https';

export const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000
});

export const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000
});

// Usage in Voyage client
import { httpsAgent } from './http-agent.js';

const voyageClient = axios.create({
  baseURL: 'https://api.voyageai.com',
  httpsAgent
});
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Medium

---

## PERF-004: Synchronous Embedding Generation

### Issue Details
- **Location:** `src/optimizers/semantic-deduplication.ts`
- **Problem:** Blocks request for ~200ms

### Recommendation

**Implement async queue with batching:**

```typescript
// src/utils/embedding-queue.ts
import PQueue from 'p-queue';

const queue = new PQueue({
  concurrency: 5,
  interval: 1000,
  intervalCap: 10
});

export async function generateEmbedding(text: string): Promise<number[]> {
  return queue.add(async () => {
    const response = await voyageClient.post('/embeddings', {
      input: text,
      model: 'voyage-2'
    });
    return response.data.embedding;
  });
}

// Batch processing
export async function generateEmbeddingsBatch(
  texts: string[]
): Promise<number[][]> {
  return queue.add(async () => {
    const response = await voyageClient.post('/embeddings', {
      input: texts,
      model: 'voyage-2'
    });
    return response.data.embeddings;
  });
}
```

### Effort Estimate
- **Time:** 1-2 days
- **Complexity:** High

---

## PERF-005: No Circuit Breaker Pattern

### Issue Details
- **Location:** All external API calls
- **Problem:** Continues trying even if service is down

### Recommendation

**Implement circuit breaker:**

```typescript
// src/utils/circuit-breaker.ts
import CircuitBreaker from 'opossum';

const options = {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
};

export function createCircuitBreaker<T>(
  fn: (...args: any[]) => Promise<T>,
  name: string
): CircuitBreaker<any[], T> {
  const breaker = new CircuitBreaker(fn, options);
  
  breaker.on('open', () => {
    logger.warn(`Circuit breaker opened for ${name}`);
  });
  
  breaker.on('halfOpen', () => {
    logger.info(`Circuit breaker half-open for ${name}`);
  });
  
  breaker.on('close', () => {
    logger.info(`Circuit breaker closed for ${name}`);
  });
  
  return breaker;
}

// Usage
const voyageBreaker = createCircuitBreaker(
  async (text: string) => {
    return await voyageClient.post('/embeddings', { input: text });
  },
  'voyage-api'
);

const embedding = await voyageBreaker.fire(text);
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Medium

---

## Summary

**Total High Priority Issues:** 23
**Estimated Total Effort:** 10-15 days

**Quick Wins (Low Effort, High Impact):**
- SEC-004: HTTPS enforcement (2-3 hours)
- SEC-006: Sanitize headers (2-3 hours)
- SEC-007: Query validation (3-4 hours)
- SEC-008: Redis auth (2-3 hours)
- QUAL-003: Magic strings (4-6 hours)
- PERF-002: Parallelization (4-6 hours)

**Recommended Order:**
1. Security fixes (SEC-004, SEC-006, SEC-007, SEC-008) - 1 day
2. Error handling (ERR-004, ERR-005, ERR-006) - 2 days
3. Code quality (QUAL-001, QUAL-002, QUAL-003) - 2-3 days
4. Performance (PERF-002, PERF-003, PERF-005) - 2-3 days
5. Testing (TEST-004, TEST-005) - 1-2 days
6. Architecture (ARCH-003) - 1 day

**Next Steps:** Proceed to action plan creation
