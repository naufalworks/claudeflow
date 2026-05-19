# ClaudeFlow

Intelligent API router for Anthropic's Claude models. Drop-in proxy that adds multi-account pooling, request optimization, caching, and a real-time dashboard — while preserving native Anthropic `/v1/messages` format end to end.

## Features

- **Multi-account routing** — pool Anthropic API keys, proxy accounts, and Kiro OAuth accounts with round-robin load balancing, quota tracking, and automatic failover
- **Request optimization** — semantic deduplication (Qdrant + Voyage), prompt caching markers, thinking budget classification, context compression
- **Kiro OAuth** — device-code login, automatic token refresh, credit quota monitoring
- **Streaming** — full SSE passthrough with optimization
- **Web dashboard** — real-time analytics, account management, activity monitoring (Next.js)
- **CLI** — daemon management, account CRUD, config, logs, health checks, MITM setup
- **Security** — Bearer token auth, OS keychain credential storage, rate limiting, CORS

See [FEATURES.md](FEATURES.md) for the complete feature breakdown.

## Requirements

- Node.js ≥ 18
- Redis — quota, routing state, caching
- Qdrant — semantic deduplication (optional)
- Voyage API key — embeddings for deduplication (optional)

## Quick Start

```bash
npm install
cd web && npm install && cd ..
cp .env.example .env
npm run dev
```

Default endpoints:

| Service | URL |
|---------|-----|
| API | `http://localhost:20129` |
| Dashboard | `http://localhost:3001` |

See [QUICK_START.md](QUICK_START.md) for the full setup walkthrough.

## API Usage

Point any Anthropic SDK at ClaudeFlow:

```python
import anthropic

client = anthropic.Anthropic(
    api_key="your-claudeflow-api-key",
    base_url="http://localhost:20129",
)

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

ClaudeFlow expects native Anthropic format. OpenAI-compatible proxies are not supported.

## CLI

```bash
claudeflow daemon start          # Start background daemon
claudeflow daemon status         # Check daemon status
claudeflow account add           # Add an account interactively
claudeflow account list          # List all accounts
claudeflow login --method builder-id --region us-east-1  # Kiro OAuth
claudeflow health check          # Infrastructure health check
claudeflow logs -f               # Stream logs
claudeflow config show           # View configuration
```

## Repository Layout

```
src/
  accounts/        Account pool, quota, health, token refresh
  auth/            OAuth, keychain storage, JWT validation
  clients/         Anthropic, proxy, OAuth, Kiro API clients
  config/          Configuration schema and manager
  infrastructure/  Redis, Qdrant wrappers
  mitm/            Optional MITM proxy
  optimizers/      Cache, context, classification, thinking budget
  parsers/         Request/response parsing and formatting
  server/          Fastify routes and server bootstrap
  streaming/       SSE streaming helpers
  tracking/        Analytics and usage tracking
  cli/             CLI commands and daemon management
web/               Next.js dashboard
docs/              Documentation
scripts/           Utility scripts
```

## Development

```bash
npm run dev          # API + dashboard (hot reload)
npm run dev:api      # API only
npm run dev:web      # Dashboard only
npm run build        # Build API + dashboard
npm run build:api    # Compile TypeScript
npm run build:web    # Build Next.js
npm test             # Run test suite
npm run lint         # Lint source
npm run format       # Format source
```

## Documentation

- [Quick Start](QUICK_START.md)
- [Feature List](FEATURES.md)
- [API Reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Configuration](docs/CONFIGURATION.md)
- [CLI Reference](docs/CLI.md)
- [Deployment](docs/DEPLOYMENT.md)
- [MITM Proxy](docs/MITM_PROXY.md)
- [Developer Guide](docs/DEVELOPER.md)
- [Migration Guide](docs/MIGRATION.md)

## Configuration

Start from `.env.example`, then configure accounts via CLI or `config.json`:

- Direct Anthropic API keys
- Anthropic-compatible proxies (native format only)
- Kiro OAuth accounts via `claudeflow login`

## Security

- Never commit `.env`, `config.json`, or API keys
- OAuth tokens stored in OS keychain with encrypted file fallback
- MITM mode modifies local certificate trust — use only on controlled machines

## License

MIT
