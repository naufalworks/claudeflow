# Critical Issues - Detailed Recommendations

**Generated:** May 3, 2026
**Priority:** Critical (Must be resolved before deployment)
**Total Issues:** 12

---

## ARCH-001: God Object - server/routes.ts (1109 lines)

### Issue Details
- **Location:** `src/server/routes.ts`
- **Lines:** 1109
- **Functions:** 70
- **Max Complexity:** 43
- **Dependencies:** 16

### Problem
The routes.ts file violates the Single Responsibility Principle by handling:
- Message routing
- Streaming management
- Analytics endpoints
- Health checks
- Metrics collection
- Error handling
- Request validation
- Response formatting

### Impact
- **Maintainability:** Extremely difficult to understand and modify
- **Testability:** Hard to write focused unit tests
- **Bug Risk:** High - changes in one area can break others
- **Collaboration:** Merge conflicts likely with multiple developers

### Recommendation

**Split into 5 focused modules:**

```
src/server/
├── routes/
│   ├── messages.ts       # Message handling (POST /v1/messages)
│   ├── streaming.ts      # Streaming endpoints
│   ├── analytics.ts      # Analytics endpoints (GET /admin/analytics)
│   ├── health.ts         # Health checks (GET /health)
│   └── index.ts          # Route registration
├── middleware/
│   ├── validation.ts     # Request validation
│   ├── error-handler.ts  # Error handling middleware
│   └── index.ts
└── index.ts              # Server setup
```

### Implementation Steps

**Step 1: Create messages.ts**
```typescript
// src/server/routes/messages.ts
import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

router.post('/v1/messages', async (req: Request, res: Response) => {
  // Move handleMessagesRequest logic here
  // Keep focused on message handling only
});

export default router;
```

**Step 2: Create streaming.ts**
```typescript
// src/server/routes/streaming.ts
import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

router.post('/v1/messages/stream', async (req: Request, res: Response) => {
  // Move handleStreamingRequest logic here
  // Keep focused on streaming only
});

export default router;
```

**Step 3: Create analytics.ts**
```typescript
// src/server/routes/analytics.ts
import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

router.get('/admin/analytics', async (req: Request, res: Response) => {
  // Move handleAnalyticsRequest logic here
});

router.get('/metrics', async (req: Request, res: Response) => {
  // Move handleMetricsRequest logic here
});

export default router;
```

**Step 4: Create health.ts**
```typescript
// src/server/routes/health.ts
import { Router } from 'express';
import type { Request, Response } from 'express';

const router = Router();

router.get('/health', async (req: Request, res: Response) => {
  // Move health check logic here
});

export default router;
```

**Step 5: Create middleware**
```typescript
// src/server/middleware/validation.ts
import type { Request, Response, NextFunction } from 'express';

export function validateMessageRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Move validation logic here
  next();
}

// src/server/middleware/error-handler.ts
import type { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Move error handling logic here
}
```

**Step 6: Register routes**
```typescript
// src/server/routes/index.ts
import { Router } from 'express';
import messagesRouter from './messages.js';
import streamingRouter from './streaming.js';
import analyticsRouter from './analytics.js';
import healthRouter from './health.js';

const router = Router();

router.use(messagesRouter);
router.use(streamingRouter);
router.use(analyticsRouter);
router.use(healthRouter);

export default router;
```

### Effort Estimate
- **Time:** 2-3 days
- **Complexity:** High
- **Breaking Changes:** Yes (internal module structure)

### Dependencies
- Should be done before: ARCH-002, PERF-002, ERR-007

---

## ARCH-002: Circular Dependency - server/index.ts ↔ server/routes.ts

### Issue Details
- **Location:** `src/server/index.ts`, `src/server/routes.ts`
- **Type:** Circular dependency

### Problem
Server initialization and routes modules depend on each other, causing:
- Initialization order issues
- Tight coupling
- Difficult to test in isolation

### Impact
- **Initialization:** May fail in certain conditions
- **Testing:** Cannot mock dependencies properly
- **Maintainability:** Changes ripple through both modules

### Recommendation

