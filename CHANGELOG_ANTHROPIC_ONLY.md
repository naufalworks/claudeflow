# ClaudeFlow: Strengthened Anthropic-Only Format Enforcement

## Summary of Changes

This update strengthens ClaudeFlow's core architectural principle: **100% native Anthropic format support only**. We've enhanced validation, error messages, and documentation to make it crystal clear that ClaudeFlow does NOT support OpenAI format or format conversion.

## What Changed

### 1. Enhanced Documentation

#### New: `docs/ANTHROPIC_FORMAT_ONLY.md`
Comprehensive guide explaining:
- Why ClaudeFlow only supports native Anthropic format
- What capabilities are lost with OpenAI format conversion (40-60%)
- Supported vs unsupported account types
- Migration guide from OpenAI-format proxies (9router, OpenRouter)
- Testing proxies for format compatibility
- FAQ addressing common questions

#### New: `docs/ARCHITECTURE.md`
Detailed system architecture documentation:
- Core design principle: native Anthropic format only
- Component-by-component breakdown
- Data flow examples (including rejection flow)
- Type system design
- Performance characteristics
- Security considerations

#### Updated: `README.md`
- Clarified that ClaudeFlow uses native format only
- Added CLI commands for adding accounts with validation
- Emphasized zero feature loss through format preservation

### 2. Enhanced Error Messages

#### `ResponseFormatValidator.ts`
Improved error messages when OpenAI format is detected:

**Before:**
```
Response is in OpenAI format (detected "choices" field).
ClaudeFlow only supports raw Anthropic format.
```

**After:**
```
❌ REJECTED: Response is in OpenAI format (detected "choices" field).

ClaudeFlow ONLY supports native Anthropic format. OpenAI format loses critical capabilities:
  • Extended thinking (thinking.budget_tokens)
  • Prompt caching (cache_control markers)
  • Thinking blocks and cache usage metrics

SOLUTION:
  1. Use direct Anthropic API (recommended)
  2. Use a true MITM proxy that forwards Anthropic format unchanged
  3. Use Kiro OAuth for free Claude access

NOT SUPPORTED:
  ❌ 9router (converts to OpenAI format)
  ❌ OpenRouter (OpenAI format)
  ❌ Any proxy that returns OpenAI format

See docs/ANTHROPIC_FORMAT_ONLY.md for migration guide.
```

#### `ProxyClient.ts`
Enhanced error messages with detailed validation errors:
- Shows all validation failures
- Provides actionable solutions
- Links to migration guide

#### `AnthropicClient.ts`
Improved error messages for unexpected format issues from direct Anthropic API.

### 3. New CLI Commands with Validation

#### `claudeflow add-anthropic`
Add direct Anthropic API accounts with validation:
```bash
# Interactive mode
claudeflow add-anthropic

# Non-interactive mode
claudeflow add-anthropic --api-key sk-ant-... --skip-validation
```

**Features:**
- Validates API key before adding
- Tests connection to Anthropic API
- Confirms native Anthropic format support
- Clear success/failure messages

#### `claudeflow add-proxy`
Add proxy accounts with format validation:
```bash
# Interactive mode
claudeflow add-proxy

# Non-interactive mode
claudeflow add-proxy --base-url http://localhost:8080 --api-key xxx
```

**Features:**
- **Validates proxy returns native Anthropic format**
- Tests connection before adding
- **Rejects OpenAI-format proxies with detailed error**
- Provides migration guidance if rejected
- Option to skip validation (not recommended)

**Validation flow:**
1. Send test request to proxy
2. Check response format
3. If OpenAI format detected → REJECT with detailed error
4. If Anthropic format confirmed → ADD account
5. If validation fails → Prompt user to continue or cancel

### 4. Updated Type System

No changes to types (already using discriminated unions), but enhanced documentation explaining the type safety benefits.

## Migration Guide for Users

### If you're currently using 9router or OpenAI-format proxies:

#### Option 1: Switch to Direct Anthropic API (Recommended)
```bash
# Remove OpenAI-format proxy
claudeflow account remove <proxy-id>

# Add direct Anthropic account
claudeflow add-anthropic
# Enter your Anthropic API key when prompted
```

**Benefits:**
- 100% feature support
- Highest reliability
- Best performance

#### Option 2: Use Kiro OAuth (Free)
```bash
# Remove OpenAI-format proxy
claudeflow account remove <proxy-id>

# Add Kiro OAuth account
claudeflow login
# Follow OAuth flow in browser
```

**Benefits:**
- Free Claude access
- 100% feature support
- Native Anthropic format

#### Option 3: Set Up True MITM Proxy
If you need a proxy for logging/monitoring, set up a **true MITM proxy** that forwards Anthropic format unchanged.

