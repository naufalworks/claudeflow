# ClaudeFlow — Feature Reference

Complete breakdown of all ClaudeFlow capabilities.

---

## API Compatibility

- Native Anthropic `/v1/messages` format — no OpenAI conversion
- Drop-in replacement for official Anthropic SDKs (Python, Node.js, etc.)
- Full streaming support via server-sent events (SSE)
- All parameters supported (tools, system prompts, extended thinking, etc.)
- Response format validation — rejects non-Anthropic responses from proxies

## Multi-Account Management

- Pool multiple Anthropic API keys, proxy accounts, and Kiro OAuth accounts
- Round-robin and sticky round-robin load balancing
- Automatic health monitoring and error rate tracking per account
- Real-time quota tracking and enforcement
- Priority-based account selection
- Automatic failover to healthy accounts on errors

## Kiro OAuth Integration

- OAuth 2.0 device code authentication flow
- Background token refresh before expiry
- Live credit quota monitoring via CodeWhisperer API
- OS keychain credential storage with encrypted file fallback
- MITM proxy support for Kiro CLI/IDE traffic interception

## Request Optimization

**Semantic Deduplication**
- Vector similarity matching via Qdrant + Voyage embeddings
- 95% similarity threshold for near-duplicate detection
- Instant cache hits without API calls
- ~30–40% reduction in duplicate API calls

**Prompt Caching**
- Automatic `cache_control` marker insertion at optimal points
- Targets 1024+ token blocks (system prompts, context, tool definitions)
- ~90% cost reduction on cached input tokens
- Uses Anthropic's native prompt caching

**Thinking Budget Optimization**
- Classifies requests as simple / moderate / complex
- Dynamic token budgets: simple → 0, moderate → 2K, complex → 10K
- ~50% reduction in thinking token costs

**Context Compression**
- Compresses conversations exceeding 8000 tokens
- Preserves recent messages and tool use/results
- Summarizes older context via Claude Haiku
- ~70% reduction in context tokens

## Web Dashboard

- Real-time metrics and usage statistics
- Account status cards with health indicators and quota gauges
- Cost savings, cache hit rates, token usage charts
- Live request activity stream with filtering
- Configuration and account management UI
- Keyboard shortcuts and command palette

## CLI

```
claudeflow daemon start|stop|restart    # Background daemon
claudeflow daemon status                # Check status
claudeflow account add|list|show|remove # Account management
claudeflow account refresh              # Force session refresh
claudeflow login --method builder-id    # Kiro OAuth login
claudeflow health check                 # Infrastructure health
claudeflow logs -f                      # Stream logs
claudeflow config show|edit             # Configuration
claudeflow combo create|list            # Account combos
claudeflow backup|restore               # Backup management
claudeflow mitm install                 # MITM proxy setup
```

## Security

- Bearer token API authentication
- Rate limiting (100 req/min default, localhost exempt)
- CORS with credentials support
- OS keychain integration (macOS, Windows, Linux)
- AES-256 encrypted file fallback for credentials

## Monitoring

- Structured logging via Pino with pretty printing
- Health checks for Redis, Qdrant, and Anthropic API
- WebSocket server for real-time dashboard updates (port 3130)
- Request/response logging with performance metrics

## Infrastructure

| Component | Purpose |
|-----------|---------|
| Redis | Quota state, routing, caching, sessions |
| Qdrant | Vector similarity for semantic deduplication |
| Voyage AI | Embeddings for request matching |
| OS Keychain | Secure credential storage |
| PM2 | Process management for daemon mode |

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥ 18, TypeScript, ESM |
| Server | Fastify 5 |
| Database | Redis, Qdrant |
| Dashboard | Next.js, React, TailwindCSS |
| CLI | Commander.js, Blessed (TUI) |
| Testing | Jest, ts-jest |
| Linting | ESLint, Prettier |

## Deployment

- Direct (`node dist/index.js`)
- PM2 daemon (`claudeflow daemon start`)
- Docker / Kubernetes
- Systemd service

---

*See [docs/](docs/) for detailed guides on each area.*
