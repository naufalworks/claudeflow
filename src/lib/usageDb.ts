/**
 * Usage Database
 *
 * Tracks API usage, tokens, and costs like 9router does.
 * Stores usage history in a JSON file for persistence.
 */

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.CLAUDEFLOW_DATA_DIR || path.join(process.env.HOME || '', '.claudeflow');
const DB_FILE = path.join(DATA_DIR, 'usage.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface UsageEntry {
  timestamp: string;
  accountId: string;
  model: string;
  region: string;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  cost: number;
  status: 'success' | 'error';
}

interface UsageData {
  history: UsageEntry[];
  totalRequestsLifetime: number;
}

const defaultData: UsageData = {
  history: [],
  totalRequestsLifetime: 0,
};

let dbInstance: Low<UsageData> | null = null;

/**
 * Get usage database instance (singleton)
 */
export async function getUsageDb(): Promise<Low<UsageData>> {
  if (!dbInstance) {
    const adapter = new JSONFile<UsageData>(DB_FILE);
    dbInstance = new Low(adapter, defaultData);

    try {
      await dbInstance.read();
    } catch (error) {
      console.warn('[usageDb] Failed to read, using defaults');
      dbInstance.data = defaultData;
      await dbInstance.write();
    }

    if (!dbInstance.data) {
      dbInstance.data = { ...defaultData };
      await dbInstance.write();
    }
  }
  return dbInstance;
}

/**
 * Calculate cost for tokens
 * Claude Sonnet 4 pricing: $15 per 1M tokens (input + output)
 */
function calculateCost(tokens: UsageEntry['tokens']): number {
  const inputTokens = tokens.input_tokens || 0;
  const outputTokens = tokens.output_tokens || 0;
  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  const cacheReadTokens = tokens.cache_read_input_tokens || 0;

  // $15 per 1M tokens
  const inputCost = (inputTokens / 1000000) * 15;
  const outputCost = (outputTokens / 1000000) * 15;
  const cacheCreationCost = (cacheCreationTokens / 1000000) * 15;
  const cacheReadCost = (cacheReadTokens / 1000000) * 15 * 0.1; // Cache reads are 90% cheaper

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

/**
 * Save request usage
 */
export async function saveRequestUsage(entry: Omit<UsageEntry, 'timestamp' | 'cost'>): Promise<void> {
  try {
    const db = await getUsageDb();

    const fullEntry: UsageEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      cost: calculateCost(entry.tokens),
    };

    db.data.history.push(fullEntry);
    db.data.totalRequestsLifetime += 1;

    // Keep only last 10,000 entries
    const MAX_HISTORY = 10000;
    if (db.data.history.length > MAX_HISTORY) {
      db.data.history.splice(0, db.data.history.length - MAX_HISTORY);
    }

    await db.write();
  } catch (error) {
    console.error('[usageDb] Failed to save usage:', error);
  }
}

/**
 * Get usage stats for an account
 */
export async function getAccountUsage(accountId: string): Promise<{
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}> {
  try {
    const db = await getUsageDb();
    await db.read();

    const accountEntries = db.data.history.filter((e: UsageEntry) => e.accountId === accountId);

    let totalTokens = 0;
    let totalCost = 0;

    for (const entry of accountEntries) {
      totalTokens += (entry.tokens.input_tokens || 0) + (entry.tokens.output_tokens || 0);
      totalCost += entry.cost || 0;
    }

    return {
      totalTokens,
      totalCost,
      requestCount: accountEntries.length,
    };
  } catch (error) {
    console.error('[usageDb] Failed to get account usage:', error);
    return { totalTokens: 0, totalCost: 0, requestCount: 0 };
  }
}

/**
 * Get total usage stats
 */
export async function getTotalUsage(): Promise<{
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
}> {
  try {
    const db = await getUsageDb();
    await db.read();

    let totalTokens = 0;
    let totalCost = 0;

    for (const entry of db.data.history) {
      totalTokens += (entry.tokens.input_tokens || 0) + (entry.tokens.output_tokens || 0);
      totalCost += entry.cost || 0;
    }

    return {
      totalTokens,
      totalCost,
      totalRequests: db.data.totalRequestsLifetime,
    };
  } catch (error) {
    console.error('[usageDb] Failed to get total usage:', error);
    return { totalTokens: 0, totalCost: 0, totalRequests: 0 };
  }
}
