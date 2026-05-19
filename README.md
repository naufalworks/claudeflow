# ClaudeFlow

ClaudeFlow is an Anthropic-compatible routing service for Claude requests. It keeps the native Anthropic request and response format end to end while adding account pooling, Kiro OAuth support, quota-aware routing, caching, analytics, and a web dashboard.

The project is split into two applications:

- API and CLI service: TypeScript, Fastify, Redis, Qdrant, OS keychain storage.
- Web dashboard: Next.js app under `web/`.

## Core Capabilities

- Native Anthropic `/v1/messages` compatibility.
- Direct Anthropic API key routing.
- Kiro OAuth account routing with automatic token refresh.
- Live Kiro credit quota refresh via CodeWhisperer usage endpoints.
- Redis-backed quota and routing state.
- Semantic request deduplication through Qdrant and Voyage embeddings.
- Dashboard API for accounts, analytics, activity, and health.
- Optional MITM mode for advanced Kiro CLI/IDE interception.

## Requirements

- Node.js 18 or newer.
- npm.
- Redis for runtime state.
- Qdrant for semantic cache features.
- Voyage API key if semantic deduplication is enabled.
- OpenSSL and elevated privileges only when using MITM mode.

## Quick Start

```bash
npm install
cd web && npm install && cd ..
cp .env.example .env
npm run dev
```

Default local endpoints:

- API: `http://localhost:20129`
- Web dashboard: `http://localhost:3001`

## API Usage

Point an Anthropic SDK client at the ClaudeFlow API server:

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

ClaudeFlow expects native Anthropic format. Proxies that convert to OpenAI-compatible responses are not supported.

## Development Commands

```bash
npm run dev          # API + web dashboard
npm run dev:api      # API only
npm run dev:web      # web dashboard only
npm run build:api    # compile API/CLI
npm run build:web    # build web dashboard
npm run build        # API + web
npm test             # Jest test suite
```

## Repository Layout

```text
src/
  accounts/          Account pool, quota, health, token refresh helpers
  auth/              Kiro OAuth, keychain storage, JWT validation
  clients/           Anthropic, proxy, OAuth, Kiro API clients
  config/            Runtime configuration schema and manager
  infrastructure/    Redis, Qdrant, Anthropic infrastructure wrappers
  mitm/              Optional MITM proxy implementation
  optimizers/        Cache, context, request classification, thinking budget
  parsers/           Anthropic request/response parsing and formatting
  server/            Fastify routes and server bootstrap
  streaming/         SSE streaming helpers
  tracking/          Analytics and usage tracking
web/                 Next.js dashboard
docs/                Maintained documentation
scripts/             Utility scripts
```

## Documentation

- [Documentation index](docs/README.md)
- [API reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Configuration](docs/CONFIGURATION.md)
- [CLI](docs/CLI.md)
- [Deployment](docs/DEPLOYMENT.md)
- [MITM proxy](docs/MITM_PROXY.md)
- [Developer guide](docs/DEVELOPER.md)
- [Migration guide](docs/MIGRATION.md)

## Configuration

Start from `.env.example`, then configure one or more account providers:

- Direct Anthropic API keys.
- Anthropic-compatible proxies that preserve native Anthropic format.
- Kiro OAuth accounts managed by the CLI/device flow.

Local config can also be stored in `config.json` or the path specified by `CONFIG_PATH`.

## Security Notes

- Do not commit `.env`, `config.json`, access tokens, refresh tokens, or API keys.
- Kiro OAuth credentials are stored through the OS keychain when available, with encrypted file fallback.
- MITM mode modifies local trust and host routing; use it only on machines you control.

## Current Verification

For the Kiro quota/token-refresh work, the current focused checks are:

```bash
npm run build:api
npx jest src/auth/__tests__/dual-auth-mode-handler.test.ts src/auth/__tests__/token-manager-refresh.test.ts src/accounts/__tests__/account-pool-manager.test.ts --runInBand
```

The full Jest suite currently includes unrelated failures in older CLI, analytics, health, and classifier tests. Stabilize those suites before tagging a release.
