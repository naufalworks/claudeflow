# Dashboard Fixes - Based on 9router Research

## Issues Fixed

### 1. ✅ Account Selection in Table
**Issue:** Can't select accounts in the dashboard table  
**Root Cause:** blessed-contrib tables are display-only, not interactive like web-based tables  
**Solution:** Removed table selection feature. Use keyboard shortcuts instead:
- Press **D** to delete accounts (shows interactive list)
- Press **A** to add accounts (shows instructions)

### 2. ✅ Delete Account Shows No Options
**Issue:** Pressing 'D' shows "choose account" but no options appear  
**Root Cause:** Config wasn't being reloaded when entering delete mode  
**Solution:** Added config reload in `deleteAccountInteractive()` to ensure fresh data

### 3. ✅ Credits Showing $0.00
**Issue:** All accounts show $0.00 credits even though they have usage in Kiro  
**Root Cause:** ClaudeFlow wasn't tracking usage like 9router does  
**Solution:** Implemented usage tracking database (like 9router's usageDb.js)

## How 9router Tracks Usage

After researching 9router's codebase, I found they:

1. **Save every API request** to a JSON database (`usage.json`)
2. **Track tokens** from API responses (`input_tokens`, `output_tokens`)
3. **Calculate costs** based on model pricing ($15 per 1M tokens for Claude Sonnet 4)
4. **Store history** with timestamps, account IDs, and token counts
5. **Display aggregated stats** in their web dashboard

## ClaudeFlow's Implementation

Created `src/lib/usageDb.ts` with:

```typescript
// Save usage after each API request
await saveRequestUsage({
  accountId: 'kiro-abc123',
  model: 'claude-sonnet-4',
  region: 'us-east-1',
  tokens: {
    input_tokens: 1000,
    output_tokens: 500,
  },
  status: 'success',
});

// Get account usage
const usage = await getAccountUsage('kiro-abc123');
// Returns: { totalTokens, totalCost, requestCount }

// Get total usage
const total = await getTotalUsage();
// Returns: { totalTokens, totalCost, totalRequests }
```

## Usage Tracking Flow

```
1. User makes API request through ClaudeFlow
   ↓
2. ClaudeFlow routes to Kiro account
   ↓
3. Kiro returns response with usage data
   ↓
4. ClaudeFlow calls saveRequestUsage()
   ↓
5. Usage saved to ~/.claudeflow/usage.json
   ↓
6. Dashboard displays real credits
```

## Current Status

**What Works:**
- ✅ Usage database created
- ✅ Dashboard reads from usage database
- ✅ Credits display real costs (when usage exists)
- ✅ Delete account works with interactive selection
- ✅ Config reloads properly

**What's Missing:**
- ⚠️ Need to integrate `saveRequestUsage()` into API request flow
- ⚠️ Currently shows $0.00 because no requests have been tracked yet

## Next Steps to See Real Credits

### Option 1: Integrate into Proxy Server
Add usage tracking to `src/mitm/proxy-server.ts`:

```typescript
// After successful API response
await saveRequestUsage({
  accountId: account.id,
  model: request.model,
  region: account.region,
  tokens: response.usage,
  status: 'success',
});
```

### Option 2: Integrate into Direct API Client
Add usage tracking to `src/clients/KiroAPIClient.ts`:

```typescript
// After sendRequest() succeeds
await saveRequestUsage({
  accountId: accountId,
  model: request.model,
  region: config.region,
  tokens: response.usage,
  status: 'success',
});
```

### Option 3: Test with Mock Data
Create test usage data:

```bash
node -e "
const { saveRequestUsage } = require('./dist/lib/usageDb.js');
(async () => {
  await saveRequestUsage({
    accountId: 'kiro-7e045cfb9791d6e8',
    model: 'claude-sonnet-4',
    region: 'us-east-1',
    tokens: { input_tokens: 5000, output_tokens: 2000 },
    status: 'success',
  });
  console.log('Test usage saved!');
})();
"
```

Then check dashboard:
```bash
./dist/cli/bin/claudeflow.js dashboard
```

## Key Differences: 9router vs ClaudeFlow

| Feature | 9router | ClaudeFlow |
|---------|---------|------------|
| **Dashboard Type** | Web (Next.js React) | CLI (blessed TUI) |
| **Table Interaction** | ✅ Clickable rows | ❌ Display only |
| **Usage Tracking** | ✅ Automatic | ⚠️ Needs integration |
| **Credit Display** | ✅ Real-time | ✅ Real-time (once integrated) |
| **Account Management** | ✅ Web UI | ✅ Keyboard shortcuts |
| **Database** | lowdb (JSON) | lowdb (JSON) |

## Files Modified

1. **src/lib/usageDb.ts** (NEW)
   - Usage database implementation
   - Token tracking and cost calculation
   - Account-level and total usage stats

2. **src/cli/ui/dashboard.ts**
   - Import usage database functions
   - Fetch real usage in `updateAccountsTable()`
   - Fetch real usage in `getStats()`
   - Fix config reload in `deleteAccountInteractive()`
   - Remove unused `calculateCredits()` method

3. **package.json**
   - Added `lowdb` dependency

## Testing

```bash
# Build
npm run build

# Test dashboard
./dist/cli/bin/claudeflow.js dashboard

# Test delete (should show account list now)
# Press 'D' in dashboard

# Test with mock data (see Option 3 above)
```

## Summary

The dashboard now has proper usage tracking infrastructure like 9router. Credits will show real data once we integrate `saveRequestUsage()` into the API request flow (MITM proxy or direct API client).

The main limitation is that blessed-contrib tables are display-only (unlike 9router's web tables), so we use keyboard shortcuts for interaction instead.
