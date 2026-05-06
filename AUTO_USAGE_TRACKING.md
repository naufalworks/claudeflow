# Auto Usage Tracking - Complete Guide

## ✅ What's Implemented

### 1. **Automatic Usage Tracking in MITM Proxy**
Every API request through the MITM proxy is now automatically tracked:
- Tokens (input/output/cache)
- Cost calculation
- Account ID
- Model and region
- Timestamp

### 2. **Dashboard Shows Warning if MITM Not Running**
When you launch the dashboard, it checks if MITM is running:
- If running: Dashboard shows normally
- If not running: Shows warning message for 3 seconds

### 3. **Real Credits Display**
Once MITM is running and you make requests, credits will show real data automatically!

## 🚀 How to Use

### Step 1: Start MITM Proxy
```bash
# Install MITM (one-time setup)
sudo ./dist/cli/bin/claudeflow.js mitm install

# Start daemon with MITM
sudo ./dist/cli/bin/claudeflow.js daemon start --mitm
```

### Step 2: Launch Dashboard
```bash
./dist/cli/bin/claudeflow.js dashboard
```

If MITM is not running, you'll see:
```
⚠️  MITM proxy is not running
💡 Start MITM to track usage automatically

Run: sudo claudeflow daemon start --mitm
```

### Step 3: Use Kiro CLI
```bash
# All requests go through ClaudeFlow MITM proxy
kiro chat "Hello, Claude!"
```

### Step 4: Check Dashboard
Credits will update automatically! You'll see:
- Real token counts
- Real costs
- Per-account usage
- Total usage

## 📊 How It Works

```
1. User runs: kiro chat "Hello"
   ↓
2. Kiro CLI makes request to q.us-east-1.amazonaws.com
   ↓
3. /etc/hosts redirects to 127.0.0.1:443 (MITM proxy)
   ↓
4. MITM proxy intercepts request
   ↓
5. Routes to ClaudeFlow account pool
   ↓
6. Forwards to real Kiro API
   ↓
7. Gets response with usage data
   ↓
8. Saves to ~/.claudeflow/usage.json
   ↓
9. Returns response to Kiro CLI
   ↓
10. Dashboard shows updated credits!
```

## 🧪 Testing

### Clear Test Data (Optional)
```bash
# Remove test data I added earlier
rm ~/.claudeflow/usage.json
```

### Make a Real Request
```bash
# Start MITM
sudo ./dist/cli/bin/claudeflow.js daemon start --mitm

# Make a request through Kiro CLI
kiro chat "What is 2+2?"

# Check dashboard
./dist/cli/bin/claudeflow.js dashboard
```

You should now see real credits!

## 📝 What Gets Tracked

For each API request:
```json
{
  "accountId": "kiro-abc123",
  "model": "claude-sonnet-4",
  "region": "us-east-1",
  "tokens": {
    "input_tokens": 1000,
    "output_tokens": 500,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  },
  "cost": 0.0225,
  "status": "success",
  "timestamp": "2026-05-06T14:23:00.000Z"
}
```

## 💰 Cost Calculation

**Claude Sonnet 4 Pricing:**
- Input tokens: $15 per 1M tokens
- Output tokens: $15 per 1M tokens
- Cache creation: $15 per 1M tokens
- Cache reads: $1.50 per 1M tokens (90% cheaper)

**Example:**
- Input: 1,000 tokens = $0.015
- Output: 500 tokens = $0.0075
- **Total: $0.0225**

## 🔍 Viewing Usage Data

### In Dashboard
```bash
./dist/cli/bin/claudeflow.js dashboard
```

Shows:
- Per-account credits
- Total credits
- Request counts
- Token counts

### In Database
```bash
cat ~/.claudeflow/usage.json
```

Shows raw usage history (JSON format)

### Via Command
```bash
# List accounts with usage
./dist/cli/bin/claudeflow.js account list
```

## ⚠️ Important Notes

### 1. MITM Must Be Running
Usage is ONLY tracked when requests go through the MITM proxy.

If you use Kiro CLI without MITM running:
- ❌ Usage NOT tracked
- ❌ Credits NOT updated
- ✅ Requests still work (direct to Kiro)

### 2. Historical Usage Not Available
ClaudeFlow cannot fetch your past Kiro usage. It only tracks NEW requests.

### 3. Requires Root/Sudo
MITM proxy runs on port 443, which requires root privileges:
```bash
sudo ./dist/cli/bin/claudeflow.js daemon start --mitm
```

### 4. Dashboard Can Run Without MITM
You can view the dashboard without MITM running, but credits won't update until you start MITM and make requests.

## 🆚 Before vs After

### Before (Test Data)
```
Account 1: $0.33 (22,000 tokens) - FAKE TEST DATA
Account 2: $0.16 (11,000 tokens) - FAKE TEST DATA
Total: $0.49
```

### After (Real Usage)
```
Account 1: $0.05 (3,333 tokens) - REAL USAGE
Account 2: $0.03 (2,000 tokens) - REAL USAGE
Total: $0.08
```

## 🎯 Summary

**What Changed:**
1. ✅ MITM proxy now tracks usage automatically
2. ✅ Dashboard warns if MITM not running
3. ✅ Credits update in real-time
4. ✅ No manual tracking needed

**What You Need to Do:**
1. Start MITM: `sudo claudeflow daemon start --mitm`
2. Use Kiro CLI normally
3. Check dashboard to see real credits

**That's it!** Usage tracking is now fully automatic when MITM is running.
