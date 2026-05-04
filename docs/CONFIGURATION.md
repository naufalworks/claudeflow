# ClaudeFlow Configuration Guide

Complete guide for configuring ClaudeFlow with all supported account types.

## Table of Contents

- [Account Types Overview](#account-types-overview)
- [Direct Anthropic Accounts](#direct-anthropic-accounts)
- [Anthropic-Compatible Proxy Accounts](#anthropic-compatible-proxy-accounts)
- [OAuth Accounts (Kiro)](#oauth-accounts-kiro)
- [Configuration Methods](#configuration-methods)
- [Response Format Validation](#response-format-validation)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)

---

## Account Types Overview

ClaudeFlow supports **three account types** for maximum flexibility:

| Account Type | Use Case | Format | Reliability |
|--------------|----------|--------|-------------|
| **Direct Anthropic** | You have Anthropic API keys | Raw Anthropic | ⭐⭐⭐⭐⭐ Highest |
| **Proxy** | You have MITM proxy | Raw Anthropic | ⭐⭐⭐⭐ High |
| **OAuth (Kiro)** | Existing OAuth setup | Raw Anthropic | ⭐⭐⭐ Medium |

### Which Account Type Should I Use?

```
Do you have Anthropic API keys?
├─ YES → Use Direct Anthropic (RECOMMENDED)
└─ NO
   ├─ Do you have a true MITM proxy that preserves Anthropic format?
   │  ├─ YES → Use Proxy account
   │  └─ NO → Do NOT use proxy (see warning below)
   └─ Do you have existing Kiro OAuth setup?
      └─ YES → Use OAuth account
```

### ⚠️ CRITICAL: Response Format Requirements

**ClaudeFlow ONLY supports raw Anthropic format responses.**

- ✅ **SUPPORTED**: Direct Anthropic API, true MITM proxies that preserve Anthropic format
- ❌ **NOT SUPPORTED**: 9router, proxies that convert to OpenAI format, format-converting proxies

**What happens if format is wrong?**
- ClaudeFlow automatically validates all responses
- Non-Anthropic format responses are rejected with clear error message
- Error suggests using Direct Anthropic account instead

---

## Direct Anthropic Accounts

**RECOMMENDED** - Most reliable option with direct connection to Anthropic API.

### Features

- ✅ Direct connection to `api.anthropic.com`
- ✅ 100% native Anthropic format (no conversion)
- ✅ Lowest latency
- ✅ Most reliable
- ✅ All Anthropic features supported

### Configuration

#### Method 1: Environment Variables

```bash
# Add multiple accounts for load balancing
ANTHROPIC_API_KEY_1=sk-ant-api03-your-key-1
ANTHROPIC_API_KEY_2=sk-ant-api03-your-key-2
ANTHROPIC_API_KEY_3=sk-ant-api03-your-key-3
```

#### Method 2: Configuration File

```json
{
  "accounts": [
    {
      "id": "anthropic-1",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-your-key-1"
    },
    {
      "id": "anthropic-2",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-your-key-2"
    }
  ]
}
```

#### Method 3: CLI Tool

```bash
# Interactive account addition
claudeflow account add

# Select "Direct Anthropic" when prompted
# Enter your API key when prompted
```

### Getting Anthropic API Keys

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create new API key
5. Copy key (starts with `sk-ant-api03-`)

---

## Anthropic-Compatible Proxy Accounts

**For advanced users** with true MITM proxies that preserve raw Anthropic format.

### ⚠️ CRITICAL WARNINGS

**ONLY use proxy accounts if:**
- ✅ Your proxy is a true MITM proxy (Man-In-The-Middle)
- ✅ Your proxy forwards Anthropic requests unchanged
- ✅ Your proxy returns raw Anthropic format responses (NOT OpenAI format)

**DO NOT use proxy accounts with:**
- ❌ **9router** - Converts to OpenAI format (NOT SUPPORTED)
- ❌ **OpenAI-compatible proxies** - Wrong format
- ❌ **Format-converting proxies** - ClaudeFlow will reject responses

### What is a "True MITM Proxy"?

A true MITM proxy:
- Sits between ClaudeFlow and Anthropic API
- Forwards requests to Anthropic API unchanged
- Returns Anthropic API responses unchanged
- Does NOT convert formats
- May add logging, monitoring, or rate limiting

### Supported vs Unsupported Proxies

#### ✅ Supported Proxy Types

```
ClaudeFlow → MITM Proxy → Anthropic API
                ↓
         (logs, monitors)
                ↓
         Raw Anthropic Response
```

**Examples:**
- Custom MITM proxy with logging
- Corporate proxy with monitoring
- Rate-limiting proxy that preserves format

#### ❌ Unsupported Proxy Types

```
ClaudeFlow → 9router → Anthropic API
                ↓
         (converts format)
                ↓
         OpenAI Format Response ❌
```

**Examples:**
- 9router (converts to OpenAI format)
- OpenAI-compatible proxies
- Any proxy that modifies response format

### Configuration

#### Method 1: Environment Variables

```bash
# Proxy account with baseURL
PROXY_API_KEY_1=your-proxy-api-key
PROXY_BASE_URL_1=http://localhost:8080

PROXY_API_KEY_2=your-proxy-api-key
PROXY_BASE_URL_2=https://your-mitm-proxy.com
```

#### Method 2: Configuration File

```json
{
  "accounts": [
    {
      "id": "proxy-1",
      "provider": "proxy",
      "apiKey": "your-proxy-api-key",
      "baseURL": "http://localhost:8080"
    },
    {
      "id": "proxy-2",
      "provider": "proxy",
      "apiKey": "your-proxy-api-key",
      "baseURL": "https://your-mitm-proxy.com"
    }
  ]
}
```

#### Method 3: CLI Tool

```bash
# Interactive account addition
claudeflow account add

# Select "Anthropic-Compatible Proxy" when prompted
# Enter API key and baseURL when prompted
```

### Testing Proxy Compatibility

```bash
# Test if your proxy returns raw Anthropic format
claudeflow health

# Look for proxy account status:
# ✅ "Connected - Raw Anthropic format verified" = GOOD
# ❌ "Proxy returns non-Anthropic format" = BAD (use Direct Anthropic instead)
```

### Error Messages

If your proxy returns non-Anthropic format, you'll see:

```
❌ Proxy at http://localhost:8080 returned non-Anthropic format response.
   ClaudeFlow only supports proxies that forward raw Anthropic format unchanged.
   This proxy appears to convert to OpenAI or another format, which is not supported.
   Please use a true MITM proxy that preserves Anthropic format, or use a direct Anthropic account instead.
```

**Solution**: Use Direct Anthropic account instead.

---

## OAuth Accounts (Kiro)

**For backward compatibility** with existing Kiro OAuth setups.

### Features

- ✅ OAuth authentication flow
- ✅ Automatic session management
- ✅ Session refresh and rotation
- ✅ Backward compatible with existing setups

### Configuration

#### Method 1: Environment Variables

```bash
# OAuth account with machine ID
KIRO_MACHINE_ID_1=your-machine-id-1
KIRO_API_KEY_1=sk-ant-api03-your-key-1
KIRO_MITM_ROUTER_URL_1=http://3.68.219.151:20128

KIRO_MACHINE_ID_2=your-machine-id-2
KIRO_API_KEY_2=sk-ant-api03-your-key-2
KIRO_MITM_ROUTER_URL_2=http://3.68.219.151:20128
```

#### Method 2: Configuration File

```json
{
  "accounts": [
    {
      "id": "oauth-1",
      "provider": "kiro",
      "apiKey": "sk-ant-api03-your-key-1",
      "kiroConfig": {
        "machineId": "your-machine-id-1",
        "mitmRouterUrl": "http://3.68.219.151:20128"
      }
    },
    {
      "id": "oauth-2",
      "provider": "kiro",
      "apiKey": "sk-ant-api03-your-key-2",
      "kiroConfig": {
        "machineId": "your-machine-id-2",
        "mitmRouterUrl": "http://3.68.219.151:20128",
        "combo": {
          "accounts": ["account-a", "account-b", "account-c"],
          "strategy": "round-robin"
        }
      }
    }
  ]
}
```

#### Method 3: CLI Tool

```bash
# Interactive account addition
claudeflow account add

# Select "OAuth (Kiro)" when prompted
# Enter machine ID, API key, and router URL when prompted
```

### Session Management

OAuth accounts require session management:

```bash
# Check session status
claudeflow session status

# Refresh session manually
claudeflow session refresh

# Sessions are automatically refreshed when needed
```

---

## Configuration Methods

ClaudeFlow supports three configuration methods (in order of precedence):

### 1. Environment Variables (Highest Priority)

```bash
# .env file or shell environment
ANTHROPIC_API_KEY_1=sk-ant-api03-...
PROXY_API_KEY_1=your-key
PROXY_BASE_URL_1=http://localhost:8080
KIRO_MACHINE_ID_1=your-machine-id
```

**Pros:**
- Easy to set up
- Good for development
- Works with Docker

**Cons:**
- Limited to simple configurations
- No advanced features (combos, strategies)

### 2. Configuration File

```bash
# config.json or ~/.claudeflow/config.json
{
  "accounts": [...],
  "optimization": {...},
  "infrastructure": {...}
}
```

**Pros:**
- Full control over all settings
- Supports advanced features
- Easy to version control

**Cons:**
- More complex to set up
- Requires JSON knowledge

### 3. CLI Tool (Recommended)

```bash
# Interactive setup
claudeflow setup

# Manage accounts
claudeflow account add
claudeflow account list
claudeflow account remove <id>
```

**Pros:**
- Interactive and user-friendly
- Validates configuration
- No JSON knowledge required

**Cons:**
- Requires CLI tool installation

### Configuration Merging

When multiple methods are used:

```
Environment Variables + Configuration File = Final Configuration
```

- Environment variables are merged with config file
- Environment variables take precedence
- Accounts from both sources are combined

---

## Response Format Validation

ClaudeFlow automatically validates all responses to ensure they are in raw Anthropic format.

### What is Raw Anthropic Format?

Raw Anthropic format has these characteristics:

```json
{
  "id": "msg_01...",           // Starts with "msg_"
  "type": "message",           // Type is "message"
  "role": "assistant",         // Role is "assistant"
  "content": [...],            // Content is an array
  "model": "claude-...",       // Model name
  "usage": {...}               // Usage statistics
}
```

### What is NOT Anthropic Format?

OpenAI format (NOT SUPPORTED):

```json
{
  "id": "chatcmpl-...",        // Different ID format
  "object": "chat.completion", // Different object type
  "choices": [...],            // Has "choices" array ❌
  "usage": {...}
}
```

### Validation Process

1. **Request sent** to account (Direct Anthropic, Proxy, or OAuth)
2. **Response received** from API/proxy/router
3. **Format validation** checks for required Anthropic fields
4. **If valid** → Response returned to client
5. **If invalid** → Error thrown with clear message

### Error Messages

If validation fails:

```
❌ Response format validation failed.
   ClaudeFlow only supports raw Anthropic format.
   This proxy/router appears to return OpenAI or another format.
   
   Recommendation: Use a direct Anthropic account instead.
```

---

## Migration Guide

### Migrating from OAuth to Direct Anthropic

**Why migrate?**
- Direct Anthropic is more reliable
- Lower latency
- Simpler configuration
- No session management needed

**Step-by-step migration:**

#### Step 1: Get Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create new API key
3. Copy key (starts with `sk-ant-api03-`)

#### Step 2: Add Direct Anthropic Account

**Option A: Environment Variables**

```bash
# Add to .env file
ANTHROPIC_API_KEY_1=sk-ant-api03-your-new-key
```

**Option B: CLI Tool**

```bash
claudeflow account add
# Select "Direct Anthropic"
# Enter your API key
```

**Option C: Configuration File**

```json
{
  "accounts": [
    {
      "id": "anthropic-1",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-your-new-key"
    }
  ]
}
```

#### Step 3: Test New Account

```bash
# Check health
claudeflow health

# Look for:
# ✅ Account: anthropic-1 (Direct Anthropic) - Connected
```

#### Step 4: Remove OAuth Account (Optional)

```bash
# List accounts
claudeflow account list

# Remove OAuth account
claudeflow account remove oauth-1
```

#### Step 5: Update Application

If your application uses ClaudeFlow, no changes needed! ClaudeFlow is a drop-in replacement.

### Before/After Comparison

**Before (OAuth):**

```json
{
  "accounts": [
    {
      "id": "oauth-1",
      "provider": "kiro",
      "apiKey": "sk-ant-api03-...",
      "kiroConfig": {
        "machineId": "your-machine-id",
        "mitmRouterUrl": "http://3.68.219.151:20128"
      }
    }
  ]
}
```

**After (Direct Anthropic):**

```json
{
  "accounts": [
    {
      "id": "anthropic-1",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-your-new-key"
    }
  ]
}
```

### Backward Compatibility

**Good news**: You can keep OAuth accounts while adding Direct Anthropic accounts!

```json
{
  "accounts": [
    {
      "id": "anthropic-1",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-..."
    },
    {
      "id": "oauth-1",
      "provider": "kiro",
      "apiKey": "sk-ant-api03-...",
      "kiroConfig": {...}
    }
  ]
}
```

ClaudeFlow will use both accounts for load balancing.

---

## Troubleshooting

### Common Issues

#### Issue 1: "Proxy returns non-Anthropic format"

**Symptom:**
```
❌ Account: proxy-1 (Proxy) - Proxy returns non-Anthropic format - Use direct Anthropic account
```

**Cause:** Your proxy converts responses to OpenAI format (e.g., 9router)

**Solution:** Use Direct Anthropic account instead

```bash
# Remove proxy account
claudeflow account remove proxy-1

# Add Direct Anthropic account
claudeflow account add
# Select "Direct Anthropic"
```

#### Issue 2: "Authentication failed"

**Symptom:**
```
❌ Account: anthropic-1 (Direct Anthropic) - Authentication failed
```

**Cause:** Invalid API key

**Solution:** Check your API key

```bash
# Verify API key format (should start with sk-ant-api03-)
echo $ANTHROPIC_API_KEY_1

# Test with curl
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY_1" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'
```

#### Issue 3: "OAuth session expired"

**Symptom:**
```
❌ Account: oauth-1 (OAuth) - Authentication failed
```

**Cause:** OAuth session expired

**Solution:** Refresh session

```bash
# Refresh session
claudeflow session refresh

# Or restart daemon (auto-refreshes)
claudeflow daemon restart
```

#### Issue 4: "Connection failed"

**Symptom:**
```
❌ Account: proxy-1 (Proxy) - Connection failed
```

**Cause:** Proxy is not reachable

**Solution:** Check proxy URL and connectivity

```bash
# Test proxy connectivity
curl http://localhost:8080/v1/messages

# Check if proxy is running
netstat -an | grep 8080
```

### Health Check

Always run health check after configuration changes:

```bash
claudeflow health
```

Expected output:

```
✅ Qdrant - Connected
✅ Redis - Connected
✅ Voyage AI - Connected
✅ Anthropic API - Reachable
✅ Account: anthropic-1 (Direct Anthropic) - Connected
✅ Account: proxy-1 (Proxy) - Connected - Raw Anthropic format verified
✅ Account: oauth-1 (OAuth) - Connected - OAuth authenticated
```

### Getting Help

If you're still having issues:

1. Check logs: `claudeflow logs`
2. Run health check: `claudeflow health`
3. Check configuration: `claudeflow config show`
4. Open issue: [GitHub Issues](https://github.com/your-org/claudeflow/issues)

---

## Summary

### Quick Reference

| Account Type | Provider | Required Fields | Use Case |
|--------------|----------|----------------|----------|
| Direct Anthropic | `anthropic` | `apiKey` | Most reliable (RECOMMENDED) |
| Proxy | `proxy` | `apiKey`, `baseURL` | True MITM proxies only |
| OAuth | `kiro` | `apiKey`, `kiroConfig` | Backward compatibility |

### Key Takeaways

1. ✅ **Direct Anthropic is RECOMMENDED** - Most reliable option
2. ⚠️ **Proxy accounts are ONLY for true MITM proxies** - NOT for 9router
3. ✅ **All responses MUST be raw Anthropic format** - Automatic validation
4. ✅ **Multiple account types can coexist** - Mix and match as needed
5. ✅ **Use CLI tool for easy setup** - Interactive and user-friendly

### Next Steps

1. Choose your account type
2. Configure using environment variables, config file, or CLI
3. Run health check to verify
4. Start using ClaudeFlow!

For more information, see:
- [CLI Tool Guide](CLI.md)
- [API Documentation](API.md)
- [Deployment Guide](DEPLOYMENT.md)
