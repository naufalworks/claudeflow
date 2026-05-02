# ClaudeFlow CLI Tool

Complete command-line interface for managing ClaudeFlow daemon, accounts, and analytics.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [Setup](#setup)
  - [Authentication](#authentication)
  - [Account Management](#account-management)
  - [Combo Management](#combo-management)
  - [Daemon Management](#daemon-management)
  - [Monitoring](#monitoring)
  - [Analytics](#analytics)
  - [Configuration](#configuration)
  - [Backup & Restore](#backup--restore)
- [Configuration File](#configuration-file)
- [Troubleshooting](#troubleshooting)

## Installation

### From npm (when published)

```bash
npm install -g claudeflow
```

### From source

```bash
git clone https://github.com/yourusername/claudeflow.git
cd claudeflow
npm install
npm run build
npm link
```

## Quick Start

### 1. Initial Setup

Run the interactive setup wizard:

```bash
claudeflow setup
```

This will guide you through:
- Kiro account configuration (Machine ID, API key)
- Infrastructure setup (Qdrant, Redis, Voyage AI)
- Connectivity verification
- Daemon configuration

### 2. Start the Daemon

```bash
claudeflow daemon start
```

### 3. Check Status

```bash
claudeflow daemon status
claudeflow health check
```

### 4. View Logs

```bash
claudeflow logs --follow
```

## Commands

### Setup

#### `claudeflow setup`

Interactive setup wizard for first-time configuration.

**Example:**
```bash
claudeflow setup
```

**What it does:**
- Prompts for Kiro account credentials
- Configures infrastructure URLs
- Verifies connectivity
- Saves configuration to `~/.claudeflow/config.json`
- Optionally starts the daemon

---

### Authentication

#### `claudeflow login`

Authenticate a Kiro account via OAuth.

**Options:**
- `--machine-id <id>` - Machine ID (non-interactive)
- `--api-key <key>` - API key (non-interactive)

**Examples:**
```bash
# Interactive mode
claudeflow login

# Non-interactive mode
claudeflow login --machine-id machine-123 --api-key sk-test-key
```

---

### Account Management

#### `claudeflow account add`

Add a new Kiro account.

**Example:**
```bash
claudeflow account add
```

**Prompts for:**
- Machine ID
- API key
- MITM router URL (optional)

#### `claudeflow account list`

List all configured accounts.

**Example:**
```bash
claudeflow account list
```

**Output:**
```
┌────────────┬──────────────┬────────────┬─────────────┬──────────────┐
│ Account ID │ Machine ID   │ Status     │ Last Used   │ Requests     │
├────────────┼──────────────┼────────────┼─────────────┼──────────────┤
│ account-1  │ machine-123  │ Active     │ 2 hours ago │ 1,234        │
│ account-2  │ machine-456  │ Expired    │ 1 day ago   │ 567          │
└────────────┴──────────────┴────────────┴─────────────┴──────────────┘
```

#### `claudeflow account show <account-id>`

Show detailed account information.

**Example:**
```bash
claudeflow account show account-1
```

#### `claudeflow account remove <account-id>`

Remove an account.

**Example:**
```bash
claudeflow account remove account-1
```

#### `claudeflow account refresh <account-id>`

Manually refresh account session.

**Example:**
```bash
claudeflow account refresh account-1
```

---

### Combo Management

#### `claudeflow combo create`

Create a new account combo for load balancing.

**Example:**
```bash
claudeflow combo create
```

**Prompts for:**
- Combo name
- Account selection (multi-select)
- Strategy (round-robin or sticky-round-robin)

#### `claudeflow combo list`

List all combos.

**Example:**
```bash
claudeflow combo list
```

#### `claudeflow combo show <combo-name>`

Show combo details.

**Example:**
```bash
claudeflow combo show my-combo
```

#### `claudeflow combo delete <combo-name>`

Delete a combo.

**Example:**
```bash
claudeflow combo delete my-combo
```

#### `claudeflow combo add-account <combo-name> <account-id>`

Add account to combo.

**Example:**
```bash
claudeflow combo add-account my-combo account-3
```

#### `claudeflow combo remove-account <combo-name> <account-id>`

Remove account from combo.

**Example:**
```bash
claudeflow combo remove-account my-combo account-3
```

---

### Daemon Management

#### `claudeflow daemon start`

Start the ClaudeFlow daemon.

**Example:**
```bash
claudeflow daemon start
```

#### `claudeflow daemon stop`

Stop the daemon.

**Example:**
```bash
claudeflow daemon stop
```

#### `claudeflow daemon restart`

Restart the daemon.

**Example:**
```bash
claudeflow daemon restart
```

#### `claudeflow daemon status`

Check daemon status.

**Example:**
```bash
claudeflow daemon status
```

**Output:**
```
┌──────────┬───────────┐
│ Property │ Value     │
├──────────┼───────────┤
│ Status   │ Running   │
│ PID      │ 12345     │
│ Uptime   │ 2h 15m    │
│ Memory   │ 145 MB    │
│ Port     │ 3000      │
└──────────┴───────────┘
```

#### `claudeflow autostart enable`

Enable daemon auto-start on system boot.

**Example:**
```bash
claudeflow autostart enable
```

**Platforms:**
- macOS: Creates launchd service
- Linux: Creates systemd service
- Windows: Not yet implemented

#### `claudeflow autostart disable`

Disable auto-start.

**Example:**
```bash
claudeflow autostart disable
```

#### `claudeflow autostart status`

Check auto-start status.

**Example:**
```bash
claudeflow autostart status
```

---

### Monitoring

#### `claudeflow logs`

View daemon logs.

**Options:**
- `--follow, -f` - Follow log output in real-time
- `--lines, -n <number>` - Number of lines to display (default: 100)
- `--level <level>` - Filter by log level (debug, info, warn, error)
- `--clear` - Clear old logs

**Examples:**
```bash
# View last 100 lines
claudeflow logs

# Follow logs in real-time
claudeflow logs --follow

# Show last 50 lines
claudeflow logs --lines 50

# Show only errors
claudeflow logs --level error

# Clear old logs
claudeflow logs --clear
```

#### `claudeflow health check`

Check health of all infrastructure components.

**Example:**
```bash
claudeflow health check
```

**Output:**
```
┌────────────────┬─────────┬──────────────┬──────────────┐
│ Component      │ Status  │ Response Time│ Details      │
├────────────────┼─────────┼──────────────┼──────────────┤
│ Qdrant         │ ✓       │ 45ms         │ 3 collections│
│ Redis          │ ✓       │ 12ms         │ v7.0.0       │
│ Voyage AI      │ ✓       │ 234ms        │ 5 models     │
│ MITM Router    │ ✓       │ 89ms         │ Connected    │
│ Anthropic API  │ ✓       │ 156ms        │ Reachable    │
└────────────────┴─────────┴──────────────┴──────────────┘
```

#### `claudeflow health test`

Run end-to-end test through ClaudeFlow.

**Example:**
```bash
claudeflow health test
```

#### `claudeflow quota show`

Display quota usage with progress bars.

**Options:**
- `--account <account-id>` - Show quota for specific account

**Example:**
```bash
claudeflow quota show
```

**Output:**
```
Account: account-1
Requests per minute: [████████░░] 80/100 (80%)
Tokens per day:      [██████░░░░] 60K/100K (60%)
Cost per day:        [███░░░░░░░] $3.45/$10.00 (34.5%)

Estimated reset: 4 hours 23 minutes
```

#### `claudeflow quota watch`

Watch quota in real-time (refreshes every 5 seconds).

**Example:**
```bash
claudeflow quota watch
```

#### `claudeflow session`

Display session status for all accounts.

**Example:**
```bash
claudeflow session
```

**Output:**
```
┌────────────┬──────────────┬────────────┬─────────────────┬───────────────┐
│ Account ID │ Machine ID   │ Status     │ Expires         │ Needs Refresh │
├────────────┼──────────────┼────────────┼─────────────────┼───────────────┤
│ account-1  │ machine-123  │ Active     │ in 2 hours      │ No            │
│ account-2  │ machine-456  │ Expiring   │ in 3 minutes    │ Yes           │
│ account-3  │ machine-789  │ Expired    │ 5 minutes ago   │ Yes           │
└────────────┴──────────────┴────────────┴─────────────────┴───────────────┘

Summary: 1 Active, 1 Expiring Soon, 1 Expired
```

---

### Analytics

#### `claudeflow analytics show`

Display analytics summary.

**Options:**
- `--range <range>` - Time range: 24h, 7d, 30d (default: 24h)
- `--detailed` - Show detailed breakdown

**Examples:**
```bash
# Show 24-hour summary
claudeflow analytics show

# Show 7-day summary
claudeflow analytics show --range 7d

# Show detailed breakdown
claudeflow analytics show --detailed
```

**Output:**
```
Analytics Summary (Last 24 hours)

Total Requests:    1,234
Total Cost:        $12.45
Total Tokens:      456,789
Avg Response Time: 1.2s
Cache Hit Rate:    78.5%
Error Rate:        0.8%

Cost by Model:
  claude-3-5-sonnet-20241022: $8.90 (71.5%)
  claude-3-opus-20240229:     $3.55 (28.5%)

Requests by Complexity:
  simple:  890 (72.1%)
  complex: 344 (27.9%)

Top Insights:
  ✓ Excellent cache performance (78.5% hit rate)
  ⚠ High API costs ($12.45 in 24h)
  ℹ Fast response times (1.2s average)
```

#### `claudeflow analytics export`

Export analytics data.

**Options:**
- `--format <format>` - Export format: json or csv (default: json)
- `--output <path>` - Output file path
- `--range <range>` - Time range: 24h, 7d, 30d (default: 24h)

**Examples:**
```bash
# Export to JSON
claudeflow analytics export --output analytics.json

# Export to CSV
claudeflow analytics export --format csv --output analytics.csv

# Export 7-day data
claudeflow analytics export --range 7d --output weekly.json
```

---

### Configuration

#### `claudeflow config show`

Display current configuration.

**Example:**
```bash
claudeflow config show
```

**Output:**
```json
{
  "version": "0.1.0",
  "activeProfile": "default",
  "daemon": {
    "port": 3000,
    "host": "localhost",
    "logLevel": "info",
    "autoRestart": true
  },
  "infrastructure": {
    "qdrantUrl": "http://localhost:6333",
    "redisUrl": "redis://localhost:6379",
    "voyageApiKey": "***",
    "mitmRouterUrl": "http://3.68.219.151:20128"
  },
  "preferences": {
    "colorOutput": true,
    "progressBars": true,
    "autoUpdate": false
  }
}
```

#### `claudeflow config set <key> <value>`

Update configuration value.

**Examples:**
```bash
# Set daemon port
claudeflow config set daemon.port 4000

# Set log level
claudeflow config set daemon.logLevel debug

# Disable color output
claudeflow config set preferences.colorOutput false
```

#### `claudeflow config reset`

Reset configuration to defaults.

**Example:**
```bash
claudeflow config reset
```

#### `claudeflow profile create <name>`

Create a new profile.

**Example:**
```bash
claudeflow profile create production
```

#### `claudeflow profile list`

List all profiles.

**Example:**
```bash
claudeflow profile list
```

**Output:**
```
Available Profiles:
  * default (active)
    production
    development
```

#### `claudeflow profile switch <name>`

Switch to a different profile.

**Example:**
```bash
claudeflow profile switch production
```

#### `claudeflow profile delete <name>`

Delete a profile.

**Example:**
```bash
claudeflow profile delete development
```

---

### Backup & Restore

#### `claudeflow backup create`

Create a backup of configuration and data.

**Example:**
```bash
claudeflow backup create
```

**Output:**
```
✓ Backup created: backup-2026-05-02-140915.tar.gz
  Location: ~/.claudeflow/backups/
  Size: 2.3 MB
```

#### `claudeflow backup list`

List all backups.

**Example:**
```bash
claudeflow backup list
```

**Output:**
```
┌──────────────────────────────────┬─────────────────────┬──────────┐
│ Backup                           │ Created             │ Size     │
├──────────────────────────────────┼─────────────────────┼──────────┤
│ backup-2026-05-02-140915.tar.gz  │ 2026-05-02 14:09:15 │ 2.3 MB   │
│ backup-2026-05-01-093045.tar.gz  │ 2026-05-01 09:30:45 │ 2.1 MB   │
└──────────────────────────────────┴─────────────────────┴──────────┘
```

#### `claudeflow backup restore <backup-name>`

Restore from a backup.

**Example:**
```bash
claudeflow backup restore backup-2026-05-02-140915.tar.gz
```

#### `claudeflow backup export <backup-name> <output-path>`

Export backup to a specific location.

**Example:**
```bash
claudeflow backup export backup-2026-05-02-140915.tar.gz /path/to/export/
```

#### `claudeflow backup import <backup-path>`

Import backup from external file.

**Example:**
```bash
claudeflow backup import /path/to/backup.tar.gz
```

---

## Configuration File

Configuration is stored in `~/.claudeflow/config.json`.

### Structure

```json
{
  "version": "0.1.0",
  "activeProfile": "default",
  "accounts": [
    {
      "id": "account-1",
      "machineId": "machine-123",
      "apiKey": "sk-test-key",
      "sessionToken": "session-token-123",
      "sessionExpiry": 1714665600000,
      "mitmRouterUrl": "http://3.68.219.151:20128",
      "lastUsed": 1714662000000,
      "requestCount": 1234
    }
  ],
  "combos": [
    {
      "name": "my-combo",
      "accounts": ["account-1", "account-2"],
      "strategy": "round-robin",
      "currentIndex": 0
    }
  ],
  "infrastructure": {
    "qdrantUrl": "http://localhost:6333",
    "redisUrl": "redis://localhost:6379",
    "voyageApiKey": "voyage-api-key",
    "mitmRouterUrl": "http://3.68.219.151:20128"
  },
  "daemon": {
    "port": 3000,
    "host": "localhost",
    "logLevel": "info",
    "autoRestart": true
  },
  "preferences": {
    "colorOutput": true,
    "progressBars": true,
    "autoUpdate": false
  }
}
```

### Directory Structure

```
~/.claudeflow/
├── config.json           # Main configuration
├── analytics.db          # SQLite analytics database
├── logs/
│   ├── cli.log          # CLI logs
│   ├── daemon.log       # Daemon logs
│   └── daemon-error.log # Daemon error logs
├── profiles/
│   ├── production.json  # Production profile
│   └── development.json # Development profile
└── backups/
    └── backup-*.tar.gz  # Backup archives
```

---

## Troubleshooting

### Daemon won't start

**Check if already running:**
```bash
claudeflow daemon status
```

**Check logs:**
```bash
claudeflow logs --level error
```

**Verify infrastructure:**
```bash
claudeflow health check
```

**Common issues:**
- Port 3000 already in use → Change port: `claudeflow config set daemon.port 4000`
- Redis not running → Start Redis: `redis-server`
- Qdrant not running → Start Qdrant: `docker run -p 6333:6333 qdrant/qdrant`

### Session expired

**Refresh session:**
```bash
claudeflow account refresh <account-id>
```

**Or re-authenticate:**
```bash
claudeflow login
```

### High error rate

**Check analytics:**
```bash
claudeflow analytics show --detailed
```

**Check logs:**
```bash
claudeflow logs --level error --lines 50
```

**Run health check:**
```bash
claudeflow health check
```

### Quota exceeded

**Check current usage:**
```bash
claudeflow quota show
```

**Add more accounts:**
```bash
claudeflow account add
```

**Create combo for load balancing:**
```bash
claudeflow combo create
```

### Configuration issues

**Reset to defaults:**
```bash
claudeflow config reset
```

**Or restore from backup:**
```bash
claudeflow backup restore <backup-name>
```

### Can't connect to infrastructure

**Verify URLs:**
```bash
claudeflow config show
```

**Test connectivity:**
```bash
claudeflow health check
```

**Update URLs:**
```bash
claudeflow config set infrastructure.qdrantUrl http://localhost:6333
claudeflow config set infrastructure.redisUrl redis://localhost:6379
```

---

## Global Options

All commands support these global options:

- `--help, -h` - Show help
- `--version, -v` - Show version
- `--debug` - Enable debug output

**Examples:**
```bash
claudeflow --version
claudeflow daemon start --help
claudeflow --debug health check
```

---

## Environment Variables

- `CLAUDEFLOW_CONFIG_DIR` - Override config directory (default: `~/.claudeflow`)
- `CLAUDEFLOW_LOG_LEVEL` - Override log level (default: `info`)

**Example:**
```bash
export CLAUDEFLOW_CONFIG_DIR=/custom/path
export CLAUDEFLOW_LOG_LEVEL=debug
claudeflow daemon start
```

---

## Support

For issues and questions:
- GitHub Issues: https://github.com/yourusername/claudeflow/issues
- Documentation: https://github.com/yourusername/claudeflow/docs

---

## License

MIT License - see LICENSE file for details
