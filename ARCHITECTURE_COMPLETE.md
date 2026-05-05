# ClaudeFlow - Complete Architecture

## Overview

ClaudeFlow is an intelligent API router for Anthropic's Claude models with support for 1000+ Kiro OAuth accounts, automatic token refresh, and MITM proxy for intercepting Kiro CLI/IDE.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER APPLICATIONS                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Your App    │  │  Kiro CLI    │  │  Kiro IDE    │              │
│  │              │  │              │  │              │              │
│  │ (Direct API) │  │ (Intercepted)│  │ (Intercepted)│              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          │                 │                 │
          │                 │                 │
          │                 ↓                 ↓
          │         q.us-east-1.amazonaws.com
          │                 │                 │
          │                 ↓                 ↓
          │         ┌───────────────────────────┐
          │         │     /etc/hosts            │
          │         │  127.0.0.1 q.*.amazonaws  │
          │         └───────────┬───────────────┘
          │                     │
          │                     ↓
          │         ┌───────────────────────────┐
          │         │   MITM Proxy (Port 443)   │
          │         │   - HTTPS Server          │
          │         │   - CA Certificate        │
          │         │   - Request Interception  │
          │         └───────────┬───────────────┘
          │                     │
          ↓                     ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         CLAUDEFLOW CORE                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Main Router (Port 20129)                         │  │
│  │  - Native Anthropic API endpoint                              │  │
│  │  - /v1/messages                                               │  │
│  │  - /v1/models                                                 │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│                              ↓                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Account Pool Manager                             │  │
│  │  - Smart routing (quota-aware, priority-based)                │  │
│  │  - Health monitoring                                          │  │
│  │  - Circuit breaker                                            │  │
│  │  - Rate limiting                                              │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│                              ↓                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Token Manager                                    │  │
│  │  - Background refresh worker (60s interval)                   │  │
│  │  - 5-minute expiry buffer                                     │  │
│  │  - Exponential backoff retry                                  │  │
│  │  - Automatic token refresh                                    │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
│                              ↓                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Keychain Store                                   │  │
│  │  - OS Keychain integration (macOS/Linux/Windows)              │  │
│  │  - Encrypted storage                                          │  │
│  │  - Access token, refresh token, client ID, client secret     │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      1000+ KIRO ACCOUNTS                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       ┌──────────┐       │
│  │ Account  │  │ Account  │  │ Account  │  ...  │ Account  │       │
│  │    #1    │  │    #2    │  │    #3    │       │  #1000   │       │
│  │          │  │          │  │          │       │          │       │
│  │ Region:  │  │ Region:  │  │ Region:  │       │ Region:  │       │
│  │us-east-1 │  │us-west-2 │  │eu-west-1 │       │us-east-1 │       │
│  │          │  │          │  │          │       │          │       │
│  │ Status:  │  │ Status:  │  │ Status:  │       │ Status:  │       │
│  │ Active   │  │ Active   │  │ Active   │       │ Active   │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘       └────┬─────┘       │
│       │             │             │                   │             │
└───────┼─────────────┼─────────────┼───────────────────┼─────────────┘
        │             │             │                   │
        └─────────────┴─────────────┴───────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         KIRO API                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              AWS CodeWhisperer API                            │  │
│  │  - q.us-east-1.amazonaws.com                                  │  │
│  │  - q.us-west-2.amazonaws.com                                  │  │
│  │  - q.eu-west-1.amazonaws.com                                  │  │
│  │  - q.ap-southeast-1.amazonaws.com                             │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ↓
                    Native Anthropic Format
                    (100% features preserved)
```

## Component Details

### 1. User Applications

#### Direct API Mode
- Your custom applications
- Configure base URL: `http://localhost:20129`
- Use Anthropic SDK
- Full control over requests

#### MITM Intercepted Mode
- Kiro CLI (hardcoded endpoint)
- Kiro IDE (hardcoded endpoint)
- No configuration needed
- Transparent interception

### 2. MITM Proxy (Port 443)

