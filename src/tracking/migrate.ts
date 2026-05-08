#!/usr/bin/env node
/**
 * Usage Tracking Migration Script
 *
 * Migrates usage data from the legacy JSON-based system to the new
 * SQLite time-series storage. Includes backup, validation, and
 * rollback procedures.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5
 *
 * Usage:
 *   npx tsx src/tracking/migrate.ts [options]
 *
 * Options:
 *   --input <path>       Path to old usage.json (default: ~/.claudeflow/usage.json)
 *   --output <path>      Path to new usage.db (default: ~/.claudeflow/usage.db)
 *   --backup-dir <path>  Directory for backup files (default: same as input)
 *   --dry-run            Validate and report without writing
 *   --help               Show this help message
 */

import fs from 'fs';
import path from 'path';
import { TimeSeriesStorage } from './TimeSeriesStorage.js';
import type { MigrationResult } from './TimeSeriesStorage.types.js';

// Exit codes
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

// Resolve home directory in paths
function resolveHome(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(process.env.HOME || '', filePath.slice(1));
  }
  return filePath;
}

// Parse command-line arguments
interface MigrationOptions {
  inputPath: string;
  outputPath: string;
  backupDir: string | null;
  dryRun: boolean;
}

function parseArgs(args: string[]): MigrationOptions {
  const defaultInput = path.join(process.env.HOME || '', '.claudeflow', 'usage.json');
  const defaultOutput = path.join(process.env.HOME || '', '.claudeflow', 'usage.db');

  const options: MigrationOptions = {
    inputPath: defaultInput,
    outputPath: defaultOutput,
    backupDir: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--input': {
        const value = args[++i];
        if (!value || value.startsWith('--')) {
          console.error('Error: --input requires a path argument');
          process.exit(EXIT_FAILURE);
        }
        options.inputPath = resolveHome(value);
        break;
      }
      case '--output': {
        const value = args[++i];
        if (!value || value.startsWith('--')) {
          console.error('Error: --output requires a path argument');
          process.exit(EXIT_FAILURE);
        }
        options.outputPath = resolveHome(value);
        break;
      }
      case '--backup-dir': {
        const value = args[++i];
        if (!value || value.startsWith('--')) {
          console.error('Error: --backup-dir requires a path argument');
          process.exit(EXIT_FAILURE);
        }
        options.backupDir = resolveHome(value);
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
        printHelp();
        process.exit(EXIT_SUCCESS);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(EXIT_FAILURE);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage Tracking Migration Script

Migrates usage data from JSON to SQLite time-series storage.

Usage:
  npx tsx src/tracking/migrate.ts [options]

Options:
  --input <path>       Path to old usage.json (default: ~/.claudeflow/usage.json)
  --output <path>      Path to new usage.db (default: ~/.claudeflow/usage.db)
  --backup-dir <path>  Directory for backup files (default: same as input)
  --dry-run            Validate and report without writing
  --help               Show this help message

Examples:
  # Default migration
  npx tsx src/tracking/migrate.ts

  # Custom paths
  npx tsx src/tracking/migrate.ts --input ./data/usage.json --output ./data/usage.db

  # Dry run to validate
  npx tsx src/tracking/migrate.ts --dry-run

  # Custom backup directory
  npx tsx src/tracking/migrate.ts --backup-dir ./backups
`);
}

// Logging helpers
function logStep(message: string): void {
  console.log(`  → ${message}`);
}

function logSuccess(message: string): void {
  console.log(`  ✅ ${message}`);
}

function logWarning(message: string): void {
  console.log(`  ⚠️  ${message}`);
}

function logError(message: string): void {
  console.error(`  ❌ ${message}`);
}

// Validate the JSON file before migration
interface ValidationResult {
  valid: boolean;
  eventCount: number;
  errors: string[];
}

function validateJSONFile(jsonPath: string): ValidationResult {
  const result: ValidationResult = {
    valid: false,
    eventCount: 0,
    errors: [],
  };

  // Check file exists
  if (!fs.existsSync(jsonPath)) {
    result.errors.push(`Input file not found: ${jsonPath}`);
    return result;
  }

  // Check file is readable
  try {
    fs.accessSync(jsonPath, fs.constants.R_OK);
  } catch {
    result.errors.push(`Input file is not readable: ${jsonPath}`);
    return result;
  }

  // Parse JSON
  let rawData: unknown;
  try {
    rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to parse JSON: ${errorMsg}`);
    return result;
  }

  // Validate structure
  const data = rawData as { history?: unknown[] };
  if (!data.history || !Array.isArray(data.history)) {
    result.errors.push('Invalid format: expected { "history": [...] } structure');
    return result;
  }

  result.eventCount = data.history.length;

  // Validate individual events (sample first 100 for performance)
  const sampleSize = Math.min(data.history.length, 100);
  let invalidCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const event = data.history[i] as Record<string, unknown>;
    if (!event.timestamp && event.timestamp !== 0) {
      invalidCount++;
    }
  }

  if (invalidCount > 0) {
    result.errors.push(`${invalidCount} of ${sampleSize} sampled events have missing timestamps`);
  }

  result.valid = result.errors.length === 0;
  return result;
}

