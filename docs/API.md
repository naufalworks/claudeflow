# ClaudeFlow API Documentation

## Overview

ClaudeFlow is an intelligent API router optimized for Anthropic's Claude models. It provides 100% compatibility with the Anthropic API while adding intelligent optimizations for cost reduction and performance improvement.

**Base URL:** `http://localhost:3000` (configurable)

**API Version:** v1

---

## Authentication

All requests require an API key in the `x-api-key` header or `Authorization` header with `Bearer` prefix.

```bash
# Using x-api-key header
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3000/v1/messages

# Using Authorization header
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:3000/v1/messages
```

---

## Endpoints

### POST /v1/messages

Create a message with Claude models. Supports both streaming and non-streaming responses.

**Request Body:**

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [
    {
      "role": "user",
      "content": "Hello, Claude!"
    }
  ],
  "max_tokens": 1024,
  "temperature": 0.7,
  "stream": false
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model identifier (e.g., `claude-sonnet-4-20250514`) |
| `messages` | array | Yes | Array of message objects with `role` and `content` |
| `max_tokens` | integer | Yes | Maximum tokens to generate (1-4096) |
| `temperature` | number | No | Sampling temperature (0-1, default: 1.0) |
| `top_p` | number | No | Nucleus sampling parameter (0-1) |
| `top_k` | integer | No | Top-k sampling parameter |
| `stop_sequences` | array | No | Sequences that stop generation |
| `stream` | boolean | No | Enable streaming responses (default: false) |
| `metadata` | object | No | Metadata for request tracking |
| `system` | string/array | No | System prompt |
| `thinking` | object | No | Extended thinking configuration |
| `tools` | array | No | Available tools for the model |
| `tool_choice` | object | No | Tool selection strategy |

**Response (Non-streaming):**

```json
{
  "id": "msg_01XYZ123",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you today?"
    }
  ],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 15,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

**Response (Streaming):**

Server-sent events (SSE) format:

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_01XYZ123","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514"}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

**Example (Non-streaming):**

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {
        "role": "user",
        "content": "What is the capital of France?"
      }
    ],
    "max_tokens": 100
  }'
```

**Example (Streaming):**

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {
        "role": "user",
        "content": "Tell me a story"
      }
    ],
    "max_tokens": 1024,
    "stream": true
  }'
```

**Status Codes:**

- `200 OK` - Request successful
- `400 Bad Request` - Invalid request format
- `401 Unauthorized` - Invalid or missing API key
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service temporarily unavailable

---

### GET /v1/models

List available Claude models.

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-opus-4-20250514",
      "object": "model",
      "created": 1715644800,
      "owned_by": "anthropic"
    },
    {
      "id": "claude-sonnet-4-20250514",
      "object": "model",
      "created": 1715644800,
      "owned_by": "anthropic"
    },
    {
      "id": "claude-haiku-4-20250514",
      "object": "model",
      "created": 1715644800,
      "owned_by": "anthropic"
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/v1/models \
  -H "x-api-key: YOUR_API_KEY"
```

---

### GET /health

Health check endpoint for liveness probes.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-05-02T10:16:58.211Z"
}
```

**Example:**

```bash
curl http://localhost:3000/health
```

---

### GET /ready

Readiness check endpoint that verifies all dependencies are available.

**Response:**

```json
{
  "status": "ready",
  "dependencies": {
    "redis": "connected",
    "qdrant": "connected",
    "voyage": "available",
    "anthropic": "available"
  },
  "timestamp": "2026-05-02T10:16:58.211Z"
}
```

**Example:**

```bash
curl http://localhost:3000/ready
```

---

### GET /metrics

Prometheus-compatible metrics endpoint.

**Response Format:** `text/plain; version=0.0.4`

**Metrics Exposed:**

- `claudeflow_requests_total` - Total number of requests (counter)
- `claudeflow_request_duration_seconds` - Request duration histogram
- `claudeflow_cache_hit_rate` - Cache hit rate (gauge)
- `claudeflow_deduplication_rate` - Semantic deduplication rate (gauge)
- `claudeflow_optimization_savings_dollars` - Cost savings from optimizations (gauge)
- `claudeflow_total_cost_dollars` - Total cost in dollars (gauge)
- `claudeflow_tokens_total` - Total tokens processed by type (counter)
- `claudeflow_error_rate` - Error rate (gauge)
- `claudeflow_kiro_account_usage_percent` - Percentage of requests using Kiro accounts (gauge)
- `claudeflow_errors_by_type_total` - Errors by type (counter)

**Example:**

```bash
curl http://localhost:3000/metrics
```

**Example Response:**

```
# HELP claudeflow_requests_total Total number of requests
# TYPE claudeflow_requests_total counter
claudeflow_requests_total{status="success"} 1250
claudeflow_requests_total{status="error"} 15
claudeflow_requests_total{account_type="kiro"} 800
claudeflow_requests_total{account_type="anthropic"} 465