**Components:**
- Certificate Manager
  - Self-signed CA certificate
  - System trust store integration
  - Server certificates with SAN

- Hosts File Manager
  - `/etc/hosts` modification
  - Domain redirects to `127.0.0.1`
  - Automatic backup/restore

- Proxy Server
  - HTTPS server on port 443
  - Request interception
  - Account pool integration

**Intercepted Domains:**
- `q.us-east-1.amazonaws.com`
- `q.us-west-2.amazonaws.com`
- `q.eu-west-1.amazonaws.com`
- `q.ap-southeast-1.amazonaws.com`

### 3. ClaudeFlow Core

#### Main Router (Port 20129)
- Native Anthropic API endpoint
- `/v1/messages` - Chat completions
- `/v1/models` - List models
- `/health` - Health check
- `/metrics` - Prometheus metrics

#### Account Pool Manager
- **Smart Routing:**
  - Quota-aware (avoid rate-limited accounts)
  - Priority-based (use high-priority first)
  - Round-robin (fair distribution)

- **Health Monitoring:**
  - Circuit breaker (prevent cascading failures)
  - Health checks (detect unhealthy accounts)
  - Rate limiting (prevent overuse)

- **Quota Tracking:**
  - Requests per minute
  - Tokens per day
  - Reset time tracking

#### Token Manager
- **Background Worker:**
  - Runs every 60 seconds
  - Checks all accounts
  - Refreshes tokens within 5-minute expiry buffer

- **Refresh Logic:**
  - Exponential backoff retry (1s, 2s, 4s)
  - Max 3 retry attempts
  - Mutex locks (prevent concurrent refresh)

- **Error Handling:**
  - 401/403 → Mark as "re-auth required"
  - Network errors → Retry automatically
  - Expired refresh token → User must re-login

#### Keychain Store
- **OS Integration:**
  - macOS: Keychain Access
  - Linux: Secret Service API
  - Windows: Credential Manager

- **Stored Credentials:**
  - Access token (encrypted)
  - Refresh token (encrypted)
  - Client ID (encrypted)
  - Client secret (encrypted)

### 4. Kiro Accounts (1000+)

**Account Properties:**
- Account ID (e.g., `kiro-7e045cfb9791d6e8`)
- Provider: `kiro-oauth`
- Region: `us-east-1`, `us-west-2`, etc.
- Profile ARN: `arn:aws:codewhisperer:...`
- Expiry time: ISO 8601 timestamp
- Request count: Number of requests
- Error count: Number of errors
- Priority: 0-100 (higher = preferred)

**Account States:**
- ✅ Active: Token valid, healthy
- ⚠️ Expiring: Token expires within 5 minutes
- ❌ Expired: Token expired
- ❌ Unhealthy: Circuit breaker open
- ❌ Rate Limited: Too many requests

### 5. Kiro API

**Endpoints:**
- `https://q.us-east-1.amazonaws.com/v1/messages`
- `https://q.us-west-2.amazonaws.com/v1/messages`
- `https://q.eu-west-1.amazonaws.com/v1/messages`
- `https://q.ap-southeast-1.amazonaws.com/v1/messages`

**Authentication:**
- OAuth Bearer token
- Device Code Flow
- Automatic token refresh

**Response Format:**
- Native Anthropic format
- 100% feature preservation
- No conversion needed

## Data Flow

### Flow 1: Direct API Request

```
1. Your App → POST http://localhost:20129/v1/messages
2. Main Router → Account Pool Manager
3. Account Pool Manager → Select best account (quota-aware)
4. Token Manager → Check token expiry
5. Token Manager → Refresh if needed (< 5 min)
6. Keychain Store → Retrieve access token
7. Kiro API Client → POST https://q.us-east-1.amazonaws.com/v1/messages
8. Kiro API → Process request
9. Kiro API → Return native Anthropic format
10. Main Router → Return to your app
```

### Flow 2: MITM Intercepted Request

