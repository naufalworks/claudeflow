# Quick Start

Get ClaudeFlow running locally in under 5 minutes.

## 1. Install

```bash
npm install
cd web && npm install && cd ..
```

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your setup:

| Variable | Required | Purpose |
|----------|----------|---------|
| `CLAUDEFLOW_API_KEYS` | Yes | API authentication keys |
| `REDIS_URL` | Yes | Redis connection for routing and quota state |
| `QDRANT_URL` | No | Qdrant for semantic deduplication |
| `VOYAGE_API_KEY` | No | Voyage embeddings (needed if Qdrant enabled) |

## 3. Start

```bash
npm run dev
```

| Service | URL |
|---------|-----|
| API | `http://localhost:20129` |
| Dashboard | `http://localhost:3001` |

## 4. Verify

```bash
curl http://localhost:20129/health
```

## 5. Add Accounts

**Direct Anthropic key:**
```bash
claudeflow account add
```

**Kiro OAuth:**
```bash
claudeflow login --method builder-id --region us-east-1
claudeflow account list
```

## 6. Connect Your Client

Point any Anthropic SDK at `http://localhost:20129`:

```python
import anthropic

client = anthropic.Anthropic(
    api_key="your-claudeflow-api-key",
    base_url="http://localhost:20129",
)
```

## Optional: MITM Mode

For transparent Kiro CLI/IDE traffic interception:

```bash
sudo claudeflow mitm install
sudo claudeflow daemon start --mitm
```

> MITM mode modifies local certificate trust and host routing. Use only on machines you control.

## Common Commands

```bash
npm run build              # Build everything
npm run build:api          # Compile TypeScript only
npm test                   # Run tests
claudeflow daemon status   # Check daemon
claudeflow logs -f         # Stream logs
claudeflow health check    # Check infrastructure
```

---

Next: [Feature Reference](FEATURES.md) · [Full Docs](docs/README.md)
