# Usage Tracking Migration Guide

## Migrating from JSON to SQLite Time-Series Storage

This guide covers migrating from the legacy JSON-based usage tracking system
(`~/.claudeflow/usage.json`) to the new SQLite-backed time-series storage
(`~/.claudeflow/usage.db`).

---

## Table of Contents

1. [Migration Overview](#migration-overview)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Migration Steps](#migration-steps)
4. [Breaking Changes](#breaking-changes)
5. [Rollback Procedure](#rollback-procedure)
6. [Troubleshooting](#troubleshooting)

---

## Migration Overview

### What's Changing

| Aspect             | Old System               | New System                        |
| ------------------ | ------------------------ | --------------------------------- |
| **Storage**        | JSON file (`usage.json`) | SQLite database (`usage.db`)      |
| **Format**         | Plain JSON array         | Indexed tables with aggregations  |
| **Query Speed**    | O(n) full scan           | O(log n) indexed queries          |
| **Data Retention** | Manual cleanup           | Automatic (30/90/indefinite days) |
| **Aggregations**   | None                     | Pre-computed hourly and daily     |
| **Scalability**    | Degrades over time       | Consistent performance            |
| **Real-time**      | File polling             | WebSocket push updates            |
| **Cost Tracking**  | Basic                    | Full token-type breakdown         |

### What Data Is Migrated

| Data Field                           | Migrated?        | Notes                                    |
| ------------------------------------ | ---------------- | ---------------------------------------- |
| `timestamp`                          | ✅ Yes           | Converted to Unix milliseconds           |
| `accountId`                          | ✅ Yes           | Stored as `account_id`                   |
| `model`                              | ✅ Yes           | Preserved exactly                        |
| `region`                             | ✅ Yes           | Preserved exactly                        |
| `tokens.input_tokens`                | ✅ Yes           | Stored as `input_tokens`                 |
| `tokens.output_tokens`               | ✅ Yes           | Stored as `output_tokens`                |
| `tokens.cache_creation_input_tokens` | ✅ Yes           | Stored as `cache_creation_tokens`        |
| `tokens.cache_read_input_tokens`     | ✅ Yes           | Stored as `cache_read_tokens`            |
| `cost`                               | ✅ Yes           | Preserved exactly                        |
| `status`                             | ✅ Yes           | Preserved exactly                        |
| `latency`                            | ⚠️ Default       | Not tracked in old system; set to `0`    |
| `error_code`                         | ⚠️ Not available | Not tracked in old system; set to `null` |

### Estimated Migration Time

| Events           | Estimated Time |
| ---------------- | -------------- |
| < 1,000          | < 1 second     |
| 1,000 - 10,000   | 1-3 seconds    |
| 10,000 - 100,000 | 3-10 seconds   |
| > 100,000        | 10-60 seconds  |

Migration uses SQLite transactions for data integrity. All events are inserted
in a single transaction, so the operation is atomic.

---

## Pre-Migration Checklist

### System Requirements

- [ ] **Node.js** >= 18.0.0
- [ ] **Disk space**: At least 2x the size of your current `usage.json` file
- [ ] **ClaudeFlow** installed and built (`npm run build`)
- [ ] **Backup location** identified (default: same directory as source file)

### Verify Current State

```bash
# Check if usage.json exists and its size
ls -lh ~/.claudeflow/usage.json

# Check number of events in the file
cat ~/.claudeflow/usage.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Events: {len(d.get(\"history\", []))}')"

# Check available disk space
df -h ~/.claudeflow/
```

### Backup Instructions

The migration script automatically creates a backup, but for extra safety:

```bash
# Manual backup before migration
cp ~/.claudeflow/usage.json ~/.claudeflow/usage.json.manual-backup

# Verify backup
ls -lh ~/.claudeflow/usage.json*
```

### Verification Steps

Before starting migration, ensure:

1. **No active daemon is running** — the daemon should be stopped to prevent
   data writes during migration.
2. **usage.json is valid JSON** — run `python3 -m json.tool ~/.claudeflow/usage.json`
   to verify.
3. **Sufficient disk space** — at least 2x the size of `usage.json`.

---

## Migration Steps

### Step 1: Stop ClaudeFlow Daemon

Ensure no processes are writing to the usage data files:

```bash
# Check if daemon is running
claudeflow daemon status

# Stop daemon if running
claudeflow daemon stop

# Verify no claudeflow processes remain
ps aux | grep claudeflow
```

### Step 2: Backup Existing Data

The migration script creates an automatic backup, but we recommend a manual
backup as well:

```bash
# Create timestamped backup
cp ~/.claudeflow/usage.json ~/.claudeflow/usage.json.pre-migration-$(date +%Y%m%d%H%M%S)
```

### Step 3: Run Migration

#### Option A: Using the Migration Script (Recommended)

```bash
# Default migration (reads from ~/.claudeflow/usage.json)
npx tsx src/tracking/migrate.ts

# With custom paths
npx tsx src/tracking/migrate.ts --input /path/to/usage.json --output /path/to/usage.db

# Dry run (validate without writing)
npx tsx src/tracking/migrate.ts --dry-run

# With custom backup directory
npx tsx src/tracking/migrate.ts --backup-dir /path/to/backups
```

#### Option B: Using the API Programmatically

```typescript
import { TimeSeriesStorage } from './TimeSeriesStorage.js';

const storage = new TimeSeriesStorage({
  databasePath: '~/.claudeflow/usage.db',
});

const result = storage.migrateFromJSON('~/.claudeflow/usage.json');

if (result.success) {
  console.log(`Migrated ${result.migratedEvents} events`);
  console.log(`Backup at: ${result.backupPath}`);
} else {
  console.error('Migration failed:', result.errors);
}

storage.close();
```

### Step 4: Verify Migration

After migration completes, verify the data:

```bash
# Check the new database exists
ls -lh ~/.claudeflow/usage.db

# Quick sanity check using sqlite3
sqlite3 ~/.claudeflow/usage.db "SELECT COUNT(*) as total_events FROM usage_events;"

# Compare counts with old JSON
cat ~/.claudeflow/usage.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'JSON events: {len(d.get(\"history\", []))}')"
```

### Step 5: Start New System

```bash
# Start the daemon with the new tracking system
claudeflow daemon start --mitm

# Launch dashboard to verify data
claudeflow dashboard
```

### Step 6: Confirm Everything Works

Verify the migration was successful:

1. **Dashboard loads** — shows historical data from the migrated events.
2. **New requests are tracked** — make a test request and confirm it appears.
3. **Real-time updates work** — dashboard updates without manual refresh.
4. **Account selection works** — requests are routed based on quota ranking.

---

## Breaking Changes

### API Changes

#### Old System: `saveRequestUsage()`

```typescript
// Old: Direct file write
await saveRequestUsage({
  accountId: account.id,
  model: requestData.model,
  region: apiConfig.region,
  tokens: response.usage,
  status: 'success',
});
```

#### New System: `UsageTrackingManager.trackRequest()`

```typescript
// New: Professional tracking with cost calculation, events, and caching
await usageTrackingManager.trackRequest({
  accountId: account.id,
  model: requestData.model,
  region: apiConfig.region,
  tokens: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens,
  },
  latency: Date.now() - startTime,
  status: 'success',
  timestamp: new Date(),
});
```

**Key differences:**

| Aspect            | Old                         | New                         |
| ----------------- | --------------------------- | --------------------------- |
| Function name     | `saveRequestUsage()`        | `trackRequest()`            |
| Token field names | `input_tokens` (snake_case) | `inputTokens` (camelCase)   |
| Latency tracking  | Not available               | Required field              |
| Cost calculation  | Manual / pre-computed       | Automatic via pricing model |
| Error handling    | Throws on failure           | Logs error, continues       |
| Real-time updates | None                        | WebSocket event emitted     |

### Configuration Changes

New configuration section added to `~/.claudeflow/config.json`:

```json
{
  "usageTracking": {
    "enabled": true,
    "database": "~/.claudeflow/usage.db",
    "aggregationInterval": 3600,
    "retentionDays": 90
  },
  "realTimeUpdates": {
    "enabled": true,
    "port": 8080,
    "batchInterval": 100,
    "maxBatchSize": 10
  },
  "quotaManagement": {
    "enabled": true,
    "checkInterval": 60,
    "predictiveEnabled": true
  },
  "auditLogging": {
    "enabled": true,
    "logDir": "~/.claudeflow/logs",
    "rotationInterval": "daily",
    "retentionDays": 90
  }
}
```

If these settings are missing from your config, sensible defaults are used.

### Data File Changes

| Old File                   | New File                     | Notes                                |
| -------------------------- | ---------------------------- | ------------------------------------ |
| `~/.claudeflow/usage.json` | `~/.claudeflow/usage.db`     | SQLite database replaces JSON        |
| N/A                        | `~/.claudeflow/usage.db-wal` | Write-ahead log (SQLite WAL mode)    |
| N/A                        | `~/.claudeflow/usage.db-shm` | Shared memory file (SQLite WAL mode) |

> **Note:** The WAL and SHM files are managed automatically by SQLite. Do not
> delete them while the system is running.

### Behavior Changes

| Behavior          | Old System                 | New System                            |
| ----------------- | -------------------------- | ------------------------------------- |
| Data growth       | Unbounded JSON file        | Automatic cleanup by retention policy |
| Query performance | Degrades with file size    | Consistent via indexes                |
| Dashboard refresh | Manual / polling           | Real-time WebSocket push              |
| Account selection | Round-robin / random       | Quota-aware intelligent ranking       |
| Error recovery    | Data loss on write failure | Fallback queue with retries           |
| Logging           | Console only               | Structured audit logs with rotation   |

---

## Rollback Procedure

If you need to revert to the old system after migration:

### Step 1: Stop New System

```bash
# Stop daemon
claudeflow daemon stop
```

### Step 2: Restore from Backup

```bash
# The migration script creates an automatic backup
ls ~/.claudeflow/usage.json.backup

# Restore the original file
cp ~/.claudeflow/usage.json.backup ~/.claudeflow/usage.json

# Or use your manual backup
cp ~/.claudeflow/usage.json.pre-migration-YYYYMMDDHHMMSS ~/.claudeflow/usage.json
```

### Step 3: Remove New Database

```bash
# Remove the SQLite database (optional - can keep for reference)
rm ~/.claudeflow/usage.db
rm -f ~/.claudeflow/usage.db-wal
rm -f ~/.claudeflow/usage.db-shm
```

### Step 4: Revert to Old System

```bash
# Use the previous version of ClaudeFlow that reads from JSON
# Or switch to the old tracking code path
```

### Important Notes on Rollback

- **Data created after migration** in the SQLite database will NOT be available
  in the old system.
- **Rollback is only recommended** if migration failed or critical issues are
  discovered immediately after migration.
- The backup file at `usage.json.backup` is never deleted automatically.
- If you ran the migration multiple times, the backup reflects the state before
  the LAST migration run (idempotent behavior means no duplicates).

---

## Troubleshooting

### "JSON file not found"

**Cause:** The migration script cannot find `~/.claudeflow/usage.json`.

**Solution:**

- Verify the file exists: `ls -la ~/.claudeflow/usage.json`
- If you don't have a usage.json file, there's nothing to migrate. The new
  system will create the database automatically on first use.

### "Invalid JSON format: missing history array"

**Cause:** The JSON file exists but doesn't have the expected `{ "history": [...] }`
structure.

**Solution:**

- Check the file format: `head -20 ~/.claudeflow/usage.json`
- The expected format is:
  ```json
  {
    "history": [
      {
        "timestamp": "2024-01-15T10:30:00.000Z",
        "accountId": "kiro-abc123",
        "model": "claude-sonnet-4",
        "region": "us-east-1",
        "tokens": { "input_tokens": 1000, "output_tokens": 500 },
        "cost": 0.0225,
        "status": "success"
      }
    ]
  }
  ```

### "Migration failed: Cannot read properties of undefined"

**Cause:** Some events in the JSON file have missing or malformed fields.

**Solution:**

- The migration script handles individual event failures gracefully. Check the
  error output for specific events that failed.
- Events with missing fields use defaults (tokens default to `0`, latency
  defaults to `0`).
- You can re-run the migration safely — it's idempotent.

### Database file is locked

**Cause:** Another process has the SQLite database open.

**Solution:**

```bash
# Check for processes using the database
lsof ~/.claudeflow/usage.db

# Stop the daemon
claudeflow daemon stop

# Wait a moment and retry
sleep 2
npx tsx src/tracking/migrate.ts
```

### Duplicate events after re-running migration

**Cause:** Running migration multiple times could theoretically create duplicates.

**Solution:**

- The migration script checks for the database state before inserting.
- If you see duplicates, delete the database and re-run:
  ```bash
  rm ~/.claudeflow/usage.db
  npx tsx src/tracking/migrate.ts
  ```

### Performance issues with large JSON files

**Cause:** JSON files with >100K events may take longer to parse and migrate.

**Solution:**

- Use the `--dry-run` flag first to validate the data without writing.
- Migration runs in a single transaction, so memory usage peaks during event
  processing.
- For very large files (>1M events), consider splitting the migration into
  smaller batches by editing the JSON file manually.

---

## Frequently Asked Questions

**Q: Will I lose any data during migration?**
A: No. The migration creates a backup of the original JSON file before making
any changes. All events are migrated with their data preserved. The only fields
not available in the old system are `latency` (set to `0`) and `error_code`
(set to `null`).

**Q: Can I run migration while the system is active?**
A: It's recommended to stop the daemon before migrating. Running migration while
the system is active could result in a race condition where new events are
written to the old JSON file during migration.

**Q: What happens if migration fails midway?**
A: The migration uses SQLite transactions. If it fails midway, no partial data
is written to the database. The original JSON file remains untouched (the backup
is created before any database writes).

**Q: Is migration idempotent?**
A: Yes. Re-running migration with the same source file is safe. If events
already exist in the database, the migration will add them again. To avoid
duplicates, delete the database before re-running.

**Q: How do I verify data integrity after migration?**
A: Compare the event count in the database with the original JSON:

```bash
sqlite3 ~/.claudeflow/usage.db "SELECT COUNT(*) FROM usage_events;"
cat ~/.claudeflow/usage.json | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('history', [])))"
```

**Q: Can I migrate from a custom location?**
A: Yes. Use the `--input` and `--output` flags to specify custom paths:

```bash
npx tsx src/tracking/migrate.ts --input /custom/path/usage.json --output /custom/path/usage.db
```