// Create backup of the input file
function createBackup(sourcePath: string, backupDir: string | null): string | null {
  let backupPath: string;

  if (backupDir) {
    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const filename = path.basename(sourcePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(backupDir, `${filename}.backup-${timestamp}`);
  } else {
    backupPath = `${sourcePath}.backup`;
  }

  try {
    fs.copyFileSync(sourcePath, backupPath);
    return backupPath;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create backup: ${errorMsg}`);
    return null;
  }
}

// Main migration function
function migrate(): void {
  const options = parseArgs(process.argv.slice(2));

  console.log('\n📦 ClaudeFlow Usage Tracking Migration\n');
  console.log('Configuration:');
  console.log(`  Input:  ${options.inputPath}`);
  console.log(`  Output: ${options.outputPath}`);
  console.log(`  Backup: ${options.backupDir || path.dirname(options.inputPath)}`);
  console.log(`  Mode:   ${options.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

  // Step 1: Validate input
  console.log('Step 1: Validating input file...');
  const validation = validateJSONFile(options.inputPath);

  if (!validation.valid) {
    logError('Validation failed:');
    for (const error of validation.errors) {
      logError(`  ${error}`);
    }
    process.exit(EXIT_FAILURE);
  }

  logSuccess(`Valid JSON file with ${validation.eventCount} events`);

  if (validation.eventCount === 0) {
    logWarning('No events to migrate. Nothing to do.');
    process.exit(EXIT_SUCCESS);
  }

  // Step 2: Check output path
  console.log('\nStep 2: Checking output path...');
  const outputDir = path.dirname(options.outputPath);

  if (!fs.existsSync(outputDir)) {
    logStep(`Creating output directory: ${outputDir}`);
    if (!options.dryRun) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    logSuccess('Directory created');
  } else {
    logSuccess('Output directory exists');
  }

  if (fs.existsSync(options.outputPath)) {
    logWarning(`Database file already exists: ${options.outputPath}`);
    logWarning('Existing data will be preserved; new events will be added');
  }

  // Step 3: Create backup
  console.log('\nStep 3: Creating backup...');
  if (options.dryRun) {
    logStep('[DRY RUN] Would create backup of input file');
  } else {
    const backupPath = createBackup(options.inputPath, options.backupDir);
    if (backupPath) {
      logSuccess(`Backup created: ${backupPath}`);
    } else {
      logError('Failed to create backup. Aborting migration.');
      process.exit(EXIT_FAILURE);
    }
  }

  // Step 4: Run migration
  console.log('\nStep 4: Running migration...');
  if (options.dryRun) {
    logStep('[DRY RUN] Would migrate events to SQLite database');
    logSuccess(`Would migrate ${validation.eventCount} events`);
    console.log('\n✅ Dry run completed successfully. No changes were made.');
    process.exit(EXIT_SUCCESS);
  }

  let storage: TimeSeriesStorage | null = null;
  try {
    storage = new TimeSeriesStorage({
      databasePath: options.outputPath,
    });

    const result: MigrationResult = storage.migrateFromJSON(options.inputPath);

    if (result.success) {
      logSuccess(`Successfully migrated ${result.migratedEvents} events`);

      if (result.backupPath) {
        logSuccess(`Backup: ${result.backupPath}`);
      }

      if (result.errors.length > 0) {
        logWarning(`${result.errors.length} non-fatal errors occurred:`);
        for (const error of result.errors.slice(0, 10)) {
          logWarning(`  ${error}`);
        }
        if (result.errors.length > 10) {
          logWarning(`  ... and ${result.errors.length - 10} more`);
        }
      }

      // Step 5: Verify
      console.log('\nStep 5: Verifying migration...');
      const db = storage.getDatabase();
      const count = db.prepare('SELECT COUNT(*) as count FROM usage_events').get() as {
        count: number;
      };

      if (count.count === result.migratedEvents) {
        logSuccess(`Verification passed: ${count.count} events in database`);
      } else {
        logWarning(`Count mismatch: expected ${result.migratedEvents}, found ${count.count}`);
      }

      console.log('\n✅ Migration completed successfully!\n');
      console.log('Next steps:');
      console.log('  1. Start the daemon: claudeflow daemon start --mitm');
      console.log('  2. Launch dashboard: claudeflow dashboard');
      console.log('  3. Verify data appears correctly\n');

      process.exit(EXIT_SUCCESS);
    } else {
      logError('Migration failed with errors:');
      for (const error of result.errors) {
        logError(`  ${error}`);
      }
      console.log('\n❌ Migration failed. Check errors above for details.');
      console.log('The original JSON file is unchanged.\n');
      process.exit(EXIT_FAILURE);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logError(`Unexpected error: ${errorMsg}`);
    console.log('\n❌ Migration failed due to an unexpected error.');
    console.log('The original JSON file is unchanged.\n');
    process.exit(EXIT_FAILURE);
  } finally {
    if (storage) {
      storage.close();
    }
  }
}

// Run migration
migrate();
