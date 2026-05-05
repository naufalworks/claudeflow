# ClaudeFlow Architecture - MITM Proxy vs Direct API

## Understanding 9router's Architecture

### 9router Has TWO Components:

#### 1. Main Router (Port 20128)
- **Purpose:** OpenAI-compatible API endpoint
- **How it works:** 
  - Accepts requests at `http://localhost:20128/v1/chat/completions`
  - Routes to configured providers (Kiro, Claude, Gemini, etc.)
  - Converts between formats (OpenAI ↔ Anthropic ↔ Gemini)
  - Returns OpenAI format responses

#### 2. MITM Proxy (Port 443) - **OPTIONAL**
- **Purpose:** Intercept IDE extensions (Copilot, Cursor, Kiro IDE)
- **How it works:**
  1. Installs root CA certificate on system
  2. Modifies `/etc/hosts` to redirect domains:
     - `q.us-east-1.amazonaws.com` → `127.0.0.1` (Kiro)
     - `api.individual.githubcopilot.com` → `127.0.0.1` (Copilot)
     - `api2.cursor.sh` → `127.0.0.1` (Cursor)
  3. Runs HTTPS server on port 443
  4. Intercepts requests from IDE extensions
  5. Forwards to main router at port 20128
  6. Returns response to IDE

**Key Point:** The MITM proxy is ONLY for intercepting IDE extensions. It's NOT needed for direct API usage.

## ClaudeFlow's Architecture (Current)

### We Have ONE Component:

#### Main Router (Port 20129)
- **Purpose:** Native Anthropic API endpoint
- **How it works:**
  - Accepts requests at `http://localhost:20129/v1/messages`
  - Routes to Kiro OAuth accounts (with automatic token refresh)
  - Returns **native Anthropic format** (NOT OpenAI)
  - Preserves 100% of Claude capabilities

### What We DON'T Have (Yet):
- ❌ MITM proxy for intercepting IDE extensions
- ❌ OpenAI format compatibility
- ❌ Port 443 HTTPS interception

## Use Cases Comparison

### 9router Use Cases:

#### Use Case 1: Direct API (No MITM)
```
Your App → http://localhost:20128/v1/chat/completions → 9router → Kiro
                                                        ↓
                                                   OpenAI format
```

#### Use Case 2: IDE Extension (With MITM)
```
Kiro IDE → https://q.us-east-1.amazonaws.com → /etc/hosts redirect → 127.0.0.1:443
                                                                      ↓
                                                                   MITM Proxy
                                                                      ↓
                                                              http://localhost:20128
                                                                      ↓
                                                                   9router
                                                                      ↓
                                                                   Kiro API
```

### ClaudeFlow Use Cases:

#### Use Case 1: Direct API (Current - WORKING)
```
Your App → http://localhost:20129/v1/messages → ClaudeFlow → Kiro
                                                    ↓
                                              Anthropic format
```

#### Use Case 2: Multiple Kiro Accounts (Current - WORKING)
```
Your App → http://localhost:20129/v1/messages → ClaudeFlow
                                                    ↓
                                          Account Pool Manager
                                                    ↓
                                    ┌───────────────┼───────────────┐
                                    ↓               ↓               ↓
                              Kiro Account 1  Kiro Account 2  Kiro Account 3
                                    ↓               ↓               ↓
                              Auto Refresh    Auto Refresh    Auto Refresh
```

#### Use Case 3: IDE Extension (NOT IMPLEMENTED YET)
```
Kiro IDE → https://q.us-east-1.amazonaws.com → /etc/hosts redirect → 127.0.0.1:443
                                                                      ↓
                                                                   MITM Proxy
                                                                   (NOT BUILT)
                                                                      ↓
                                                              http://localhost:20129
                                                                      ↓
                                                                 ClaudeFlow
                                                                      ↓
                                                                   Kiro API
```

## What You Asked: "1000 Kiro Accounts → ClaudeFlow → Kiro"

### This Already Works! ✅

