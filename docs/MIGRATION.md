# ClaudeFlow Migration Guide

**Migrating from OAuth (Kiro) to Direct Anthropic Accounts**

This guide helps you migrate from OAuth-based Kiro accounts to Direct Anthropic accounts for improved reliability and performance.

---

## Why Migrate?

### Benefits of Direct Anthropic Accounts

- ✅ **Higher Reliability**: Direct connection to Anthropic API
- ✅ **Lower Latency**: No intermediate OAuth router
- ✅ **Simpler Configuration**: No session management needed
- ✅ **Better Error Messages**: Clear authentication errors
- ✅ **No Session Expiration**: API keys don't expire like OAuth sessions

### When to Migrate

You should migrate if:
- You have Anthropic API keys available
- You're experiencing OAuth session issues
- You want more reliable service
- You want simpler configuration

---

## Migration Steps

### Step 1: Get Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in to your account
3. Navigate to **API Keys** section
4. Click **Create Key**
5. Copy the API key (starts with `sk-ant-api03-`)
6. Store it securely

### Step 2: Choose Configuration Method

Pick one of three methods:

#### Option A: Environment Variables (Recommended for Development)

Add to your `.env` file:

```bash
# Add Direct Anthropic account
ANTHROPIC_API_KEY_1=sk-ant-api03-your-new-key
```

#### Option B: Configuration File (Recommended for Production)

Edit `config.json` or `~/.claudeflow/config.json`:

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

#### Option C: CLI Tool (Recommended for Ease of Use)

```bash
claudeflow account add
# Select "Direct Anthropic" when prompted
# Enter your API key when prompted
```

### Step 3: Test New Account

Verify the new account works:

```bash
# Run health check
claudeflow health

# Expected output:
# ✅ Account: anthropic-1 (Direct Anthropic) - Connected
```

### Step 4: Update Your Application (If Needed)

**Good news**: No application changes needed! ClaudeFlow is a drop-in replacement.

Your application continues to call:
```
http://localhost:20129/v1/messages
```

ClaudeFlow automatically routes to the best available account.

### Step 5: Remove OAuth Account (Optional)

Once you've verified the Direct Anthropic account works, you can optionally remove the OAuth account:

```bash
# List all accounts
claudeflow account list

# Remove OAuth account
claudeflow account remove oauth-1
```

**Note**: You can keep both account types if you want. ClaudeFlow will use both for load balancing.

---

## Configuration Examples

### Before: OAuth Configuration

**Environment Variables:**
```bash
KIRO_MACHINE_ID_1=your-machine-id
KIRO_API_KEY_1=sk-ant-api03-...
KIRO_MITM_ROUTER_URL_1=http://3.68.219.151:20128
```

**Configuration File:**
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

### After: Direct Anthropic Configuration

**Environment Variables:**
```bash
ANTHROPIC_API_KEY_1=sk-ant-api03-your-new-key
```

**Configuration File:**
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

### Mixed Configuration (Both Account Types)

You can keep both OAuth and Direct Anthropic accounts:

**Environment Variables:**
```bash
# Direct Anthropic (will be preferred)
ANTHROPIC_API_KEY_1=sk-ant-api03-your-new-key

# OAuth (fallback)
KIRO_MACHINE_ID_1=your-machine-id
KIRO_API_KEY_1=sk-ant-api03-...
KIRO_MITM_ROUTER_URL_1=http://3.68.219.151:20128
```

**Configuration File:**
```json
{
  "accounts": [
    {
      "id": "anthropic-1",
      "provider": "anthropic",
      "apiKey": "sk-ant-api03-your-new-key"
    },
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

ClaudeFlow will automatically route requests to the best available account.

---

## Backward Compatibility

### Can I Keep OAuth Accounts?

**Yes!** ClaudeFlow maintains full backward compatibility with OAuth accounts.

You can:
- ✅ Keep OAuth accounts alongside Direct Anthropic accounts
- ✅ Use both account types simultaneously
- ✅ Gradually migrate (add Direct Anthropic, test, then remove OAuth)
- ✅ Roll back to OAuth if needed

### Account Selection Priority

When multiple account types are configured, ClaudeFlow selects accounts in this order:

1. **Direct Anthropic** (highest priority - most reliable)
2. **Proxy** (medium priority - depends on proxy reliability)
3. **OAuth** (lowest priority - session management overhead)

Within each type, accounts are selected using round-robin or sticky strategies.

### No Breaking Changes

All existing OAuth configurations continue to work:
- Session management still works
- Session refresh still works
- Combo accounts still work
- All CLI commands still work

---

## Environment Variable Migration

### Migrating from OAuth Environment Variables

**Before:**
```bash
KIRO_MACHINE_ID_1=your-machine-id-1
KIRO_API_KEY_1=sk-ant-api03-key-1
KIRO_MITM_ROUTER_URL_1=http://3.68.219.151:20128