# HELP claudeflow_request_duration_seconds Request duration in seconds
# TYPE claudeflow_request_duration_seconds histogram
claudeflow_request_duration_seconds{quantile="0.5"} 1.234
claudeflow_request_duration_seconds{quantile="0.95"} 3.456
claudeflow_request_duration_seconds{quantile="0.99"} 5.678
claudeflow_request_duration_seconds_sum 1567.89
claudeflow_request_duration_seconds_count 1265

# HELP claudeflow_cache_hit_rate Cache hit rate (0-1)
# TYPE claudeflow_cache_hit_rate gauge
claudeflow_cache_hit_rate 0.92

# HELP claudeflow_kiro_account_usage_percent Percentage of requests using Kiro accounts
# TYPE claudeflow_kiro_account_usage_percent gauge
claudeflow_kiro_account_usage_percent 63.2
```

---

### GET /admin/analytics

Get aggregated analytics metrics and insights.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `startTime` | ISO 8601 | Start of time range (default: 24 hours ago) |
| `endTime` | ISO 8601 | End of time range (default: now) |
| `model` | string | Filter by model ID |
| `complexity` | string | Filter by complexity (simple/moderate/complex) |
| `accountType` | string | Filter by account type (kiro/anthropic) |

**Response:**

```json
{
  "metrics": {
    "totalRequests": 1265,
    "successfulRequests": 1250,
    "failedRequests": 15,
    "totalInputTokens": 1250000,
    "totalOutputTokens": 625000,
    "totalCacheCreationTokens": 50000,
    "totalCacheReadTokens": 200000,
    "totalThinkingTokens": 15000,
    "totalCost": 45.50,
    "costSavings": 28.75,
    "averageResponseTime": 1234,
    "p50ResponseTime": 1100,
    "p95ResponseTime": 2500,
    "p99ResponseTime": 4000,
    "cacheHitRate": 0.92,
    "deduplicationRate": 0.15,
    "kiroRequests": 800,
    "anthropicRequests": 465,
    "kiroPercentage": 63.2,
    "errorRate": 0.012,
    "errorsByType": {
      "rate_limit": 10,
      "timeout": 5
    },
    "startTime": "2026-05-01T10:16:58.211Z",
    "endTime": "2026-05-02T10:16:58.211Z"
  },
  "insights": [
    {
      "type": "cost_optimization",
      "severity": "info",
      "title": "Excellent Cache Performance",
      "message": "Cache hit rate is 92.0%, exceeding target of 90%",
      "recommendation": "Cache optimization is working excellently. Continue current strategy.",
      "impact": "Estimated savings: $28.75",
      "metrics": {
        "cacheHitRate": 0.92,
        "costSavings": 28.75
      }
    }
  ],
  "filter": {
    "startTime": "2026-05-01T10:16:58.211Z",
    "endTime": "2026-05-02T10:16:58.211Z",
    "model": null,
    "complexity": null,
    "accountType": null
  }
}
```

**Example:**

```bash
# Get analytics for last 24 hours
curl http://localhost:3000/admin/analytics \
  -H "x-api-key: YOUR_API_KEY"

# Get analytics for specific time range
curl "http://localhost:3000/admin/analytics?startTime=2026-05-01T00:00:00Z&endTime=2026-05-02T00:00:00Z" \
  -H "x-api-key: YOUR_API_KEY"

# Get analytics filtered by model
curl "http://localhost:3000/admin/analytics?model=claude-sonnet-4-20250514" \
  -H "x-api-key: YOUR_API_KEY"