**Break the cycle using dependency injection:**

```typescript
// src/server/types.ts (shared types)
export interface ServerDependencies {
  infrastructure: Infrastructure;
  config: Config;
}

// src/server/routes/messages.ts
import type { ServerDependencies } from '../types.js';

export function createMessagesRouter(deps: ServerDependencies) {
  const router = Router();
  
  router.post('/v1/messages', async (req, res) => {
    // Use deps.infrastructure, deps.config
  });
  
  return router;
}

// src/server/index.ts
import { createMessagesRouter } from './routes/messages.js';

export function createServer(deps: ServerDependencies) {
  const app = express();
  
  const messagesRouter = createMessagesRouter(deps);
  app.use(messagesRouter);
  
  return app;
}
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Low
- **Breaking Changes:** Yes (internal structure)

### Dependencies
- Easier after: ARCH-001

---

## ERR-001: Infrastructure Initialization - No Error Handling

### Issue Details
- **Location:** `src/infrastructure/index.ts`
- **Function:** `initializeInfrastructure()`

### Problem
```typescript
// Current code (PROBLEMATIC)
export async function initializeInfrastructure() {
  await Promise.all([
    qdrant.connect(),
    redis.connect()
  ]);
}
```

No try-catch means:
- Unclear error messages on failure
- No indication which service failed
- No cleanup on partial failure

### Impact
- **User Experience:** Cryptic error messages
- **Debugging:** Hard to identify which service failed
- **Reliability:** No graceful degradation

### Recommendation

**Add comprehensive error handling:**

```typescript
// src/infrastructure/index.ts
export async function initializeInfrastructure(): Promise<void> {
  const errors: Error[] = [];
  
  try {
    console.log('Connecting to Qdrant...');
    await qdrant.connect();
    console.log('✓ Qdrant connected');
  } catch (error) {
    const message = 'Failed to connect to Qdrant';
    console.error(message, error);
    errors.push(new InfrastructureError(message, { cause: error }));
  }
  
  try {
    console.log('Connecting to Redis...');
    await redis.connect();
    console.log('✓ Redis connected');
  } catch (error) {
    const message = 'Failed to connect to Redis';
    console.error(message, error);
    errors.push(new InfrastructureError(message, { cause: error }));
  }
  
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Infrastructure initialization failed: ${errors.length} service(s) failed to connect`
    );
  }
  
  console.log('✓ All infrastructure services connected');
}

// Custom error type
export class InfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InfrastructureError';
  }
}
```

### Effort Estimate
- **Time:** 2-3 hours
- **Complexity:** Low
- **Breaking Changes:** No

---

## ERR-002: Health Check - No Error Handling

### Issue Details
- **Location:** `src/infrastructure/index.ts`
- **Function:** `healthCheckAll()`

### Problem
```typescript
// Current code (PROBLEMATIC)
export async function healthCheckAll() {
  const results = await Promise.all([
    qdrant.healthCheck(),
    redis.healthCheck()
  ]);
  return results;
}
```

Throws on any failure instead of returning partial status.

### Impact
- **Monitoring:** Health endpoint fails completely
- **Debugging:** Can't see which services are healthy
- **Operations:** No partial degradation visibility

### Recommendation

**Use Promise.allSettled() for partial status:**

```typescript
// src/infrastructure/index.ts
export interface HealthStatus {
  service: string;
  status: 'healthy' | 'unhealthy';
  message?: string;
  timestamp: string;
}

export async function healthCheckAll(): Promise<HealthStatus[]> {
  const checks = [
    { name: 'qdrant', check: () => qdrant.healthCheck() },
    { name: 'redis', check: () => redis.healthCheck() },
    { name: 'voyage', check: () => voyage.healthCheck() }
  ];
  
  const results = await Promise.allSettled(
    checks.map(({ check }) => check())
  );
  
  return checks.map(({ name }, index) => {
    const result = results[index];
    
    if (result.status === 'fulfilled') {
      return {
        service: name,
        status: 'healthy',
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        service: name,
        status: 'unhealthy',
        message: result.reason?.message || 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  });
}

// Usage in route
router.get('/health', async (req, res) => {
  const statuses = await healthCheckAll();
  const allHealthy = statuses.every(s => s.status === 'healthy');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    services: statuses
  });
});
```

### Effort Estimate
- **Time:** 2-3 hours
- **Complexity:** Low
- **Breaking Changes:** No

---

## ERR-003: Streaming Handler - No Error Handling

### Issue Details
- **Location:** `src/streaming/streaming-handler.ts`
- **Function:** `handleStream()`

### Problem
Generator function has no try-catch around event processing. Stream interruption causes:
- No cleanup
- Potential memory leaks
- Unclear error messages

### Impact
- **Memory:** Leaks on stream interruption
- **Reliability:** No graceful error handling
- **User Experience:** Unclear error messages

### Recommendation

**Add try-catch with cleanup:**

```typescript
// src/streaming/streaming-handler.ts
export async function* handleStream(
  response: AsyncIterable<StreamEvent>
): AsyncGenerator<string, void, unknown> {
  const state = createStreamState();
  
  try {
    for await (const event of response) {
      try {
        const chunk = processEvent(event, state);
        if (chunk) {
          yield chunk;
        }
      } catch (error) {
        console.error('Error processing stream event:', error);
        // Yield error event to client
        yield JSON.stringify({
          type: 'error',
          error: {
            message: 'Stream processing error',
            type: 'stream_error'
          }
        }) + '\n';
        break; // Stop processing on error
      }
    }
  } finally {
    // Cleanup resources
    cleanup(state);
  }
}

function cleanup(state: StreamState): void {
  // Clear accumulated content
  state.contentBlocks = [];
  state.toolUses = [];
  
  // Log cleanup
  console.log('Stream handler cleaned up');
}
```

### Effort Estimate
- **Time:** 3-4 hours
- **Complexity:** Medium
- **Breaking Changes:** No

---

## TEST-001: CLI Module Completely Untested (0% coverage)

### Issue Details
- **Location:** `src/cli/`
- **Files:** 26+ files (14 commands, 5 services, 5 utilities)
- **Coverage:** 0%

### Problem
Entire CLI module has no tests. This is a major user-facing component.

### Impact
- **Quality:** No confidence in CLI functionality
- **Regression:** Changes can break without detection
- **Maintenance:** Refactoring is risky

### Recommendation

**Create comprehensive CLI test suite:**

```typescript
// src/cli/commands/__tests__/login.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loginCommand } from '../login.js';

describe('login command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should prompt for email and password', async () => {
    const mockPrompt = vi.fn().mockResolvedValue({
      email: 'test@example.com',
      password: 'password123'
    });
    
    // Test implementation
  });
  
  it('should validate email format', async () => {
    // Test email validation
  });
  
  it('should handle authentication errors', async () => {
    // Test error handling
  });
  
  it('should store session token on success', async () => {
    // Test token storage
  });
});
```

**Test Strategy:**
1. **Unit tests** for each command (14 commands)
2. **Integration tests** for command flows
3. **Mock** external dependencies (API calls, file system)
4. **Test** error scenarios
5. **Test** user input validation

### Effort Estimate
- **Time:** 3-4 days
- **Complexity:** High
- **Breaking Changes:** No

---

## TEST-002: Overall Coverage Critically Low (25.42%)

### Issue Details
- **Current Coverage:** 25.42% (line), 23.19% (branch), 30.04% (function)
- **Target:** 80%
- **Gap:** 54.58%

### Problem
Insufficient test coverage means:
- Many code paths untested
- High risk of regressions
- Low confidence in changes

### Impact
- **Quality:** Cannot guarantee code works
- **Maintenance:** Refactoring is risky
- **Production:** High bug risk

### Recommendation

**Systematic coverage improvement:**

**Priority 1: Critical paths (Target: 80%)**
- `src/server/routes.ts` (currently 59.71%)
- `src/parsers/request-parser.ts` (currently 57.92%)
- `src/parsers/response-parser.ts` (currently 38.25%)

**Priority 2: Infrastructure (Target: 80%)**
- `src/infrastructure/` (currently 18.4%)
- `src/config/` (currently 0%)

**Priority 3: CLI (Target: 60%)**
- `src/cli/` (currently 0%)

**Implementation Plan:**
1. Week 1: Server routes and parsers
2. Week 2: Infrastructure and config
3. Week 3: CLI commands
4. Week 4: Integration tests

### Effort Estimate
- **Time:** 5-7 days
- **Complexity:** High
- **Breaking Changes:** No

---

## TEST-003: No Integration Tests

### Issue Details
- **Location:** `tests/`
- **Current:** Only unit tests exist
- **Missing:** End-to-end integration tests

### Problem
No tests for:
- Full request flow (client → server → Claude API → response)
- Kiro authentication flow
- Session refresh flow
- Cache hit/miss scenarios
- Error recovery scenarios

### Impact
- **Confidence:** Cannot verify system works end-to-end
- **Regressions:** Integration bugs not caught
- **Deployment:** High risk of production issues

### Recommendation

**Create integration test suite:**

```typescript
// tests/integration/message-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/server/index.js';

describe('Message Flow Integration', () => {
  let server: any;
  
  beforeAll(async () => {
    // Start test server with test infrastructure
    server = await createServer({
      infrastructure: createTestInfrastructure(),
      config: createTestConfig()
    });
  });
  
  afterAll(async () => {
    await server.close();
  });
  
  it('should handle complete message flow', async () => {
    const response = await request(server)
      .post('/v1/messages')
      .set('x-api-key', 'test-key')
      .send({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 100
      });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('content');
    expect(response.body.content).toBeInstanceOf(Array);
  });
  
  it('should handle streaming flow', async () => {
    // Test streaming
  });
  
  it('should handle cache hit scenario', async () => {
    // Test cache hit
  });
  
  it('should handle authentication errors', async () => {
    // Test auth errors
  });
});
```

### Effort Estimate
- **Time:** 2-3 days
- **Complexity:** High
- **Breaking Changes:** No

---

## SEC-001: No Rate Limiting on Any Endpoint

### Issue Details
- **Location:** `src/server/index.ts`
- **Affected:** All endpoints (API, admin, health)

### Problem
No rate limiting means:
- DoS attacks possible
- API quota abuse
- Resource exhaustion
- Cost explosion

### Impact
- **Security:** Critical vulnerability
- **Cost:** Unlimited API usage
- **Availability:** Service can be overwhelmed

### Recommendation

**Implement multi-tier rate limiting:**

```typescript
// src/server/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../infrastructure/redis.js';

// Global rate limit (all endpoints)
export const globalLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:global:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // 1000 requests per minute
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

// API endpoint rate limit
export const apiLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:api:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per API key
  keyGenerator: (req) => req.headers['x-api-key'] as string,
  message: 'API rate limit exceeded',
  standardHeaders: true,
  legacyHeaders: false
});

// Admin endpoint rate limit
export const adminLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:admin:'
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Admin rate limit exceeded',
  standardHeaders: true,
  legacyHeaders: false
});

// Usage in server
import { globalLimiter, apiLimiter, adminLimiter } from './middleware/rate-limit.js';

app.use(globalLimiter); // Apply to all routes

app.use('/v1/messages', apiLimiter); // API routes
app.use('/admin', adminLimiter); // Admin routes
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Medium
- **Breaking Changes:** No (but may affect high-volume clients)

---

## SEC-002: Permissive CORS Configuration

### Issue Details
- **Location:** `src/server/index.ts`
- **Current:** `origin: true, credentials: true`

### Problem
Allows ANY origin to make authenticated requests, enabling:
- Session hijacking
- CSRF attacks
- Data exfiltration

### Impact
- **Security:** Critical vulnerability
- **Data:** User data at risk
- **Compliance:** GDPR/privacy violations

### Recommendation

**Whitelist specific origins:**

```typescript
// src/server/middleware/cors.ts
import cors from 'cors';

const ALLOWED_ORIGINS = [
  'https://app.example.com',
  'https://dashboard.example.com',
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
].filter(Boolean);

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  maxAge: 86400 // 24 hours
};