KIRO_MACHINE_ID_2=your-machine-id-2
KIRO_API_KEY_2=sk-ant-api03-key-2
KIRO_MITM_ROUTER_URL_2=http://3.68.219.151:20128
```

**After:**
```bash
ANTHROPIC_API_KEY_1=sk-ant-api03-new-key-1
ANTHROPIC_API_KEY_2=sk-ant-api03-new-key-2
```

### Gradual Migration

You can migrate one account at a time:

**Step 1: Add first Direct Anthropic account**
```bash
ANTHROPIC_API_KEY_1=sk-ant-api03-new-key-1

# Keep OAuth accounts as fallback
KIRO_MACHINE_ID_1=your-machine-id-1
KIRO_API_KEY_1=sk-ant-api03-key-1
KIRO_MITM_ROUTER_URL_1=http://3.68.219.151:20128

KIRO_MACHINE_ID_2=your-machine-id-2
KIRO_API_KEY_2=sk-ant-api03-key-2
KIRO_MITM_ROUTER_URL_2=http://3.68.219.151:20128
```

**Step 2: Add second Direct Anthropic account**
```bash
ANTHROPIC_API_KEY_1=sk-ant-api03-new-key-1
ANTHROPIC_API_KEY_2=sk-ant-api03-new-key-2

# Keep one OAuth account as fallback
KIRO_MACHINE_ID_1=your-machine-id-1
KIRO_API_KEY_1=sk-ant-api03-key-1
KIRO_MITM_ROUTER_URL_1=http://3.68.219.151:20128
```

**Step 3: Remove OAuth accounts (optional)**
```bash
ANTHROPIC_API_KEY_1=sk-ant-api03-new-key-1
ANTHROPIC_API_KEY_2=sk-ant-api03-new-key-2
```

---

## ⚠️ Important Warnings

### About Proxy Accounts

If you're considering using proxy accounts instead of Direct Anthropic:

**⚠️ CRITICAL: Proxy accounts are ONLY for Anthropic-compatible MITM proxies**

- ✅ **SUPPORTED**: True MITM proxies that preserve raw Anthropic format
- ❌ **NOT SUPPORTED**: 9router (converts to OpenAI format)
- ❌ **NOT SUPPORTED**: OpenAI-compatible proxies
- ❌ **NOT SUPPORTED**: Format-converting proxies

### Difference Between Proxy Types

#### ✅ Anthropic-Compatible Proxy (SUPPORTED)

```
ClaudeFlow → MITM Proxy → Anthropic API
                ↓
         (logs, monitors)
                ↓
         Raw Anthropic Response ✅
```

**Characteristics:**
- Forwards requests to Anthropic API unchanged
- Returns Anthropic API responses unchanged
- May add logging, monitoring, rate limiting
- Preserves raw Anthropic format

#### ❌ Format-Converting Proxy (NOT SUPPORTED)

```
ClaudeFlow → 9router → Anthropic API
                ↓
         (converts format)
                ↓
         OpenAI Format Response ❌
```

**Characteristics:**
- Converts Anthropic format to OpenAI format
- Changes response structure
- Loses Anthropic-specific features
- **ClaudeFlow will reject these responses**

### What Happens If You Use Wrong Proxy?

If you configure a format-converting proxy (like 9router), ClaudeFlow will:

1. Send request to proxy
2. Receive OpenAI format response
3. **Automatically reject the response** with error:
   ```
   ❌ Proxy at http://localhost:8080 returned non-Anthropic format response.
      ClaudeFlow only supports proxies that forward raw Anthropic format unchanged.
      This proxy appears to convert to OpenAI or another format, which is not supported.
      Please use a true MITM proxy that preserves Anthropic format, or use a direct Anthropic account instead.
   ```
4. Suggest using Direct Anthropic account

**Solution**: Use Direct Anthropic account instead of format-converting proxy.

---

## Troubleshooting

### Issue 1: "Authentication failed" After Migration

**Symptom:**
```
❌ Account: anthropic-1 (Direct Anthropic) - Authentication failed
```

**Possible Causes:**
- Invalid API key
- API key not copied correctly
- API key expired or revoked

**Solution:**
```bash
# Verify API key format (should start with sk-ant-api03-)
echo $ANTHROPIC_API_KEY_1

