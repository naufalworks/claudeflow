# Quick Start

This guide starts the local API and web dashboard.

## 1. Install Dependencies

```bash
npm install
cd web && npm install && cd ..
```

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with the services and credentials you need:

- `CLAUDEFLOW_API_KEYS` for dashboard/API authentication.
- `REDIS_URL` for routing and quota state.
- `QDRANT_URL` for semantic cache storage.
- `VOYAGE_API_KEY` if semantic deduplication is enabled.
- Anthropic, proxy, or Kiro account settings.

## 3. Start Development Servers

```bash
npm run dev
```

Default endpoints:

- API: `http://localhost:20129`
- Web dashboard: `http://localhost:3001`

## 4. Verify API Routing

```bash
curl http://localhost:20129/health
```

For Anthropic-compatible clients, set the base URL to `http://localhost:20129`.

## 5. Optional Kiro OAuth Setup

Use the CLI login flow for Kiro accounts:

```bash
claudeflow login --method builder-id --region us-east-1
claudeflow account list
```

ClaudeFlow stores tokens securely and refreshes access tokens before expiry.

## 6. Optional MITM Mode

MITM mode is only needed when you want local Kiro CLI/IDE traffic intercepted transparently.

```bash
sudo claudeflow mitm install
sudo claudeflow daemon start --mitm
```

MITM mode modifies local certificate trust and host routing. Use it only on machines you control.

## Useful Commands

```bash
npm run build:api
npm run build:web
npm test
claudeflow daemon status
claudeflow logs -f
claudeflow account list
```

See [docs/README.md](docs/README.md) for the full documentation index.
