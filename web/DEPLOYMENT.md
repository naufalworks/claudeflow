# ClaudeFlow Web UI Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Production Build](#production-build)
4. [Deployment Options](#deployment-options)
5. [Reverse Proxy Configuration](#reverse-proxy-configuration)
6. [Docker Deployment](#docker-deployment)
7. [Health Checks](#health-checks)
8. [Monitoring & Logging](#monitoring--logging)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements
- **Node.js:** 18.17.0 or higher (20.x recommended)
- **npm:** 9.x or higher
- **Memory:** Minimum 2GB RAM
- **Disk:** Minimum 500MB free space

### Backend Requirements
- ClaudeFlow API server running on port 20129
- WebSocket server running on port 8080
- Valid API key for authentication

---

## Environment Variables

### Development (.env.local)
```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:20129
NEXT_PUBLIC_WS_URL=ws://localhost:8080

# Environment
NODE_ENV=development
```

### Production (.env.production)
```bash
# API Configuration
NEXT_PUBLIC_API_URL=https://api.claudeflow.yourdomain.com
NEXT_PUBLIC_WS_URL=wss://ws.claudeflow.yourdomain.com

# Environment
NODE_ENV=production

# Optional: Analytics
NEXT_PUBLIC_ANALYTICS_ID=your-analytics-id

# Optional: Sentry Error Tracking
NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

### Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | `http://localhost:20129` | ClaudeFlow API base URL |
| `NEXT_PUBLIC_WS_URL` | Yes | `ws://localhost:8080` | WebSocket server URL |
| `NODE_ENV` | Yes | `development` | Environment mode |
| `NEXT_PUBLIC_ANALYTICS_ID` | No | - | Analytics tracking ID |
| `NEXT_PUBLIC_SENTRY_DSN` | No | - | Sentry error tracking DSN |

---

## Production Build

### 1. Install Dependencies
```bash
cd web
npm ci --production=false
```

### 2. Run Tests (Optional but Recommended)
```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Type checking
npm run type-check
```

### 3. Build for Production
```bash
npm run build
```

**Expected Output:**
```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (10/10)
✓ Finalizing page optimization

Route (app)                              Size     First Load JS
┌ ○ /                                    5.2 kB         95 kB
├ ○ /dashboard                           12.3 kB        107 kB
├ ○ /dashboard/accounts                  8.7 kB         103 kB
├ ○ /dashboard/activity                  6.4 kB         101 kB
├ ○ /dashboard/analytics                 15.2 kB        110 kB
├ ○ /dashboard/settings                  9.1 kB         104 kB
└ ○ /login                               4.8 kB         94 kB

○  (Static)  prerendered as static content
```

### 4. Start Production Server
```bash
npm start
```

The application will be available at `http://localhost:3000`.

---

## Deployment Options

### Option 1: Vercel (Recommended)

**Pros:** Zero-config, automatic HTTPS, global CDN, serverless functions
**Cons:** Vendor lock-in, cold starts

#### Steps:
1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel --prod
```

3. Configure environment variables in Vercel dashboard:
   - Go to Project Settings → Environment Variables
   - Add `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`

4. Set up custom domain (optional):
   - Go to Project Settings → Domains
   - Add your domain and configure DNS

#### Vercel Configuration (vercel.json)
```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm ci",
  "framework": "nextjs",
  "regions": ["iad1"],
  "env": {
    "NEXT_PUBLIC_API_URL": "@api-url",
    "NEXT_PUBLIC_WS_URL": "@ws-url"
  }
}
```

---

### Option 2: Self-Hosted (Node.js)

**Pros:** Full control, no vendor lock-in, cost-effective
**Cons:** Manual setup, maintenance overhead

#### Steps:
1. Build the application:
```bash
npm run build
```

2. Create systemd service (`/etc/systemd/system/claudeflow-web.service`):
```ini
[Unit]
Description=ClaudeFlow Web UI
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/claudeflow/web
Environment="NODE_ENV=production"
Environment="PORT=3000"
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

3. Enable and start service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable claudeflow-web
sudo systemctl start claudeflow-web
```

4. Check status:
```bash
sudo systemctl status claudeflow-web
```

---

### Option 3: Docker

**Pros:** Consistent environment, easy scaling, portable
**Cons:** Additional complexity, resource overhead

See [Docker Deployment](#docker-deployment) section below.

---

## Reverse Proxy Configuration

### Nginx

#### Configuration File (`/etc/nginx/sites-available/claudeflow`)
```nginx
# Upstream servers
upstream claudeflow_web {
    server 127.0.0.1:3000;
    keepalive 64;
}

upstream claudeflow_api {
    server 127.0.0.1:20129;
    keepalive 64;
}

upstream claudeflow_ws {
    server 127.0.0.1:8080;
    keepalive 64;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name claudeflow.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS server for Web UI
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name claudeflow.yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/claudeflow.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claudeflow.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' wss://ws.claudeflow.yourdomain.com https://api.claudeflow.yourdomain.com;" always;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss;

    # Client body size
    client_max_body_size 10M;

    # Proxy to Next.js
    location / {
        proxy_pass http://claudeflow_web;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    # Static assets caching
    location /_next/static/ {
        proxy_pass http://claudeflow_web;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, immutable";
    }

    # Health check
    location /health {
        access_log off;
        return 200 "OK\n";
        add_header Content-Type text/plain;
    }
}

# HTTPS server for API
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.claudeflow.yourdomain.com;

    # SSL Configuration (same as above)
    ssl_certificate /etc/letsencrypt/live/claudeflow.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claudeflow.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Proxy to ClaudeFlow API
    location / {
        proxy_pass http://claudeflow_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 120s;
    }
}

# HTTPS server for WebSocket
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ws.claudeflow.yourdomain.com;

    # SSL Configuration (same as above)
    ssl_certificate /etc/letsencrypt/live/claudeflow.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claudeflow.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket proxy
    location / {
        proxy_pass http://claudeflow_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
    }
}
```

#### Enable Configuration
```bash
sudo ln -s /etc/nginx/sites-available/claudeflow /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### SSL Certificate (Let's Encrypt)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d claudeflow.yourdomain.com -d api.claudeflow.yourdomain.com -d ws.claudeflow.yourdomain.com
```

---

## Docker Deployment

### Dockerfile
```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production=false

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "server.js"]
```

### docker-compose.yml
```yaml
version: '3.8'

services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: claudeflow-web
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=https://api.claudeflow.yourdomain.com
      - NEXT_PUBLIC_WS_URL=wss://ws.claudeflow.yourdomain.com
    networks:
      - claudeflow
    depends_on:
      - api
      - ws
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  api:
    image: claudeflow-api:latest
    container_name: claudeflow-api
    restart: unless-stopped
    ports:
      - "20129:20129"
    networks:
      - claudeflow

  ws:
    image: claudeflow-ws:latest
    container_name: claudeflow-ws
    restart: unless-stopped
    ports:
      - "8080:8080"
    networks:
      - claudeflow

networks:
  claudeflow:
    driver: bridge
```

### Build and Run
```bash
# Build image
docker build -t claudeflow-web:latest .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f web

# Stop
docker-compose down
```

---

## Health Checks

### Application Health Check
```bash
curl http://localhost:3000/health
# Expected: 200 OK
```

### API Health Check
```bash
curl http://localhost:20129/health
# Expected: {"status":"ok","timestamp":"..."}
```

### WebSocket Health Check
```bash
wscat -c ws://localhost:8080
# Expected: Connection established
```

### Automated Health Monitoring Script
```bash
#!/bin/bash
# health-check.sh

WEB_URL="http://localhost:3000/health"
API_URL="http://localhost:20129/health"

check_service() {
    local url=$1
    local name=$2

    if curl -sf "$url" > /dev/null; then
        echo "✓ $name is healthy"
        return 0
    else
        echo "✗ $name is down"
        return 1
    fi
}

check_service "$WEB_URL" "Web UI"
check_service "$API_URL" "API"

# Exit with error if any service is down
exit $?
```

---

## Monitoring & Logging

### Application Logs

#### View Logs (systemd)
```bash
# Real-time logs
sudo journalctl -u claudeflow-web -f

# Last 100 lines
sudo journalctl -u claudeflow-web -n 100

# Logs since yesterday
sudo journalctl -u claudeflow-web --since yesterday
```

#### View Logs (Docker)
```bash
# Real-time logs
docker logs -f claudeflow-web

# Last 100 lines
docker logs --tail 100 claudeflow-web
```

### Performance Monitoring

#### Prometheus Metrics (Optional)
Add to `next.config.ts`:
```typescript
module.exports = {
  experimental: {
    instrumentationHook: true,
  },
};
```

Create `instrumentation.ts`:
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { PrometheusExporter } = await import('@opentelemetry/exporter-prometheus');
    // Setup Prometheus exporter
  }
}
```

#### Uptime Monitoring
Use services like:
- **UptimeRobot** - Free tier available
- **Pingdom** - Comprehensive monitoring
- **StatusCake** - Multiple check locations

### Error Tracking

#### Sentry Integration
```bash
npm install @sentry/nextjs
```

Create `sentry.client.config.ts`:
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});
```

---

## Troubleshooting

### Issue: Build Fails

**Symptoms:** `npm run build` exits with errors

**Solutions:**
1. Clear cache and reinstall:
```bash
rm -rf .next node_modules package-lock.json
npm install
npm run build
```

2. Check Node.js version:
```bash
node --version  # Should be 18.17.0+
```

3. Check for TypeScript errors:
```bash
npm run type-check
```

---

### Issue: WebSocket Connection Fails

**Symptoms:** Real-time updates not working, "WebSocket connection failed" in console

**Solutions:**
1. Check WebSocket server is running:
```bash
curl http://localhost:8080/health
```

2. Check firewall rules:
```bash
sudo ufw allow 8080/tcp
```

3. Verify WebSocket URL in environment:
```bash
echo $NEXT_PUBLIC_WS_URL
```

4. Check Nginx WebSocket proxy configuration (see above)

---

### Issue: API Requests Fail with 401

**Symptoms:** "Unauthorized" errors, auto-logout loop

**Solutions:**
1. Verify API key is valid:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:20129/health
```