# Test API key directly with curl
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY_1" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'

# If curl fails, get a new API key from Anthropic Console
```

### Issue 2: OAuth Account Still Being Used

**Symptom:**
After adding Direct Anthropic account, OAuth account is still being used.

**Possible Causes:**
- Direct Anthropic account not configured correctly
- Direct Anthropic account health check failing

**Solution:**
```bash
# Check health of all accounts
claudeflow health

# Verify Direct Anthropic account is healthy
# ✅ Account: anthropic-1 (Direct Anthropic) - Connected

# If not healthy, check configuration
claudeflow config show

# Remove OAuth account to force Direct Anthropic usage
claudeflow account remove oauth-1
```

### Issue 3: "Account not found" Error

**Symptom:**
```
❌ Account not found: anthropic-1
```

**Possible Causes:**
- Configuration not loaded
- Account ID mismatch
- Configuration file not in correct location

**Solution:**
```bash
# Check current configuration
claudeflow config show

# Verify account exists in configuration
claudeflow account list

# Restart daemon to reload configuration
claudeflow daemon restart
```

### Issue 4: Environment Variables Not Working

**Symptom:**
Direct Anthropic account not appearing in account list.

**Possible Causes:**
- Environment variables not loaded
- Wrong variable name format
- Configuration file overriding environment variables

**Solution:**
```bash
# Verify environment variables are set
env | grep ANTHROPIC

# Expected output:
# ANTHROPIC_API_KEY_1=sk-ant-api03-...

# Restart daemon to reload environment
claudeflow daemon restart

# Check if account appears
claudeflow account list
```

---

## Verification Checklist

After migration, verify everything works:

- [ ] Direct Anthropic account appears in `claudeflow account list`
- [ ] Health check shows account as connected: `claudeflow health`
- [ ] Test request succeeds: `curl http://localhost:20129/v1/messages ...`
- [ ] Response is in raw Anthropic format (has `id`, `type`, `role`, `content`)
- [ ] No authentication errors in logs: `claudeflow logs`
- [ ] OAuth account removed (optional): `claudeflow account list`

---

## Rollback Plan

If you need to rollback to OAuth accounts:

### Step 1: Keep OAuth Configuration

Don't delete OAuth configuration until you've fully tested Direct Anthropic.

### Step 2: Remove Direct Anthropic Account

```bash
# Remove Direct Anthropic account
claudeflow account remove anthropic-1

# Or comment out in .env
# ANTHROPIC_API_KEY_1=sk-ant-api03-...

# Or remove from config.json
```

### Step 3: Restart Daemon

```bash
claudeflow daemon restart
```

### Step 4: Verify OAuth Works

```bash
claudeflow health
# ✅ Account: oauth-1 (OAuth) - Connected - OAuth authenticated
```

---

## Next Steps

After successful migration:

1. **Monitor Performance**: Check logs and analytics for any issues
2. **Update Documentation**: Update your team's documentation with new configuration
3. **Remove OAuth Accounts**: Once confident, remove OAuth accounts to simplify configuration
4. **Add More Accounts**: Add multiple Direct Anthropic accounts for load balancing

---

## Additional Resources

- [Configuration Guide](CONFIGURATION.md) - Comprehensive account setup guide
- [CLI Tool Guide](CLI.md) - Complete CLI reference
- [Troubleshooting](CONFIGURATION.md#troubleshooting) - Common issues and solutions
- [Anthropic Console](https://console.anthropic.com/) - Get API keys

---

## Summary

**Migration is simple:**

1. Get Anthropic API key from [Anthropic Console](https://console.anthropic.com/)
2. Add to environment variables or config file
3. Test with `claudeflow health`
4. Optionally remove OAuth accounts

**Benefits:**
- ✅ Higher reliability
- ✅ Lower latency
- ✅ Simpler configuration
- ✅ Better error messages

**Backward Compatibility:**
- ✅ Keep OAuth accounts as fallback
- ✅ Gradual migration supported
- ✅ No breaking changes

**Need Help?**
- Check [Configuration Guide](CONFIGURATION.md)
- Run `claudeflow health` to diagnose issues
- Open [GitHub Issue](https://github.com/your-org/claudeflow/issues)