# Get analytics for Kiro accounts only
curl "http://localhost:3000/admin/analytics?accountType=kiro" \
  -H "x-api-key: YOUR_API_KEY"
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "type": "error_type",
    "message": "Human-readable error message"
  }
}
```

**Error Types:**

- `invalid_request_error` - Request validation failed
- `authentication_error` - Invalid or missing API key
- `rate_limit_error` - Rate limit exceeded
- `service_unavailable_error` - Service temporarily unavailable
- `api_error` - Internal server error
- `not_found_error` - Resource not found

**Example Error Response:**

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "Missing required field: messages"
  }
}
```

---

## Rate Limiting

ClaudeFlow implements intelligent rate limiting based on account quotas:

- Requests are automatically distributed across available accounts
- Rate limit errors (429) trigger automatic retry with exponential backoff
- Kiro accounts are prioritized for cost efficiency

**Rate Limit Headers:**

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1715644800
```

---

## Optimizations

ClaudeFlow automatically applies several optimizations:

### 1. Semantic Deduplication

Similar requests are detected using semantic similarity (>95%) and cached responses are returned instantly.

### 2. Prompt Caching

Cache control markers are automatically inserted at optimal points:
- After system prompts
- After large context blocks (>2000 tokens)
- At conversation boundaries (every 5 messages)

### 3. Thinking Budget Optimization

Extended thinking budgets are automatically set based on request complexity:
- Simple requests: 0 tokens
- Moderate requests: 2000 tokens
- Complex requests: 10000 tokens

### 4. Context Compression

Large conversations (>8000 tokens) are automatically compressed:
- Recent 3 messages preserved
- Older messages summarized using Claude Haiku

### 5. Kiro Account Routing

Free Kiro accounts are prioritized for cost reduction:
- Automatic session management
- Round-robin load balancing
- Fallback to paid accounts when needed

---

## Best Practices

### 1. Use Streaming for Long Responses

```javascript
const response = await fetch('http://localhost:3000/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'YOUR_API_KEY'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'Tell me a long story' }],
    max_tokens: 4096,
    stream: true
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      console.log(data);
    }
  }
}
```

### 2. Handle Errors Gracefully

```javascript
try {
  const response = await fetch('http://localhost:3000/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'YOUR_API_KEY'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('API Error:', error.error.type, error.error.message);
    
    if (error.error.type === 'rate_limit_error') {
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 5000));
      // Retry request...
    }
  }

  const data = await response.json();
  console.log(data);
} catch (error) {
  console.error('Network error:', error);
}
```

### 3. Monitor Performance

Use the `/admin/analytics` endpoint to monitor:
- Cost savings from optimizations
- Cache hit rates
- Kiro account usage
- Error rates

```bash
# Check daily analytics
curl "http://localhost:3000/admin/analytics?startTime=$(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)" \
  -H "x-api-key: YOUR_API_KEY" | jq '.metrics.costSavings'
```

---

## SDK Examples

### Node.js

```javascript
const ClaudeFlow = require('@anthropic-ai/sdk');

const client = new ClaudeFlow({
  apiKey: 'YOUR_API_KEY',
  baseURL: 'http://localhost:3000'
});

async function chat() {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: 'Hello, Claude!' }
    ]
  });
  
  console.log(message.content[0].text);
}

chat();
```

### Python

```python
from anthropic import Anthropic

client = Anthropic(
    api_key="YOUR_API_KEY",
    base_url="http://localhost:3000"
)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, Claude!"}
    ]
)

print(message.content[0].text)
```

### cURL

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "Hello, Claude!"}
    ],
    "max_tokens": 1024
  }'
```

---

## Compatibility

ClaudeFlow maintains 100% compatibility with the Anthropic API:

- All request parameters supported
- All response fields preserved
- Streaming format identical
- Error responses match Anthropic format

You can use ClaudeFlow as a drop-in replacement by simply changing the base URL.

---

## Support

For issues or questions:
- GitHub Issues: [github.com/your-org/claudeflow/issues](https://github.com/your-org/claudeflow/issues)
- Documentation: [github.com/your-org/claudeflow/docs](https://github.com/your-org/claudeflow/docs)
