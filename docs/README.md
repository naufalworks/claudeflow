# Documentation

This directory contains maintained documentation for ClaudeFlow.

## Start Here

- [Quick start](../QUICK_START.md): local setup and first run.
- [Configuration](CONFIGURATION.md): account, service, and runtime settings.
- [Authentication](AUTHENTICATION.md): API keys, dashboard access, and protected endpoints.
- [API reference](API.md): `/v1/messages`, dashboard endpoints, metrics, and examples.

## Architecture And Operations

- [Architecture](ARCHITECTURE.md): system design, routing pipeline, account model, and infrastructure.
- [Deployment](DEPLOYMENT.md): production deployment patterns.
- [Developer guide](DEVELOPER.md): local development, testing, internals, and extension points.
- [CLI guide](CLI.md): command reference for daemon, account, quota, health, and analytics operations.

## Kiro And Proxy Modes

- [Native Anthropic format](ANTHROPIC_FORMAT_ONLY.md): format guarantees and unsupported proxy behavior.
- [MITM proxy](MITM_PROXY.md): local interception mode for Kiro CLI/IDE traffic.
- [Migration](MIGRATION.md): migration notes for older OAuth or proxy-based setups.

## Repository Structure

```text
src/
  accounts/          Account pool selection, quota tracking, circuit breakers
  analytics/         Metrics aggregation
  auth/              Kiro OAuth, token refresh, keychain storage
  clients/           Provider-specific HTTP clients
  config/            Runtime configuration schema and loading
  infrastructure/    Redis, Qdrant, Anthropic wrappers
  mitm/              Optional MITM proxy support
  optimizers/        Request/cache/context optimization
  parsers/           Anthropic request/response parsing
  server/            Fastify server and route handlers
  streaming/         SSE streaming support
  tracking/          Usage and quota management
web/                 Next.js dashboard
scripts/             Local utility scripts
docs/archive/        Local reports and generated implementation notes
```

## Documentation Standards

- Keep `README.md` short and user-facing.
- Put long-form implementation details under `docs/`.
- Keep temporary reports under `docs/archive/` and out of commits.
- Do not document secrets, tokens, local machine paths, or private service credentials.