2. Clear localStorage and re-login:
```javascript
// In browser console
localStorage.clear();
location.reload();
```

3. Check API server logs for authentication errors

---

### Issue: High Memory Usage

**Symptoms:** Application crashes with "JavaScript heap out of memory"

**Solutions:**
1. Increase Node.js memory limit:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

2. Check for memory leaks:
```bash
node --inspect server.js
# Open chrome://inspect in Chrome
```

3. Optimize bundle size:
```bash
npm run analyze
```

---

### Issue: Slow Page Load

**Symptoms:** Pages take >3s to load

**Solutions:**
1. Enable production mode:
```bash
NODE_ENV=production npm start
```

2. Check bundle sizes:
```bash
npm run analyze
```

3. Enable Nginx caching (see reverse proxy config above)

4. Use CDN for static assets

---

### Issue: CORS Errors

**Symptoms:** "CORS policy blocked" in browser console

**Solutions:**
1. Update API CORS configuration to allow web UI origin:
```typescript
// In ClaudeFlow API server
app.use(cors({
  origin: ['http://localhost:3000', 'https://claudeflow.yourdomain.com'],
  credentials: true,
}));
```

2. Verify `NEXT_PUBLIC_API_URL` matches CORS origin

---

## Performance Benchmarks

### Expected Performance
- **First Contentful Paint (FCP):** <1.5s
- **Largest Contentful Paint (LCP):** <2.5s
- **Time to Interactive (TTI):** <3.5s
- **Cumulative Layout Shift (CLS):** <0.1
- **First Input Delay (FID):** <100ms