```
1. Kiro CLI → POST https://q.us-east-1.amazonaws.com/v1/messages
2. /etc/hosts → Redirect to 127.0.0.1:443
3. MITM Proxy → Intercept HTTPS request
4. MITM Proxy → Account Pool Manager
5. Account Pool Manager → Select best account (quota-aware)
6. Token Manager → Check token expiry
7. Token Manager → Refresh if needed (< 5 min)
8. Keychain Store → Retrieve access token
9. Kiro API Client → POST https://q.us-east-1.amazonaws.com/v1/messages
10. Kiro API → Process request
11. Kiro API → Return native Anthropic format
12. MITM Proxy → Return to Kiro CLI
```

### Flow 3: Automatic Token Refresh

```
1. Background Worker → Wake up (every 60 seconds)
2. Token Manager → Check all accounts
3. For each account:
   a. Check expiry time
   b. If expires within 5 minutes:
      - POST https://oidc.us-east-1.amazonaws.com/token
      - Body: { clientId, clientSecret, refreshToken, grantType: "refresh_token" }
      - Get new accessToken + refreshToken
      - Update Keychain with new tokens
      - Update config with new expiresAt
4. Background Worker → Sleep 60 seconds
5. Repeat
```

## Security Features

### 1. Secure Token Storage
- ✅ OS Keychain (encrypted at rest)
- ✅ No plain text files
- ✅ Per-account isolation
- ✅ Automatic cleanup on account removal

### 2. TLS/SSL Security
- ✅ TLS 1.2+ enforcement
- ✅ Certificate validation
- ✅ Self-signed CA for MITM
- ✅ System trust store integration

### 3. Token Security
- ✅ Token sanitization in logs
- ✅ No token exposure in errors
- ✅ Audit logging (no sensitive data)
- ✅ Automatic token refresh

### 4. Network Security
- ✅ Region allowlist (SSRF prevention)
- ✅ No automatic redirects
- ✅ Request validation
- ✅ Response validation

## Performance Features

### 1. Smart Routing
- ✅ Quota-aware (avoid rate-limited accounts)
- ✅ Priority-based (use high-priority first)
- ✅ Health monitoring (avoid unhealthy accounts)
- ✅ Circuit breaker (prevent cascading failures)

### 2. Caching
- ✅ Prompt caching (90% cost reduction)
- ✅ Token caching (OS Keychain)
- ✅ Config caching (in-memory)

### 3. Concurrency
- ✅ Parallel account checks
- ✅ Async token refresh
- ✅ Non-blocking I/O

## Monitoring & Observability

### 1. Metrics
- ✅ Request count per account
- ✅ Error count per account
- ✅ Average latency per account
- ✅ Success rate per account
- ✅ Token expiry tracking

### 2. Health Checks
- ✅ `/health` endpoint
- ✅ `/ready` endpoint
- ✅ Circuit breaker status
- ✅ Account health status

### 3. Logging
- ✅ Structured logging (JSON)
- ✅ Log levels (debug, info, warn, error)
- ✅ Token sanitization
- ✅ Request/response logging

## Deployment

### Development
```bash
npm run build
./dist/cli/bin/claudeflow.js daemon start
```

### Production
```bash
npm run build
./dist/cli/bin/claudeflow.js daemon start --mitm
./dist/cli/bin/claudeflow.js autostart enable
```

### Docker (Future)
```bash
docker build -t claudeflow .
docker run -p 20129:20129 -p 443:443 claudeflow
```

## Summary

ClaudeFlow is a production-ready intelligent API router that:
- ✅ Supports 1000+ Kiro OAuth accounts
- ✅ Automatic token refresh (60s interval, 5min buffer)
- ✅ MITM proxy for Kiro CLI/IDE interception
- ✅ Smart routing (quota-aware, priority-based)
- ✅ Native Anthropic format (100% features)
- ✅ Secure token storage (OS Keychain)
- ✅ Health monitoring (circuit breaker)
- ✅ Better than 9router in every way

---

**Date:** 2026-05-05  
**Status:** ✅ PRODUCTION READY