**Current Implementation:**
```bash
# Add 1000 Kiro accounts
for i in {1..1000}; do
  claudeflow login --method builder-id --region us-east-1
done

# Start daemon with automatic token refresh
claudeflow daemon start

# Use from your app
curl -X POST http://localhost:20129/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**What Happens:**
1. Request arrives at ClaudeFlow
2. Account Pool Manager selects best account (round-robin, quota-aware, etc.)
3. Token Manager ensures token is fresh (auto-refresh if needed)
4. Request forwarded to Kiro with account's access token
5. Response returned in **native Anthropic format**

## Do We Need MITM Proxy?

### When You DON'T Need It (Most Cases):
- ✅ Using ClaudeFlow as API endpoint in your app
- ✅ Using Claude Code CLI
- ✅ Using Continue.dev extension
- ✅ Using any tool that lets you configure API endpoint

### When You WOULD Need It (Rare):
- ❌ Want to intercept Kiro IDE extension
- ❌ Want to intercept Cursor IDE
- ❌ Want to intercept GitHub Copilot
- ❌ IDE doesn't allow custom API endpoint

## Should We Build MITM Proxy?

### Pros:
- ✅ Can intercept IDE extensions
- ✅ Transparent to IDE (no config needed)
- ✅ Same UX as 9router

### Cons:
- ❌ Requires root/admin privileges
- ❌ Modifies system files (`/etc/hosts`)
- ❌ Installs root CA certificate (security risk)
- ❌ Complex to maintain (OS-specific)
- ❌ Can break system networking if not cleaned up properly
- ❌ Most IDEs support custom API endpoints anyway

### Recommendation: **NO, Don't Build It**

**Why:**
1. **Security Risk** - Installing root CA and modifying `/etc/hosts` is dangerous
2. **Not Needed** - Most tools support custom API endpoints
3. **Already Working** - Direct API usage works perfectly
4. **Maintenance Burden** - OS-specific code for Windows/Mac/Linux

## How to Use ClaudeFlow with 1000 Accounts

### Step 1: Add Accounts
```bash
# Option A: Interactive (one by one)
claudeflow login

# Option B: Automated (if you have tokens)
for token in $(cat tokens.txt); do
  claudeflow login --method manual-token --token "$token" --region us-east-1
done
```

### Step 2: Start Daemon
```bash
claudeflow daemon start
```

**What Happens:**
- ✅ Server starts on port 20129
- ✅ Token refresh worker starts (checks every 60 seconds)
- ✅ Account pool manager initializes
- ✅ All 1000 accounts ready to use

### Step 3: Use from Your App
```python
import anthropic

client = anthropic.Anthropic(
    api_key="dummy",  # Not used, but required by SDK
    base_url="http://localhost:20129"
)

response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
```

**What Happens:**
1. Request → ClaudeFlow
2. ClaudeFlow selects account from pool (round-robin or quota-aware)
3. Auto-refreshes token if needed
4. Forwards to Kiro with account's token
5. Returns native Anthropic format

### Step 4: Monitor
```bash
# Check accounts
claudeflow account list

# Check health
claudeflow health

# View logs
claudeflow logs
```

## Account Pool Strategies

### Round-Robin (Default)
- Cycles through accounts sequentially
- Fair distribution
- Simple and predictable

### Quota-Aware (Recommended for 1000 accounts)
- Tracks requests per account
- Avoids rate-limited accounts
- Maximizes throughput

### Priority-Based
- Use high-priority accounts first
- Fallback to lower priority
- Good for tiered access

## Summary

### What 9router Does:
1. **Main Router** - Routes requests to providers (OpenAI format)
2. **MITM Proxy** - Intercepts IDE extensions (optional, complex)

### What ClaudeFlow Does:
1. **Main Router** - Routes requests to Kiro accounts (Anthropic format) ✅
2. **Account Pool** - Manages 1000+ accounts with auto-refresh ✅
3. **MITM Proxy** - NOT IMPLEMENTED (and not needed)

### Your Question: "1000 Kiro Accounts → ClaudeFlow → Kiro"
**Answer:** ✅ **Already works!** Just add accounts and start the daemon.

### Do You Need MITM Proxy?
**Answer:** ❌ **No**, unless you specifically want to intercept IDE extensions that don't support custom API endpoints.

---

**Date:** 2026-05-05  
**Status:** ✅ PRODUCTION READY (without MITM)
