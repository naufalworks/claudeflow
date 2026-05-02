# ClaudeFlow Deployment Guide

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Infrastructure Requirements](#infrastructure-requirements)
4. [Configuration](#configuration)
5. [Single Instance Deployment](#single-instance-deployment)
6. [Multi-Instance Deployment](#multi-instance-deployment)
7. [Docker Deployment](#docker-deployment)
8. [Kiro Account Setup](#kiro-account-setup)
9. [Monitoring and Health Checks](#monitoring-and-health-checks)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

- **Node.js**: 18.x or later
- **npm**: 9.x or later
- **Memory**: Minimum 2GB RAM (4GB recommended)
- **CPU**: 2+ cores recommended
- **Disk**: 10GB available space
- **OS**: Linux, macOS, or Windows with WSL2

### Required Services

- **Qdrant**: Vector database for semantic search
- **Redis**: In-memory cache for fast data retrieval
- **Voyage AI**: API access for embedding generation
- **Anthropic API**: API keys for Claude models (optional if using only Kiro accounts)
- **Kiro MITM Router**: For free Kiro account access (optional)

---

## Environment Setup

### 1. Install Node.js

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**macOS:**
```bash
brew install node@18
```

**Verify installation:**
```bash
node --version  # Should be v18.x or later
npm --version   # Should be 9.x or later
```

### 2. Clone Repository

```bash
git clone https://github.com/your-org/claudeflow.git
cd claudeflow
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Build Project

```bash
npm run build
```

---

## Infrastructure Requirements

### Qdrant Setup

**Option 1: Docker (Recommended for Development)**
```bash
docker run -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage:z \
  qdrant/qdrant
```

**Option 2: Native Installation**
```bash
# Download and install Qdrant
wget https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-unknown-linux-gnu.tar.gz
tar -xzf qdrant-x86_64-unknown-linux-gnu.tar.gz
./qdrant
```

**Verify Qdrant:**
```bash
curl http://localhost:6333/collections
```

### Redis Setup

**Option 1: Docker (Recommended for Development)**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Option 2: Native Installation**

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Verify Redis:**
```bash
redis-cli ping  # Should return "PONG"
```

### Voyage AI Setup

1. Sign up at [Voyage AI](https://www.voyageai.com/)
2. Generate an API key
3. Set the API key in your environment variables

### Anthropic API Setup

1. Sign up at [Anthropic Console](https://console.anthropic.com/)
2. Generate API keys for your accounts
3. Set the API keys in your configuration

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Server Configuration
PORT=20129
HOST=0.0.0.0
NODE_ENV=production

# Infrastructure
QDRANT_URL=http://localhost:6333
REDIS_URL=redis://localhost:6379
VOYAGE_API_KEY=your_voyage_api_key_here

# Anthropic Accounts (Optional if using only Kiro)
ANTHROPIC_API_KEY_1=sk-ant-api03-...
ANTHROPIC_API_KEY_2=sk-ant-api03-...

# Kiro OAuth Configuration (Optional)
KIRO_MITM_ROUTER_URL=http://3.68.219.151:20128
KIRO_ACCOUNT_1_MACHINE_ID=your_machine_id_here
KIRO_ACCOUNT_1_API_KEY=sk-ant-api03-...
KIRO_ACCOUNT_2_MACHINE_ID=your_machine_id_here
KIRO_ACCOUNT_2_API_KEY=sk-ant-api03-...

# Logging
LOG_LEVEL=info

# Configuration File
CONFIG_PATH=./config.json
```

### Configuration File

Create `config.json` in the project root:

```json
{
  "server": {
    "port": 20129,
    "host": "0.0.0.0",
    "cors": {
      "enabled": true,
      "origins": ["*"]
    }
  },
  "optimization": {
    "semanticDeduplication": {
      "enabled": true,
      "similarityThreshold": 0.95
    },
    "promptCaching": {
      "enabled": true,
      "minTokens": 1024
    },
    "thinkingBudget": {
      "enabled": true,
      "simple": 0,
      "moderate": 2000,
      "complex": 10000
    },
    "contextCompression": {
      "enabled": true,
      "minTokens": 8000,
      "preserveRecentMessages": 3
    }
  },
  "accounts": [
    {
      "id": "anthropic-1",
      "provider": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY_1}",
      "quota": {
        "requestsPerMinute": 50,
        "tokensPerDay": 1000000
      }
    },
    {
      "id": "anthropic-2",
      "provider": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY_2}",
      "quota": {
        "requestsPerMinute": 50,
        "tokensPerDay": 1000000
      }
    }
  ],
  "kiroAccounts": [
    {
      "id": "kiro-1",
      "machineId": "${KIRO_ACCOUNT_1_MACHINE_ID}",
      "apiKey": "${KIRO_ACCOUNT_1_API_KEY}",
      "mitmRouterUrl": "${KIRO_MITM_ROUTER_URL}",
      "combo": "free-pool"
    },
    {
      "id": "kiro-2",
      "machineId": "${KIRO_ACCOUNT_2_MACHINE_ID}",
      "apiKey": "${KIRO_ACCOUNT_2_API_KEY}",
      "mitmRouterUrl": "${KIRO_MITM_ROUTER_URL}",
      "combo": "free-pool"
    }
  ],
  "kiroCombos": [
    {
      "name": "free-pool",
      "accounts": ["kiro-1", "kiro-2"],
      "strategy": "round-robin"
    }
  ],
  "infrastructure": {
    "qdrant": {
      "url": "${QDRANT_URL}",
      "collection": "claudeflow_prompts",
      "timeout": 5000
    },
    "redis": {
      "url": "${REDIS_URL}",
      "ttl": 86400,
      "keyPrefix": "claudeflow:"
    },
    "voyageAI": {
      "apiKey": "${VOYAGE_API_KEY}",
      "model": "voyage-2",
      "timeout": 10000
    }
  },
  "analytics": {
    "enabled": true,
    "retentionDays": 7
  }
}
```

---

## Single Instance Deployment

### Development Mode

```bash
# Start in development mode with hot reload
npm run dev
```

### Production Mode

```bash
# Build the project
npm run build

# Start the server
npm start
```

### Using PM2 (Recommended for Production)

```bash
# Install PM2 globally
npm install -g pm2

# Start ClaudeFlow with PM2
pm2 start dist/index.js --name claudeflow

# Save PM2 configuration
pm2 save

# Set up PM2 to start on system boot
pm2 startup
```

### Verify Deployment

```bash
# Check health endpoint
curl http://localhost:20129/health

# Check readiness endpoint
curl http://localhost:20129/ready

# Test a simple request
curl -X POST http://localhost:20129/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [
      {"role": "user", "content": "Hello, Claude!"}
    ]
  }'
```

---

## Multi-Instance Deployment

### Architecture

```
┌─────────────────────────────────────┐
│    Load Balancer (Nginx/HAProxy)    │
│           Port 20129                 │
└─────────────────────────────────────┘
         │              │
         ↓              ↓
┌──────────────┐  ┌──────────────┐
│ ClaudeFlow 1 │  │ ClaudeFlow 2 │
│  Port 20130  │  │  Port 20131  │
└──────────────┘  └──────────────┘
         │              │
         └──────┬───────┘
                ↓
    ┌───────────────────────┐
    │  Shared Infrastructure│
    │  • Qdrant             │
    │  • Redis              │
    │  • Voyage AI          │
    └───────────────────────┘
```

### Nginx Configuration

Create `/etc/nginx/sites-available/claudeflow`:

```nginx
upstream claudeflow_backend {
    least_conn;
    server localhost:20130 max_fails=3 fail_timeout=30s;
    server localhost:20131 max_fails=3 fail_timeout=30s;
}

server {
    listen 20129;
    server_name _;

    # Increase timeouts for streaming responses
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;

    location / {
        proxy_pass http://claudeflow_backend;
        proxy_http_version 1.1;
        
        # Headers for streaming
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Disable buffering for streaming
        proxy_buffering off;
        proxy_cache off;
    }

    location /health {
        proxy_pass http://claudeflow_backend;
        access_log off;
    }
}
```

Enable the configuration:

```bash
sudo ln -s /etc/nginx/sites-available/claudeflow /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Start Multiple Instances

**Instance 1:**
```bash
PORT=20130 pm2 start dist/index.js --name claudeflow-1
```

**Instance 2:**
```bash
PORT=20131 pm2 start dist/index.js --name claudeflow-2
```

### Verify Load Balancing

```bash
# Make multiple requests and check which instance handles them
for i in {1..10}; do
  curl -s http://localhost:20129/health | jq .instance
done
```

---

## Docker Deployment

### Dockerfile

Create `Dockerfile` in the project root:

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 20129

CMD ["node", "dist/index.js"]
```

### Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  claudeflow:
    build: .
    ports:
      - "20129:20129"
    environment:
      - NODE_ENV=production
      - PORT=20129
      - QDRANT_URL=http://qdrant:6333
      - REDIS_URL=redis://redis:6379
      - VOYAGE_API_KEY=${VOYAGE_API_KEY}
      - ANTHROPIC_API_KEY_1=${ANTHROPIC_API_KEY_1}
      - KIRO_MITM_ROUTER_URL=${KIRO_MITM_ROUTER_URL}
      - KIRO_ACCOUNT_1_MACHINE_ID=${KIRO_ACCOUNT_1_MACHINE_ID}
      - KIRO_ACCOUNT_1_API_KEY=${KIRO_ACCOUNT_1_API_KEY}
    depends_on:
      - qdrant
      - redis
    restart: unless-stopped
    volumes:
      - ./config.json:/app/config.json:ro

  qdrant:
    image: qdrant/qdrant:v1.7.4
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_storage:/qdrant/storage
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
    command: redis-server --appendonly yes

volumes:
  qdrant_storage:
  redis_data:
```

### Build and Run

```bash
# Build the Docker image
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f claudeflow

# Stop all services
docker-compose down
```

### Docker Compose with Multiple Instances

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "20129:20129"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - claudeflow-1
      - claudeflow-2
    restart: unless-stopped

  claudeflow-1:
    build: .
    environment:
      - NODE_ENV=production
      - PORT=20129
      - QDRANT_URL=http://qdrant:6333
      - REDIS_URL=redis://redis:6379
      - VOYAGE_API_KEY=${VOYAGE_API_KEY}
      - ANTHROPIC_API_KEY_1=${ANTHROPIC_API_KEY_1}
    depends_on:
      - qdrant
      - redis
    restart: unless-stopped

  claudeflow-2:
    build: .
    environment:
      - NODE_ENV=production
      - PORT=20129
      - QDRANT_URL=http://qdrant:6333
      - REDIS_URL=redis://redis:6379
      - VOYAGE_API_KEY=${VOYAGE_API_KEY}
      - ANTHROPIC_API_KEY_2=${ANTHROPIC_API_KEY_2}
    depends_on:
      - qdrant
      - redis
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:v1.7.4
    volumes:
      - qdrant_storage:/qdrant/storage
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped
    command: redis-server --appendonly yes

volumes:
  qdrant_storage:
  redis_data:
```

---

## Kiro Account Setup

### Prerequisites

1. Access to Kiro MITM router at `http://3.68.219.151:20128`
2. Machine ID for each Kiro account
3. API keys (session tokens) for each account

### Configuration Steps

#### 1. Obtain Machine ID

Your machine ID is a unique identifier for your system. You can find it in your Kiro IDE settings or generate one:

```bash
# Generate a machine ID (example)
echo -n "your-unique-identifier" | sha256sum | cut -d' ' -f1
```

#### 2. Authenticate with Kiro

The first time you use a Kiro account, you'll need to authenticate via OAuth:

```bash
# This is typically handled by the Kiro IDE
# The MITM router will return a session token
curl -X POST http://3.68.219.151:20128/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "machineId": "your_machine_id_here"
  }'
```

#### 3. Configure Kiro Accounts

Add Kiro accounts to your `config.json`:

```json
{
  "kiroAccounts": [
    {
      "id": "kiro-account-1",
      "machineId": "3dee6bbab4fd4a736dad0528dee5bfcd59dc9ad5aac55ad621643ca74a822ac5",
      "apiKey": "sk-ant-api03-...",
      "mitmRouterUrl": "http://3.68.219.151:20128",
      "combo": "free-pool"
    },
    {
      "id": "kiro-account-2",
      "machineId": "abc123def456...",
      "apiKey": "sk-ant-api03-...",
      "mitmRouterUrl": "http://3.68.219.151:20128",
      "combo": "free-pool"
    }
  ],
  "kiroCombos": [
    {
      "name": "free-pool",
      "accounts": ["kiro-account-1", "kiro-account-2"],
      "strategy": "round-robin"
    }
  ]
}
```

#### 4. Test Kiro Account

```bash
curl -X POST http://localhost:20129/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [
      {"role": "user", "content": "Hello from Kiro!"}
    ]
  }'
```

### Kiro Account Strategies

**Round-Robin:**
- Distributes requests evenly across all accounts in the combo
- Best for load balancing
- No session affinity

**Sticky Round-Robin:**
- Routes requests from the same conversation to the same account
- Maintains session affinity
- Better for multi-turn conversations

### Session Management

ClaudeFlow automatically handles Kiro session management:

1. **Session Refresh**: Automatically refreshes sessions before expiration
2. **401 Handling**: Retries with refreshed session on 401 errors
3. **Account Rotation**: Rotates to next account if refresh fails
4. **Fallback**: Falls back to paid Anthropic accounts if all Kiro accounts fail

---

## Monitoring and Health Checks

### Health Endpoints

**Liveness Check:**
```bash
curl http://localhost:20129/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-05-02T10:19:07.107Z",
  "uptime": 3600
}
```

**Readiness Check:**
```bash
curl http://localhost:20129/ready
```

Response:
```json
{
  "status": "ready",
  "dependencies": {
    "qdrant": "ok",
    "redis": "ok",
    "voyageAI": "ok"
  }
}
```

### Prometheus Metrics

```bash
curl http://localhost:20129/metrics
```

Key metrics:
- `claudeflow_requests_total`: Total requests processed
- `claudeflow_request_duration_seconds`: Request latency histogram
- `claudeflow_cache_hit_rate`: Cache hit rate gauge
- `claudeflow_optimization_savings_dollars`: Cost savings gauge
- `claudeflow_account_quota_usage`: Quota usage per account
- `claudeflow_kiro_account_usage`: Kiro account usage counter
- `claudeflow_kiro_session_refreshes`: Session refresh counter

### Analytics Dashboard

```bash
curl http://localhost:20129/admin/analytics?timeRange=24h
```

Response:
```json
{
  "totalRequests": 1500,
  "totalCost": 12.50,
  "cacheHitRate": 0.92,
  "deduplicationRate": 0.35,
  "avgResponseTime": 1850,
  "errorRate": 0.02,
  "insights": [
    {
      "type": "cost_optimization",
      "severity": "info",
      "message": "60% of costs on simple tasks",
      "recommendation": "Consider using Claude Haiku for simple requests"
    }
  ]
}
```

### Logging

ClaudeFlow uses structured JSON logging:

```json
{
  "timestamp": "2026-05-02T10:19:07.107Z",
  "level": "info",
  "requestId": "req_abc123",
  "conversationId": "conv_xyz789",
  "event": "request_completed",
  "duration": 1850,
  "model": "claude-sonnet-4-20250514",
  "accountType": "kiro",
  "optimization": {
    "cacheHit": false,
    "deduplicationHit": false,
    "compressionRatio": 0.65
  }
}
```

---

## Troubleshooting

### Common Issues

#### 1. Cannot Connect to Qdrant

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:6333
```

**Solutions:**
- Verify Qdrant is running: `curl http://localhost:6333/collections`
- Check QDRANT_URL in environment variables
- Ensure firewall allows port 6333

#### 2. Cannot Connect to Redis

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solutions:**
- Verify Redis is running: `redis-cli ping`
- Check REDIS_URL in environment variables
- Ensure firewall allows port 6379

#### 3. Voyage AI API Errors

**Symptoms:**
```
Error: Voyage AI API returned 401 Unauthorized
```

**Solutions:**
- Verify VOYAGE_API_KEY is correct
- Check API key has not expired
- Verify account has sufficient credits

#### 4. Kiro Session Expired

**Symptoms:**
```
Error: Kiro session expired, refresh failed
```

**Solutions:**
- Check KIRO_MITM_ROUTER_URL is accessible
- Verify machine ID and API key are correct
- Check MITM router logs for authentication errors
- Ensure session tokens are stored in Redis

#### 5. High Memory Usage

**Symptoms:**
- Process memory exceeds 4GB
- Frequent garbage collection

**Solutions:**
- Reduce Redis TTL for cached responses
- Limit conversation history size
- Increase Node.js heap size: `NODE_OPTIONS=--max-old-space-size=8192`

#### 6. Slow Response Times

**Symptoms:**
- Requests taking >5 seconds
- High p95/p99 latencies

**Solutions:**
- Check Qdrant query performance
- Verify Redis is not overloaded
- Enable semantic deduplication caching
- Scale to multiple instances

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm start
```

### Verify Infrastructure

Run the infrastructure verification script:

```bash
npm run verify-infrastructure
```

This will check:
- Qdrant connection and collection setup
- Redis connection and basic operations
- Voyage AI API access
- Anthropic API access
- Kiro MITM router access

---

## Production Checklist

Before deploying to production:

- [ ] All environment variables configured
- [ ] Configuration file validated
- [ ] Infrastructure services running (Qdrant, Redis)
- [ ] API keys tested and working
- [ ] Kiro accounts authenticated (if using)
- [ ] Health checks passing
- [ ] Metrics endpoint accessible
- [ ] Log aggregation configured
- [ ] Backup strategy for Redis data
- [ ] Monitoring alerts configured
- [ ] Load balancer configured (if multi-instance)
- [ ] SSL/TLS certificates installed
- [ ] Firewall rules configured
- [ ] Rate limiting configured
- [ ] Documentation reviewed

---

## Support

For issues and questions:

- GitHub Issues: https://github.com/your-org/claudeflow/issues
- Documentation: https://github.com/your-org/claudeflow/docs
- Email: support@your-org.com

---

**Last Updated:** 2026-05-02