Example Node.js MITM proxy:
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

Then add to ClaudeFlow:
```bash
claudeflow add-proxy
# Base URL: http://localhost:8080
# API Key: your-anthropic-api-key
```

## Testing Your Setup

### Test if your proxy returns native Anthropic format:
```bash
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

## Breaking Changes

**None.** This update strengthens existing behavior with better error messages and validation. If you were already using:
- Direct Anthropic API → No changes needed
- Kiro OAuth → No changes needed
- True MITM proxy (Anthropic format) → No changes needed
- 9router or OpenAI-format proxy → Already not working, now with better error messages

## Benefits of This Update

### 1. Clearer Error Messages
Users immediately understand why their proxy was rejected and what to do next.

### 2. Proactive Validation
New `add-proxy` command validates format before adding, preventing runtime errors.

### 3. Better Documentation
Comprehensive guides explain the architectural decision and provide migration paths.

### 4. Stronger Type Safety
Enhanced documentation of discriminated unions and type guards.

### 5. Easier Onboarding
New users understand from the start that ClaudeFlow is Anthropic-only.

## Technical Details

### Validation Logic

The `ResponseFormatValidator` checks for:

**Required Anthropic fields:**
- `id: string` (starts with `msg_`)
- `type: "message"`
- `role: "assistant"`
- `content: ContentBlock[]`
- `model: string`
- `stop_reason: string | null`
- `usage: { input_tokens, output_tokens, ... }`

**Rejected OpenAI indicators:**
- `choices: []` field
- `object: "chat.completion"`
- Missing `type` field with `created` field present

### Error Handling Flow

```
1. Proxy returns response
2. ResponseFormatValidator.isAnthropicFormat(response)
3. If false:
   a. Get detailed errors via validateDetailed()
   b. Build comprehensive error message
   c. Include migration guide reference
   d. Throw ProxyClientError
4. If true:
   a. Continue processing
   b. Return to client
```

### CLI Command Flow

```
1. User runs: claudeflow add-proxy
2. Prompt for base URL and API key
3. Create ProxyClient instance
4. Call testConnection(apiKey, baseURL)
   a. Send test request
   b. Validate response format
   c. Return true/false
5. If validation fails:
   a. Show detailed error
   b. Prompt: "Add anyway?"
   c. If no → Cancel
   d. If yes → Add (not recommended)
6. If validation passes:
   a. Show success message
   b. Add account to config
   c. Display account details
```

## Files Changed

### New Files
- `docs/ANTHROPIC_FORMAT_ONLY.md` - Comprehensive format guide
- `docs/ARCHITECTURE.md` - System architecture documentation
- `src/cli/commands/anthropic-add.ts` - Add Anthropic accounts with validation
- `src/cli/commands/proxy-add.ts` - Add proxy accounts with validation

### Modified Files
- `src/clients/ResponseFormatValidator.ts` - Enhanced error messages
- `src/clients/ProxyClient.ts` - Detailed validation errors
- `src/clients/AnthropicClient.ts` - Improved error messages
- `src/cli/commands/index.ts` - Export new commands
- `src/cli/bin/claudeflow.ts` - Register new CLI commands
- `README.md` - Updated documentation links and account setup

## Next Steps

### For Users
1. Review `docs/ANTHROPIC_FORMAT_ONLY.md` to understand the format requirement
2. If using OpenAI-format proxies, migrate using the guide
3. Use new CLI commands for adding accounts with validation

### For Developers
1. Review `docs/ARCHITECTURE.md` for system design
2. When adding new account types, ensure native Anthropic format
3. Use `ResponseFormatValidator` for all external responses

## FAQ

**Q: Why not support both formats?**
A: Supporting both would require format conversion, which loses 40-60% of Anthropic's capabilities (thinking, caching, etc.). ClaudeFlow's value is preserving 100% of features.

**Q: Can I use 9router?**
A: No. 9router converts to OpenAI format, which loses critical capabilities.

**Q: Can I use OpenRouter?**
A: No. OpenRouter uses OpenAI format.

**Q: What if I need OpenAI format for other tools?**
A: Use ClaudeFlow for Anthropic models (preserving full capabilities) and use OpenAI-compatible routers for OpenAI models. Don't mix them.

**Q: Will you ever support OpenAI format?**
A: No. This is a core architectural principle that won't change.

## Conclusion

This update strengthens ClaudeFlow's commitment to preserving 100% of Anthropic's capabilities by maintaining native format throughout. The enhanced validation, error messages, and documentation make it clear that ClaudeFlow is purpose-built for Anthropic models with native Anthropic format.

**Bottom line:** If it doesn't return native Anthropic format, it won't work with ClaudeFlow. This is by design, and this update makes that crystal clear.
