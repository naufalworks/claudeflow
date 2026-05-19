# Quick Start Guide - ClaudeFlow Web UI

## Prerequisites

Before starting the web UI, you need:
1. **ClaudeFlow API server** running on port 20129
2. **Node.js 18+** installed

---

## Step 1: Start the ClaudeFlow API Server

In the main project directory:

```bash
cd /Users/azfar.naufal/Documents/router/claudeflow
npm run dev
```

This starts:
- API server on `http://localhost:20129`
- WebSocket server on `ws://localhost:8080`

**Keep this terminal running.**

---

## Step 2: Start the Web UI

Open a **new terminal** and run:

```bash
cd /Users/azfar.naufal/Documents/router/claudeflow/web
npm install  # First time only
npm run dev
```

The web UI will start on `http://localhost:3001`

---

## Step 3: Access the Dashboard

1. Open your browser to: **http://localhost:3001**

2. You'll see the login page. Enter your API key.
   - If you don't have an API key yet, check the ClaudeFlow API server logs or configuration

3. After login, you'll see the dashboard with:
   - Account cards showing status and quota
   - Real-time activity stream
   - Metrics bar at the top

---

## Quick Commands

### Start Everything (2 terminals)

**Terminal 1 - API Server:**
```bash
cd /Users/azfar.naufal/Documents/router/claudeflow
npm run dev
```

**Terminal 2 - Web UI:**
```bash
cd /Users/azfar.naufal/Documents/router/claudeflow/web
npm run dev
```

### Access Points
- **Web UI:** http://localhost:3001
- **API:** http://localhost:20129
- **WebSocket:** ws://localhost:8080

---

## Keyboard Shortcuts

Once logged in, try these:
- **Cmd/Ctrl + K** - Open command palette
- **?** - Show all keyboard shortcuts
- **A** - Add account
- **T** - Test account
- **D** - Toggle dashboard/analytics

---

## Troubleshooting

### "Cannot connect to API"
- Make sure the API server is running on port 20129
- Check: `curl http://localhost:20129/health`

### "WebSocket connection failed"
- Make sure the WebSocket server is running on port 8080
- Check ClaudeFlow API server logs

### "Invalid API key"
- Get your API key from the ClaudeFlow configuration
- Or generate a new one in the API server settings

---

## Next Steps

After logging in:
1. **View Accounts** - See all your Claude API accounts
2. **Check Analytics** - View token usage and cost charts
3. **Monitor Activity** - Watch real-time API requests
4. **Configure Settings** - Adjust routing strategy and preferences

---

## Production Deployment

For production deployment, see:
- `/web/DEPLOYMENT.md` - Full deployment guide
- `/web/ARCHITECTURE.md` - Technical architecture

---

**Need help?** Check `/web/README.md` for detailed documentation.