### Run Lighthouse Audit
```bash
npx lighthouse http://localhost:3000 --view
```

---

## Security Checklist

- [ ] HTTPS enabled with valid SSL certificate
- [ ] Security headers configured (CSP, X-Frame-Options, etc.)
- [ ] API keys stored securely (not in code)
- [ ] CORS configured correctly
- [ ] Rate limiting enabled on API
- [ ] Regular dependency updates (`npm audit`)
- [ ] Error messages don't leak sensitive info
- [ ] Logs don't contain API keys or tokens
- [ ] Firewall rules configured
- [ ] Regular backups of configuration

---

## Maintenance

### Regular Tasks

#### Weekly
- Check application logs for errors
- Monitor disk space usage
- Review performance metrics

#### Monthly
- Update dependencies: `npm update`
- Run security audit: `npm audit`
- Review and rotate API keys
- Check SSL certificate expiry

#### Quarterly
- Review and optimize bundle size
- Update Node.js version
- Performance audit with Lighthouse
- Review and update documentation

---

## Support

### Getting Help
- **Documentation:** `/web/README.md`, `/web/ARCHITECTURE.md`
- **Issues:** https://github.com/yourusername/claudeflow/issues
- **Logs:** Check application and system logs first

### Reporting Issues
Include:
1. Environment (OS, Node.js version, deployment method)
2. Steps to reproduce
3. Expected vs actual behavior
4. Relevant logs
5. Screenshots (if applicable)

---

**Last Updated:** 2026-05-11
