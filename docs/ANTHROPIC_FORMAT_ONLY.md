# ClaudeFlow: Native Anthropic Format Only

## Core Principle

**ClaudeFlow ONLY supports native Anthropic API format. Period.**

We do NOT support:
- ❌ OpenAI format (chat completions)
- ❌ Format conversion/translation
- ❌ Proxies that convert Anthropic → OpenAI (like 9router)
- ❌ Any non-Anthropic response format

## Why Anthropic Format Only?

### 1. **Zero Capability Loss**
Anthropic models have unique features that don't exist in OpenAI format:

| Feature | Anthropic Native | OpenAI Format | Lost in Conversion |
|---------|------------------|---------------|-------------------|
| Extended Thinking | `thinking.budget_tokens` | ❌ Not supported | ✅ YES |
| Prompt Caching | `cache_control` markers | Different system | ✅ YES |
| Thinking Blocks | `type: "thinking"` | ❌ Not supported | ✅ YES |
| Cache Usage Metrics | `cache_creation_input_tokens`, `cache_read_input_tokens` | ❌ Not supported | ✅ YES |
| Thinking Token Metrics | `thinking_tokens` | ❌ Not supported | ✅ YES |
| Native Tool Results | Nested content blocks | Flattened | ✅ YES |

**Converting to OpenAI format loses 40-60% of Anthropic's capabilities.**

### 2. **Simpler, More Reliable Architecture**
- No format conversion bugs
- Single source of truth for types
- Easier to maintain and test
- Better performance (no conversion overhead)

### 3. **Type Safety**
- TypeScript types match Anthropic API exactly
- No runtime type mismatches
- Compile-time validation

## Supported Account Types

### ✅ Direct Anthropic (Recommended)
```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-api03-..."
}
```
- **Format**: Native Anthropic
- **Reliability**: Highest
- **Features**: 100% support
- **Use when**: You have Anthropic API keys

### ✅ Anthropic-Compatible Proxy (MITM Only)
```json
{
  "provider": "proxy",
  "apiKey": "your-key",
  "baseURL": "http://your-mitm-proxy:8080"
}
```
- **Format**: Native Anthropic (forwarded unchanged)
- **Reliability**: High (if proxy is true MITM)
- **Features**: 100% support
- **Use when**: You have a true MITM proxy that forwards Anthropic format unchanged

**CRITICAL**: Proxy MUST be a true man-in-the-middle proxy that:
- Forwards requests to Anthropic API unchanged
- Returns responses from Anthropic API unchanged
- Does NOT convert formats
- Does NOT modify request/response structure

### ✅ Kiro OAuth (New)
```json
{
  "provider": "kiro-oauth",
  "region": "us-east-1",
  "profileArn": "arn:aws:codewhisperer:..."
}
```
- **Format**: Native Anthropic (via OAuth 2.0 + PKCE)
- **Reliability**: High
- **Features**: 100% support
- **Use when**: You want free Claude access via Kiro OAuth

### ❌ NOT Supported: OpenAI-Format Proxies

**Examples of UNSUPPORTED proxies:**
- 9router (converts Anthropic → OpenAI)
- OpenRouter (OpenAI format)
- Any proxy that returns `{"choices": [...]}` format

**Why not supported:**
```json
// OpenAI format response (NOT SUPPORTED)
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Hello!"
      }
    }
  ]
}

// Anthropic format response (SUPPORTED)
{
  "id": "msg_123",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello!"
    }
  ],
  "usage": {
    "input_tokens": 10,
    "output_tokens": 5
  }
}
```

## What Happens If You Try to Use OpenAI Format?

ClaudeFlow will **immediately reject** the response with a clear error:

```
ERROR: Response is in OpenAI format (detected "choices" field).

ClaudeFlow only supports raw Anthropic format.

Your proxy/router is converting Anthropic format to OpenAI format,
which loses critical capabilities like:
- Extended thinking (thinking.budget_tokens)
- Prompt caching (cache_control markers)
- Thinking blocks and cache usage metrics

SOLUTION:
1. Use direct Anthropic API (recommended)
2. Use a true MITM proxy that forwards Anthropic format unchanged
3. Use Kiro OAuth for free Claude access

NOT SUPPORTED:
- 9router (converts to OpenAI format)
- OpenRouter (OpenAI format)
- Any proxy that returns OpenAI format
```

## Migration Guide: From OpenAI-Format Proxies