// Usage
import { corsOptions } from './middleware/cors.js';
app.use(cors(corsOptions));
```

### Effort Estimate
- **Time:** 2-3 hours
- **Complexity:** Low
- **Breaking Changes:** Yes (clients not in whitelist will be blocked)

---

## SEC-003: No Authentication on Admin Endpoints

### Issue Details
- **Location:** `src/server/index.ts`
- **Endpoints:** `/admin/analytics`, `/metrics`

### Problem
Anyone can access sensitive analytics and metrics data without authentication.

### Impact
- **Security:** Information disclosure
- **Privacy:** User data exposed
- **Competition:** Business intelligence leak

### Recommendation

**Add API key authentication:**

```typescript
// src/server/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';

export function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const apiKey = req.headers['x-admin-key'];
  const validAdminKey = process.env.ADMIN_API_KEY;
  
  if (!validAdminKey) {
    return res.status(500).json({
      error: 'Server configuration error: ADMIN_API_KEY not set'
    });
  }
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'Missing admin API key'
    });
  }
  
  if (apiKey !== validAdminKey) {
    return res.status(403).json({
      error: 'Invalid admin API key'
    });
  }
  
  next();
}

// Usage
import { requireAdminAuth } from './middleware/auth.js';

app.use('/admin', requireAdminAuth);
app.use('/metrics', requireAdminAuth);
```

### Effort Estimate
- **Time:** 2-3 hours
- **Complexity:** Low
- **Breaking Changes:** Yes (requires authentication)

---

## PERF-001: No Memory Management in Streaming

### Issue Details
- **Location:** `src/streaming/streaming-handler.ts`
- **Problem:** Accumulates all content blocks indefinitely

### Problem
For long responses (10K+ tokens):
- Memory usage: 40KB+ with no cleanup
- No limit on accumulated data
- Memory leak potential

### Impact
- **Memory:** Leaks on long responses
- **Performance:** Degraded over time
- **Stability:** Potential crashes

### Recommendation

**Implement sliding window:**

```typescript
// src/streaming/streaming-handler.ts
const MAX_CONTENT_BLOCKS = 100; // Keep last 100 blocks
const MEMORY_LIMIT_MB = 10; // 10MB limit

