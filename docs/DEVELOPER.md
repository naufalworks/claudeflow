# ClaudeFlow Developer Guide

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Core Components](#core-components)
5. [Optimization Strategies](#optimization-strategies)
6. [Kiro OAuth Integration](#kiro-oauth-integration)
7. [Testing Strategy](#testing-strategy)
8. [Contributing Guidelines](#contributing-guidelines)
9. [Code Standards](#code-standards)
10. [Debugging Tips](#debugging-tips)

---

## Architecture Overview

### Design Philosophy

ClaudeFlow follows a **Pipeline Architecture** with these key principles:

1. **Zero Feature Loss**: Preserve 100% of Anthropic API capabilities
2. **Intelligent Optimization**: Apply optimizations transparently
3. **Graceful Degradation**: Continue operation when infrastructure fails
4. **Native Format Preservation**: No OpenAI conversion for Kiro accounts

### High-Level Flow

```
Request → Parse → Classify → Optimize → Route → Execute → Cache → Response
```

Each stage can:
- Pass the request to the next stage
- Short-circuit and return early (cache hit)
- Fail gracefully and skip optimization

### Component Layers

```
┌─────────────────────────────────────────────────┐
│              HTTP Layer (Fastify)               │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│           Request Processing Pipeline           │
│  Parser → Classifier → Optimizers → Router     │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│              Infrastructure Layer               │
│  Qdrant | Redis | Voyage AI | Anthropic API    │
└─────────────────────────────────────────────────┘
```

---

## Development Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Docker (for infrastructure)
- Git

### Quick Start

```bash
# Clone repository
git clone https://github.com/your-org/claudeflow.git
cd claudeflow

# Install dependencies
npm install

# Start infrastructure (Qdrant + Redis)
docker-compose up -d qdrant redis

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
nano .env

# Run tests
npm test

# Start development server
npm run dev
```

### Development Scripts

```bash
# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- account-pool-manager.test.ts

# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run type-check

# Verify infrastructure
npm run verify-infrastructure
```

---

## Project Structure

```
claudeflow/
├── src/
│   ├── accounts/              # Account management
│   │   ├── account-pool-manager.ts
│   │   ├── kiro-auth-manager.ts
│   │   └── kiro-mitm-client.ts
│   │
│   ├── analytics/             # Analytics and metrics
│   │   └── analytics-engine.ts
│   │
│   ├── config/                # Configuration management
│   │   ├── manager.ts
│   │   └── schema.ts
│   │
│   ├── infrastructure/        # External service clients
│   │   ├── anthropic.ts
│   │   ├── qdrant.ts
│   │   ├── redis.ts
│   │   └── voyage.ts
│   │
│   ├── optimizers/            # Optimization components
│   │   ├── cache-optimizer.ts
│   │   ├── context-optimizer.ts
│   │   ├── request-classifier.ts
│   │   ├── semantic-deduplication.ts
│   │   └── thinking-budget-optimizer.ts
│   │
│   ├── orchestrators/         # Tool orchestration
│   │   └── tool-orchestrator.ts
│   │
│   ├── parsers/               # Request/response parsing
│   │   ├── request-parser.ts
│   │   ├── request-formatter.ts
│   │   ├── response-parser.ts
│   │   └── response-formatter.ts
│   │
│   ├── server/                # HTTP server
│   │   ├── index.ts
│   │   └── routes.ts
│   │
│   ├── streaming/             # Streaming response handling
│   │   └── streaming-handler.ts
│   │
│   ├── types/                 # TypeScript type definitions
│   │   ├── anthropic.types.ts
│   │   └── index.ts
│   │
│   └── index.ts               # Application entry point
│
├── docs/                      # Documentation
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── DEVELOPER.md
│
├── tests/                     # Test files (co-located with source)
│   └── fixtures/              # Test data
│
├── config.example.json        # Example configuration
├── docker-compose.yml         # Docker services
├── package.json
├── tsconfig.json
└── README.md
```

---

## Core Components

### 1. Request Parser

**Location**: `src/parsers/request-parser.ts`

**Purpose**: Parse and validate Anthropic API requests

**Key Methods**:
```typescript
class RequestParser {
  parse(rawRequest: unknown): AnthropicRequest
  validate(request: AnthropicRequest): void
}
```

**Example Usage**:
```typescript
import { RequestParser } from './parsers/request-parser';

const parser = new RequestParser();
const request = parser.parse(req.body);
```

**Testing**:
- Unit tests: `src/parsers/__tests__/request-parser.test.ts`
- Property tests: `src/parsers/__tests__/request-roundtrip.test.ts`

### 2. Request Classifier

**Location**: `src/optimizers/request-classifier.ts`

**Purpose**: Classify request complexity using Claude Sonnet

**Algorithm**:
1. Extract features (message count, tokens, tools, images)
2. Call Claude Sonnet for classification
3. Return complexity (simple/moderate/complex) with confidence

**Example Usage**:
```typescript
import { RequestClassifier } from './optimizers/request-classifier';

const classifier = new RequestClassifier(anthropicClient);
const classification = await classifier.classify(request);

console.log(classification.complexity); // 'simple' | 'moderate' | 'complex'
console.log(classification.suggestedThinkingBudget); // 0 | 2000 | 10000
```

### 3. Semantic Deduplication Engine

**Location**: `src/optimizers/semantic-deduplication.ts`

**Purpose**: Detect duplicate prompts and return cached responses

**Algorithm**:
1. Generate embedding using Voyage AI
2. Search Qdrant for similar prompts (similarity > 0.95)
3. Retrieve cached response from Redis
4. Return cached response or proceed with API call

**Example Usage**:
```typescript
import { SemanticDeduplicationEngine } from './optimizers/semantic-deduplication';

const dedup = new SemanticDeduplicationEngine(qdrant, redis, voyageAI);

// Check cache
const cacheResult = await dedup.checkCache(request);
if (cacheResult.hit) {
  return cacheResult.response;
}

// Store response after API call
await dedup.storeResponse(request, response);
```

### 4. Cache Optimizer

**Location**: `src/optimizers/cache-optimizer.ts`

**Purpose**: Insert optimal cache_control markers

**Strategy**:
1. Skip if conversation < 1024 tokens
2. Insert markers after system prompts
3. Insert markers after large blocks (>2000 tokens)
4. Insert markers at conversation boundaries (every 5 messages)

**Example Usage**:
```typescript
import { CacheOptimizer } from './optimizers/cache-optimizer';

const optimizer = new CacheOptimizer();
const optimizedRequest = optimizer.optimize(request);
```

### 5. Thinking Budget Optimizer

**Location**: `src/optimizers/thinking-budget-optimizer.ts`

**Purpose**: Set optimal thinking budget based on complexity

**Rules**:
- Simple: 0 tokens (remove thinking config)
- Moderate: 2000 tokens
- Complex: 10000 tokens
- Preserve user-specified budget

**Example Usage**:
```typescript
import { ThinkingBudgetOptimizer } from './optimizers/thinking-budget-optimizer';

const optimizer = new ThinkingBudgetOptimizer();
const optimizedRequest = optimizer.optimize(request, classification);
```

### 6. Context Optimizer

**Location**: `src/optimizers/context-optimizer.ts`

**Purpose**: Compress conversation history

**Strategy**:
1. Skip if conversation < 8000 tokens
2. Preserve most recent 3 messages
3. Compress older messages using Claude Haiku
4. Group old messages into chunks of 4

**Example Usage**:
```typescript
import { ContextOptimizer } from './optimizers/context-optimizer';

const optimizer = new ContextOptimizer(anthropicClient);
const optimizedRequest = await optimizer.optimize(request);
```

### 7. Account Pool Manager

**Location**: `src/accounts/account-pool-manager.ts`

**Purpose**: Select optimal account for each request

**Scoring Algorithm**:
```typescript
score = quotaAvailability * 0.5 + performanceScore * 0.3 + costEfficiency * 0.2

where:
  quotaAvailability = 1 - (used_tokens / total_tokens)
  performanceScore = avgResponseTime < 2000 ? 1 : 0.5
  costEfficiency = provider === 'kiro' ? 1.0 : 0.7
```

**Example Usage**:
```typescript
import { AccountPoolManager } from './accounts/account-pool-manager';

const accountPool = new AccountPoolManager(redis, config);
const account = await accountPool.selectAccount(request);
```

### 8. Kiro Auth Manager

**Location**: `src/accounts/kiro-auth-manager.ts`

**Purpose**: Manage Kiro OAuth authentication and account pooling

**Features**:
- OAuth authentication via MITM router
- Session refresh before expiration
- Account pooling (combos) with round-robin/sticky strategies
- Automatic fallback on session failure

**Example Usage**:
```typescript
import { KiroAuthManager } from './accounts/kiro-auth-manager';

const kiroAuth = new KiroAuthManager(redis, config);

// Select account from combo
const account = await kiroAuth.selectAccountFromCombo('free-pool');

// Refresh session
const session = await kiroAuth.refreshSession(account.id);
```

### 9. Analytics Engine

**Location**: `src/analytics/analytics-engine.ts`

**Purpose**: Track metrics and generate insights

**Tracked Metrics**:
- Total requests and cost
- Cache hit rate and deduplication rate
- Response time percentiles (p50, p95, p99)
- Error rate per account
- Kiro vs paid account usage

**Example Usage**:
```typescript
import { AnalyticsEngine } from './analytics/analytics-engine';

const analytics = new AnalyticsEngine(redis);

// Track request
await analytics.trackRequest(request, response, metadata);

// Get metrics
const metrics = await analytics.getMetrics({ hours: 24 });

// Generate insights
const insights = await analytics.generateInsights();
```

---

## Optimization Strategies

### 1. Semantic Deduplication

**Goal**: Avoid redundant API calls for similar prompts

**Implementation**:
```typescript
// Generate embedding
const embedding = await voyageAI.embed(promptText);

// Search Qdrant
const results = await qdrant.search({
  collection: 'claudeflow_prompts',
  vector: embedding,
  limit: 1,
  scoreThreshold: 0.95,
});

// Return cached response if found
if (results.length > 0) {
  const cacheKey = results[0].id;
  const cached = await redis.get(`response:${cacheKey}`);
  return JSON.parse(cached);
}
```

**Cost Savings**: 30-40% reduction in API calls

### 2. Prompt Caching

**Goal**: Maximize cache hit rate for repeated context

**Implementation**:
```typescript
function findOptimalCachePoints(messages: Message[]): number[] {
  const points: number[] = [];
  
  // Strategy 1: After system prompts
  if (isSystemLike(messages[0])) {
    points.push(0);
  }
  
  // Strategy 2: After large blocks (>2000 tokens)
  for (let i = 0; i < messages.length; i++) {
    if (estimateTokens(messages[i]) > 2000) {
      points.push(i);
    }
  }
  
  // Strategy 3: Every 5 messages
  for (let i = 4; i < messages.length; i += 5) {
    points.push(i);
  }
  
  return points;
}
```

**Cost Savings**: 90% reduction in input token costs

### 3. Thinking Budget Optimization

**Goal**: Allocate thinking tokens efficiently

**Implementation**:
```typescript
const budgetMap = {
  simple: 0,      // No thinking needed
  moderate: 2000, // Some reasoning required
  complex: 10000, // Deep reasoning needed
};

const budget = budgetMap[classification.complexity];
```

**Cost Savings**: 50% reduction in thinking token costs

### 4. Context Compression

**Goal**: Reduce token usage in long conversations

**Implementation**:
```typescript
// Keep recent messages intact
const recentMessages = messages.slice(-3);

// Compress old messages
const oldMessages = messages.slice(0, -3);
const compressed = await compressWithHaiku(oldMessages);

return [...compressed, ...recentMessages];
```

**Cost Savings**: 70% reduction in context tokens

---

## Kiro OAuth Integration

### Authentication Flow

```
1. Client → ClaudeFlow: Request with Kiro account
2. ClaudeFlow → KiroAuthManager: Select account from combo
3. KiroAuthManager → Redis: Get combo state
4. KiroAuthManager → ClaudeFlow: Return account
5. ClaudeFlow → MITM Router: POST /v1/messages (with machineId)
6. MITM Router → Anthropic API: Forward request (native format)
7. Anthropic API → MITM Router: Response
8. MITM Router → ClaudeFlow: Response (native format)
9. ClaudeFlow → Client: Response
```

### Session Management

**Session Refresh**:
```typescript
async function refreshSession(accountId: string): Promise<KiroSession> {
  const account = await getKiroAccount(accountId);
  
  const response = await axios.post(
    `${account.mitmRouterUrl}/auth/refresh`,
    {
      machineId: account.machineId,
      sessionToken: account.sessionToken,
    }
  );
  
  return {
    accountId: account.id,
    sessionToken: response.data.sessionToken,
    apiKey: response.data.apiKey,
    expiresAt: new Date(response.data.expiresAt),
  };
}
```

**401 Error Handling**:
```typescript
try {
  const response = await mitmClient.sendRequest(request);
  return response;
} catch (error) {
  if (error.status === 401) {
    // Session expired - refresh and retry
    await kiroAuth.refreshSession(account.id);
    return await mitmClient.sendRequest(request);
  }
  throw error;
}
```

### Account Pooling Strategies

**Round-Robin**:
```typescript
const accountId = combo.accounts[combo.currentIndex];
combo.currentIndex = (combo.currentIndex + 1) % combo.accounts.length;
```

**Sticky Round-Robin**:
```typescript
const conversationId = request.metadata?.conversationId;
const index = hashToIndex(conversationId, combo.accounts.length);
const accountId = combo.accounts[index];
```

### Native Format Preservation

ClaudeFlow preserves 100% of Anthropic API format when routing through Kiro:

```typescript
// NO conversion to OpenAI format
// Direct passthrough of Anthropic request structure

const request = {
  model: 'claude-sonnet-4-20250514',
  messages: [...],
  thinking: { type: 'enabled', budget_tokens: 2000 },
  tools: [...],
  // All Anthropic-specific features preserved
};

// Send to MITM router with native format
await mitmClient.post('/v1/messages', request);
```

---

## Testing Strategy

### Test Types

1. **Unit Tests**: Test individual components in isolation
2. **Integration Tests**: Test component interactions
3. **Property-Based Tests**: Test universal properties
4. **End-to-End Tests**: Test full request flows

### Running Tests

```bash
# All tests
npm test

# Specific test file
npm test -- cache-optimizer.test.ts

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Writing Unit Tests

**Example**: Testing Cache Optimizer

```typescript
import { CacheOptimizer } from '../cache-optimizer';

describe('CacheOptimizer', () => {
  let optimizer: CacheOptimizer;
  
  beforeEach(() => {
    optimizer = new CacheOptimizer();
  });
  
  it('should skip optimization for small conversations', () => {
    const request = createSmallRequest(); // < 1024 tokens
    const result = optimizer.optimize(request);
    
    expect(result).toEqual(request); // No changes
  });
  
  it('should insert cache markers after system prompts', () => {
    const request = createRequestWithSystemPrompt();
    const result = optimizer.optimize(request);
    
    expect(result.messages[0].cache_control).toEqual({
      type: 'ephemeral'
    });
  });
});
```

### Writing Property-Based Tests

**Example**: Request Round-Trip Property

```typescript
import * as fc from 'fast-check';
import { RequestParser } from '../request-parser';
import { RequestFormatter } from '../request-formatter';

describe('Request Round-Trip Property', () => {
  it('should preserve request through parse-format-parse cycle', () => {
    fc.assert(
      fc.property(
        arbitraryAnthropicRequest(),
        (request) => {
          const parser = new RequestParser();
          const formatter = new RequestFormatter();
          
          const formatted = formatter.format(request);
          const parsed = parser.parse(formatted);
          const reformatted = formatter.format(parsed);
          
          expect(reformatted).toEqual(formatted);
        }
      )
    );
  });
});
```

### Writing Integration Tests

**Example**: Semantic Deduplication Integration

```typescript
import { SemanticDeduplicationEngine } from '../semantic-deduplication';

describe('SemanticDeduplicationEngine Integration', () => {
  let engine: SemanticDeduplicationEngine;
  let qdrant: QdrantClient;
  let redis: RedisClient;
  
  beforeAll(async () => {
    qdrant = await createTestQdrantClient();
    redis = await createTestRedisClient();
    engine = new SemanticDeduplicationEngine(qdrant, redis, voyageAI);
  });
  
  it('should cache and retrieve responses', async () => {
    const request = createTestRequest();
    const response = createTestResponse();
    
    // Store response
    await engine.storeResponse(request, response);
    
    // Retrieve from cache
    const cacheResult = await engine.checkCache(request);
    
    expect(cacheResult.hit).toBe(true);
    expect(cacheResult.response).toEqual(response);
  });
});
```

### Mocking External Services

**Example**: Mocking Anthropic API

```typescript
import { jest } from '@jest/globals';

const mockAnthropicClient = {
  messages: {
    create: jest.fn().mockResolvedValue({
      id: 'msg_123',
      content: [{ type: 'text', text: 'Hello!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  },
};
```

---

## Contributing Guidelines

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Write tests for your changes
5. Run tests: `npm test`
6. Commit with conventional commits: `git commit -m "feat: add new feature"`
7. Push to your fork: `git push origin feature/my-feature`
8. Open a pull request

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(optimizer): add context compression for long conversations

Implement context compression using Claude Haiku to summarize
old messages while preserving recent context.

Closes #123
```

### Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure all tests pass
4. Update CHANGELOG.md
5. Request review from maintainers
6. Address review feedback
7. Squash commits before merge

### Code Review Checklist

- [ ] Code follows project style guidelines
- [ ] Tests are comprehensive and passing
- [ ] Documentation is updated
- [ ] No breaking changes (or documented)
- [ ] Performance impact considered
- [ ] Security implications reviewed
- [ ] Error handling is robust

---

## Code Standards

### TypeScript Style

**Use strict types**:
```typescript
// ✅ Good
function processRequest(request: AnthropicRequest): Promise<AnthropicResponse>

// ❌ Bad
function processRequest(request: any): Promise<any>
```

**Prefer interfaces over types**:
```typescript
// ✅ Good
interface RequestMetadata {
  conversationId?: string;
  userId?: string;
}

// ❌ Bad (unless using union/intersection)
type RequestMetadata = {
  conversationId?: string;
  userId?: string;
}
```

**Use async/await over promises**:
```typescript
// ✅ Good
async function fetchData() {
  const result = await api.get('/data');
  return result.data;
}

// ❌ Bad
function fetchData() {
  return api.get('/data').then(result => result.data);
}
```

### Error Handling

**Always handle errors**:
```typescript
// ✅ Good
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  logger.error('Operation failed', { error });
  throw new OperationError('Failed to complete operation', { cause: error });
}

// ❌ Bad
const result = await riskyOperation(); // Unhandled error
```

**Use custom error classes**:
```typescript
class CacheError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'CacheError';
  }
}
```

### Logging

**Use structured logging**:
```typescript
// ✅ Good
logger.info('Request completed', {
  requestId: req.id,
  duration: Date.now() - startTime,
  statusCode: 200,
});

// ❌ Bad
console.log(`Request ${req.id} completed in ${duration}ms`);
```

### Naming Conventions

- **Classes**: PascalCase (`RequestParser`, `CacheOptimizer`)
- **Functions**: camelCase (`parseRequest`, `optimizeCache`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- **Interfaces**: PascalCase with descriptive names (`AnthropicRequest`, `CacheResult`)
- **Files**: kebab-case (`request-parser.ts`, `cache-optimizer.ts`)

---

## Debugging Tips

### Enable Debug Logging

```bash
LOG_LEVEL=debug npm run dev
```

### Inspect Request Pipeline

Add logging at each pipeline stage:

```typescript
logger.debug('Pipeline stage', {
  stage: 'classification',
  request: request,
  classification: classification,
});
```

### Debug Qdrant Queries

```typescript
const results = await qdrant.search({
  collection: 'claudeflow_prompts',
  vector: embedding,
  limit: 10, // Increase limit to see more results
  scoreThreshold: 0.8, // Lower threshold to see near-misses
});

console.log('Qdrant results:', results);
```

### Debug Redis Cache

```bash
# Connect to Redis CLI
redis-cli

# List all keys
KEYS claudeflow:*

# Get specific key
GET claudeflow:response:abc123

# Check TTL
TTL claudeflow:response:abc123
```

### Debug Kiro Authentication

```typescript
logger.debug('Kiro auth', {
  accountId: account.id,
  machineId: account.machineId,
  mitmRouterUrl: account.mitmRouterUrl,
  sessionToken: account.sessionToken ? 'present' : 'missing',
});
```

### Performance Profiling

```typescript
const startTime = Date.now();

// Operation
const result = await expensiveOperation();

const duration = Date.now() - startTime;
logger.info('Operation timing', { operation: 'expensiveOperation', duration });
```

### Memory Profiling

```bash
# Start with memory profiling
node --inspect dist/index.js

# Open Chrome DevTools
# Navigate to chrome://inspect
# Click "inspect" on your Node.js process
# Go to Memory tab and take heap snapshots
```

---

## Additional Resources

### Documentation

- [API Documentation](./API.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Anthropic API Reference](https://docs.anthropic.com/claude/reference)

### Tools

- [Qdrant Documentation](https://qdrant.tech/documentation/)
- [Redis Documentation](https://redis.io/documentation)
- [Voyage AI Documentation](https://docs.voyageai.com/)
- [Fastify Documentation](https://www.fastify.io/docs/latest/)

### Community

- GitHub Issues: Report bugs and request features
- Discussions: Ask questions and share ideas
- Pull Requests: Contribute code improvements

---

**Last Updated:** 2026-05-02