### If you're currently using 9router or similar:

#### Option 1: Switch to Direct Anthropic API (Recommended)
```bash
# Remove OpenAI-format proxy
claudeflow account remove <proxy-id>

# Add direct Anthropic account
claudeflow account add
# Select: "Direct Anthropic"
# Enter your Anthropic API key
```

**Benefits:**
- 100% feature support
- Highest reliability
- Best performance
- Official support

#### Option 2: Use Kiro OAuth (Free)
```bash
# Remove OpenAI-format proxy
claudeflow account remove <proxy-id>

# Add Kiro OAuth account
claudeflow account add
# Select: "Kiro OAuth"
# Follow OAuth flow
```

**Benefits:**
- Free Claude access
- 100% feature support
- Native Anthropic format

#### Option 3: Set Up True MITM Proxy
If you need a proxy for other reasons (logging, monitoring, etc.), set up a **true MITM proxy** that:

1. Forwards requests to Anthropic API unchanged
2. Returns responses from Anthropic API unchanged
3. Does NOT convert formats

**Example MITM proxy (Node.js):**
```javascript
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

app.post('/v1/messages', async (req, res) => {
  // Forward to Anthropic API unchanged
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    req.body,
    {
      headers: {
        'x-api-key': req.headers['x-api-key'],
        'anthropic-version': req.headers['anthropic-version'],
        'content-type': 'application/json',
      },
    }
  );
  
  // Return Anthropic response unchanged
  res.json(response.data);
});

app.listen(8080);
```

Then configure ClaudeFlow:
```bash
claudeflow account add
# Select: "Anthropic-Compatible Proxy"
# Base URL: http://localhost:8080
# API Key: your-anthropic-api-key
```

## Testing Your Proxy

Before adding a proxy account, test if it returns native Anthropic format:

```bash
# Test your proxy
curl http://your-proxy:8080/v1/messages \
  -H "x-api-key: your-key" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 10,
    "messages": [{"role": "user", "content": "test"}]
  }'
```

**Check the response:**

✅ **Valid Anthropic format** (will work):
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [...],
  "usage": {...}
}
```

❌ **Invalid OpenAI format** (will NOT work):
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [...]
}
```

## FAQ

### Q: Why not support both formats?
**A:** Supporting both formats would:
- Add complexity and maintenance burden
- Introduce format conversion bugs
- Lose Anthropic-specific capabilities in conversion
- Create confusion about which features work
- Require maintaining two parallel type systems

ClaudeFlow's value proposition is **preserving 100% of Anthropic capabilities**. Supporting OpenAI format would undermine this core principle.

### Q: Can I use OpenRouter?
**A:** No. OpenRouter uses OpenAI format, which is not supported.

### Q: Can I use 9router?
**A:** No. 9router converts Anthropic format to OpenAI format, which loses critical capabilities.

### Q: What if I need OpenAI format for other tools?
**A:** Use ClaudeFlow for Anthropic models (preserving full capabilities) and use OpenAI-compatible routers for OpenAI models. Don't mix them.

### Q: Will you ever support OpenAI format?
**A:** No. ClaudeFlow is designed specifically for Anthropic models with native Anthropic format. If you need OpenAI format, use a different router.

### Q: How do I know if my proxy is compatible?
**A:** Test it using the curl command above. If the response has `"type": "message"` and `"content": [...]`, it's compatible. If it has `"choices": [...]`, it's not.

### Q: What about backward compatibility with existing 9router setups?
**A:** Legacy Kiro accounts using 9router are marked as deprecated. Migrate to:
1. Direct Anthropic API
2. Kiro OAuth (new implementation)
3. True MITM proxy

## Summary

| Aspect | ClaudeFlow Approach |
|--------|-------------------|
| **Supported Format** | Native Anthropic ONLY |
| **OpenAI Format** | ❌ NOT supported |
| **Format Conversion** | ❌ NOT supported |
| **9router** | ❌ NOT supported |
| **OpenRouter** | ❌ NOT supported |
| **Direct Anthropic** | ✅ Fully supported |
| **True MITM Proxy** | ✅ Fully supported |
| **Kiro OAuth** | ✅ Fully supported |
| **Feature Preservation** | 100% |
| **Type Safety** | Full TypeScript support |

**Bottom line:** If it doesn't return native Anthropic format, it won't work with ClaudeFlow. This is by design.
