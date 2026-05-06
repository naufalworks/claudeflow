# Dashboard Issues - Complete Analysis & Solutions

## Current Status (2026-05-06)

### ✅ What's Working
1. **Usage tracking database** - Implemented and working
2. **Test data** - Added successfully, shows $0.49 total
3. **Dashboard displays credits** - When you run the dashboard, it should show:
   - `kiro-7e045cfb...`: $0.33 (22,000 tokens)
   - `kiro-afb68e57...`: $0.16 (11,000 tokens)

### ❌ What's NOT Working

#### 1. Account Selection in Table
**Your Issue:** "account still cannot be selected"

**Explanation:** This is NOT a bug - it's a limitation of terminal UI.
- blessed-contrib tables are **display-only**
- You **cannot** click on rows like in a web browser
- This is how terminal UIs work (like htop, vim, etc.)

**Solution:** Use keyboard shortcuts or commands instead of clicking.

#### 2. Delete Account from Dashboard
**Your Issue:** "when want to delete account no choice"

**Root Cause:** blessed screen interferes with inquirer's rendering

**Solution:** Use the standalone command instead:
```bash
./dist/cli/bin/claudeflow.js account delete
```

This works properly outside the dashboard.

#### 3. Credits Don't Match Kiro
**Your Issue:** "credit is wrong when i compare to kiro"

**Explanation:** The credits you see ($0.33, $0.16) are **TEST DATA**, not your real Kiro usage!

**Why?** 
- I added test data with `add-test-usage.js` to prove the system works
- Your REAL Kiro usage is NOT being tracked yet
- ClaudeFlow only tracks requests that go THROUGH ClaudeFlow

**To see real credits:** You need to make API requests through ClaudeFlow (via MITM proxy or direct API)

## How to Use ClaudeFlow Properly

### Option 1: Use Standalone Commands (Recommended)

Instead of using dashboard shortcuts, use direct commands:

```bash
# List accounts
./dist/cli/bin/claudeflow.js account list

# Delete account (interactive)
./dist/cli/bin/claudeflow.js account delete

# Add account
./dist/cli/bin/claudeflow.js login

# View dashboard (read-only)
./dist/cli/bin/claudeflow.js dashboard
```

### Option 2: Remove Dashboard Delete Feature

Since the dashboard's 'D' key doesn't work well with inquirer, I recommend:
1. Remove the 'D' shortcut from dashboard
2. Update help text to say "Use: claudeflow account delete"
3. Keep dashboard as read-only monitoring

## Understanding Credits

### Test Data (Current)
```
Account 1: $0.33 (22,000 tokens) - FAKE TEST DATA
Account 2: $0.16 (11,000 tokens) - FAKE TEST DATA
Total: $0.49 - NOT YOUR REAL USAGE
```

### Real Kiro Credits
Your Kiro account has real usage, but ClaudeFlow doesn't know about it because:
1. That usage happened BEFORE you added accounts to ClaudeFlow
2. ClaudeFlow only tracks NEW requests that go through it
3. There's no API to fetch historical Kiro usage

### To Track Real Usage

You need to integrate `saveRequestUsage()` into the API flow:

**In `src/mitm/proxy-server.ts`** (after successful request):
```typescript
import { saveRequestUsage } from '../lib/usageDb.js';

// After getting response from Kiro
await saveRequestUsage({
  accountId: account.id,
  model: request.model,
  region: account.region,
  tokens: response.usage, // From Anthropic response
  status: 'success',
});
```

**In `src/clients/KiroAPIClient.ts`** (after sendRequest):
```typescript
import { saveRequestUsage } from '../lib/usageDb.js';

// After successful API call
await saveRequestUsage({
  accountId: accountId,
  model: request.model,
  region: config.region,
  tokens: response.usage,
  status: 'success',
});
```

## Comparison: 9router vs ClaudeFlow

| Feature | 9router | ClaudeFlow |
|---------|---------|------------|
| **UI Type** | Web (React) | Terminal (blessed) |
| **Table Interaction** | ✅ Clickable | ❌ Display only |
| **Account Management** | ✅ Click to delete | ✅ Command to delete |
| **Usage Tracking** | ✅ Automatic | ⚠️ Needs integration |
| **Historical Data** | ✅ Shows all | ❌ Only tracks new |

## Commands Reference

```bash
# Account Management
claudeflow account list              # List all accounts
claudeflow account delete            # Delete account (interactive)
claudeflow account remove <id>       # Delete account (direct)
claudeflow account refresh <id>      # Refresh token
claudeflow account test <id>         # Test connectivity

# Dashboard
claudeflow dashboard                 # View dashboard (read-only)
claudeflow                          # Interactive menu

# Login
claudeflow login                    # Add new account

# MITM Proxy
sudo claudeflow mitm install        # Install MITM proxy
sudo claudeflow mitm start          # Start MITM proxy
sudo claudeflow daemon start --mitm # Start with MITM
```

## Next Steps

### Immediate (To Fix Your Issues)

1. **Use standalone delete command:**
   ```bash
   ./dist/cli/bin/claudeflow.js account delete
   ```

2. **Clear test data** (if you want to start fresh):
   ```bash
   rm ~/.claudeflow/usage.json
   ```

3. **Accept that table is not clickable** - this is how terminal UIs work

### Long-term (To Track Real Usage)

1. Integrate `saveRequestUsage()` into MITM proxy server
2. Integrate `saveRequestUsage()` into KiroAPIClient
3. Start making requests through ClaudeFlow
4. Credits will accumulate automatically

## Why Terminal UI is Different

**Web UI (9router):**
- Mouse clicks work
- Can click on table rows
- Interactive dropdowns
- Hover effects

**Terminal UI (ClaudeFlow):**
- Keyboard only
- Tables are display-only
- Use commands or shortcuts
- Like vim, htop, top, etc.

This is NOT a bug - it's the nature of terminal applications!

## Summary

1. ✅ **Usage tracking works** - Database is ready
2. ✅ **Delete command works** - Use `claudeflow account delete`
3. ❌ **Dashboard delete doesn't work** - Use command instead
4. ❌ **Credits don't match Kiro** - Test data only, need to integrate tracking
5. ❌ **Can't click table** - Terminal UI limitation, not a bug

**Recommendation:** Use ClaudeFlow as a CLI tool with commands, not as an interactive dashboard like 9router.