interface StreamState {
  contentBlocks: ContentBlock[];
  totalSize: number;
}

function addContentBlock(state: StreamState, block: ContentBlock): void {
  state.contentBlocks.push(block);
  state.totalSize += estimateSize(block);
  
  // Sliding window: remove old blocks
  while (state.contentBlocks.length > MAX_CONTENT_BLOCKS) {
    const removed = state.contentBlocks.shift();
    if (removed) {
      state.totalSize -= estimateSize(removed);
    }
  }
  
  // Memory limit check
  if (state.totalSize > MEMORY_LIMIT_MB * 1024 * 1024) {
    console.warn('Stream memory limit exceeded, clearing old blocks');
    const keep = state.contentBlocks.slice(-50); // Keep last 50
    state.contentBlocks = keep;
    state.totalSize = keep.reduce((sum, b) => sum + estimateSize(b), 0);
  }
}

function estimateSize(block: ContentBlock): number {
  return JSON.stringify(block).length;
}
```

### Effort Estimate
- **Time:** 4-6 hours
- **Complexity:** Medium
- **Breaking Changes:** No

---

## Summary

**Total Critical Issues:** 12
**Estimated Total Effort:** 5-7 days
**Quick Wins:** 5 issues (ERR-001, ERR-002, SEC-002, SEC-003, SEC-001)

**Recommended Order:**
1. SEC-001, SEC-002, SEC-003 (Security - 1 day)
2. ERR-001, ERR-002 (Error handling - 0.5 days)
3. ERR-003, PERF-001 (Streaming - 1 day)
4. ARCH-002 (Circular dependency - 0.5 days)
5. ARCH-001 (God object - 2-3 days)
6. TEST-001, TEST-002, TEST-003 (Testing - 5-7 days in parallel)

**Next Steps:** Proceed to high-priority recommendations
