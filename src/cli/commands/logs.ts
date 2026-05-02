/**
 * Logs Command
 * 
 * View and manage daemon logs
 */

import chalk from 'chalk';
import { readFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';

/**
 * Logs command options
 */
interface LogsOptions {
  follow?: boolean;
  lines?: number;
  level?: 'debug' | 'info' | 'warn' | 'error';
  clear?: boolean;
}

/**
 * Colorize log line based on level
 */
function colorizeLine(line: string): string {
  if (line.includes('[ERROR]')) {
    return chalk.red(line);
  } else if (line.includes('[WARN]')) {
    return chalk.yellow(line);
  } else if (line.includes('[INFO]')) {
    return chalk.blue(line);
  } else if (line.includes('[DEBUG]')) {
    return chalk.gray(line);
  }
  return line;
}

/**
 * Filter log lines by level
 */
function filterByLevel(lines: string[], level?: string): string[] {
  if (!level) {
    return lines;
  }

  const levelUpper = level.toUpperCase();
  return lines.filter((line) => line.includes(`[${levelUpper}]`));
}

/**
 * Logs command
 */
export async function logsCommand(options: LogsOptions): Promise<void> {
  try {
    logger.info('Starting logs command', { options });

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const logPath = join(homedir(), '.claudeflow', 'logs', 'daemon.log');

    // Handle clear flag
    if (options.clear) {
      if (existsSync(logPath)) {
        await unlink(logPath);
        console.log(chalk.green('✓ Logs cleared'));
        logger.info('Logs cleared successfully');
      } else {
        console.log(chalk.yellow('⚠ No logs to clear'));
      }
      return;
    }

    // Check if log file exists
    if (!existsSync(logPath)) {
      console.log(chalk.yellow('⚠ No logs found'));
      console.log(chalk.gray('Start the daemon to generate logs: claudeflow daemon start'));
      return;
    }

    // Handle follow mode
    if (options.follow) {
      console.log(chalk.blue('📋 Following daemon logs (Ctrl+C to stop)\n'));

      // Use tail -f for real-time streaming
      const tail = spawn('tail', ['-f', logPath]);

      tail.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter((line: string) => line.trim());
        
        for (const line of lines) {
          // Filter by level if specified
          if (options.level) {
            const levelUpper = options.level.toUpperCase();
            if (!line.includes(`[${levelUpper}]`)) {
              continue;
            }
          }

          // Colorize and print
          console.log(colorizeLine(line));
        }
      });

      tail.stderr.on('data', (data) => {
        console.error(chalk.red('Error:'), data.toString());
      });

      tail.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(chalk.red(`\nTail process exited with code ${code}`));
        }
      });

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        tail.kill();
        console.log(chalk.gray('\n\nStopped following logs'));
        process.exit(0);
      });

      return;
    }

    // Read log file
    const content = await readFile(logPath, 'utf-8');
    let lines = content.split('\n').filter((line) => line.trim());

    // Filter by level
    if (options.level) {
      lines = filterByLevel(lines, options.level);
    }

    // Limit number of lines
    if (options.lines && options.lines > 0) {
      lines = lines.slice(-options.lines);
    }

    // Display logs
    if (lines.length === 0) {
      console.log(chalk.yellow('⚠ No logs match the specified criteria'));
      return;
    }

    console.log(chalk.blue(`📋 Daemon Logs (${lines.length} lines)\n`));

    for (const line of lines) {
      console.log(colorizeLine(line));
    }

    logger.info('Logs command completed successfully');
  } catch (error) {
    logger.error('Logs command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
