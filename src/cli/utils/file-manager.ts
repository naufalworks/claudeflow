/**
 * FileManager
 * 
 * Manages ~/.claudeflow/ directory structure and file operations
 */

import { readdir, stat, unlink, mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createReadStream, createWriteStream } from 'fs';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';
import type { Backup } from '../types/cli.types.js';

/**
 * FileManager
 * 
 * Handles file system operations for CLI
 */
export class FileManager {
  private configDir: string;
  private logsDir: string;
  private backupsDir: string;
  private profilesDir: string;

  constructor(configDir?: string) {
    this.configDir = configDir || join(homedir(), '.claudeflow');
    this.logsDir = join(this.configDir, 'logs');
    this.backupsDir = join(this.configDir, 'backups');
    this.profilesDir = join(this.configDir, 'profiles');
  }

  /**
   * Ensure directory structure exists with proper permissions
   */
  async ensureDirectoryStructure(): Promise<void> {
    const directories = [
      this.configDir,
      this.logsDir,
      this.backupsDir,
      this.profilesDir,
    ];

    for (const dir of directories) {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
      } else {
        // Ensure proper permissions on existing directories
        const { chmod } = await import('fs/promises');
        await chmod(dir, 0o700);
      }
    }
  }

  /**
   * Create backup of configuration and data
   */
  async createBackup(): Promise<Backup> {
    await this.ensureDirectoryStructure();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `backup-${timestamp}`;
    const backupPath = join(this.backupsDir, `${backupId}.tar.gz`);

    // Files to backup
    const filesToBackup = [
      { path: join(this.configDir, 'config.json'), name: 'config.json' },
      { path: join(this.configDir, 'analytics.db'), name: 'analytics.db' },
    ];

    // Add all profiles
    if (existsSync(this.profilesDir)) {
      const profileFiles = await readdir(this.profilesDir);
      for (const file of profileFiles) {
        if (file.endsWith('.json')) {
          filesToBackup.push({
            path: join(this.profilesDir, file),
            name: `profiles/${file}`,
          });
        }
      }
    }

    // Create backup archive
    const backupData: Record<string, string> = {};
    const includes: string[] = [];

    for (const file of filesToBackup) {
      if (existsSync(file.path)) {
        const content = await readFile(file.path, 'utf-8');
        backupData[file.name] = content;
        includes.push(file.name);
      }
    }

    // Write backup as compressed JSON
    const backupJson = JSON.stringify(backupData, null, 2);
    const writeStream = createWriteStream(backupPath, { mode: 0o600 });
    const gzip = createGzip();

    await pipeline(
      async function* () {
        yield Buffer.from(backupJson, 'utf-8');
      },
      gzip,
      writeStream
    );

    // Get backup size
    const stats = await stat(backupPath);

    return {
      id: backupId,
      timestamp: new Date(),
      size: stats.size,
      path: backupPath,
      includes,
    };
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupId: string): Promise<void> {
    const backupPath = join(this.backupsDir, `${backupId}.tar.gz`);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup '${backupId}' not found`);
    }

    // Read and decompress backup
    const chunks: Buffer[] = [];
    const readStream = createReadStream(backupPath);
    const gunzip = createGunzip();

    await pipeline(
      readStream,
      gunzip,
      async function* (source) {
        for await (const chunk of source) {
          chunks.push(chunk);
        }
      }
    );

    const backupJson = Buffer.concat(chunks).toString('utf-8');
    const backupData = JSON.parse(backupJson) as Record<string, string>;

    // Restore files
    for (const [name, content] of Object.entries(backupData)) {
      const targetPath = join(this.configDir, name);
      const targetDir = join(targetPath, '..');

      // Ensure target directory exists
      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true, mode: 0o700 });
      }

      // Write file with proper permissions
      await writeFile(targetPath, content, { mode: 0o600 });
    }
  }

  /**
   * List all backups
   */
  async listBackups(): Promise<Backup[]> {
    if (!existsSync(this.backupsDir)) {
      return [];
    }

    const files = await readdir(this.backupsDir);
    const backups: Backup[] = [];

    for (const file of files) {
      if (file.endsWith('.tar.gz')) {
        const backupPath = join(this.backupsDir, file);
        const stats = await stat(backupPath);
        const backupId = file.replace('.tar.gz', '');

        // Extract timestamp from backup ID
        const timestampStr = backupId.replace('backup-', '');
        const timestamp = new Date(timestampStr.replace(/-/g, ':'));

        backups.push({
          id: backupId,
          timestamp,
          size: stats.size,
          path: backupPath,
          includes: [], // Would need to read archive to get this
        });
      }
    }

    // Sort by timestamp (newest first)
    backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return backups;
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    const backupPath = join(this.backupsDir, `${backupId}.tar.gz`);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup '${backupId}' not found`);
    }

    await unlink(backupPath);
  }

  /**
   * Export backup to external file
   */
  async exportBackup(backupId: string, targetPath: string): Promise<void> {
    const backupPath = join(this.backupsDir, `${backupId}.tar.gz`);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup '${backupId}' not found`);
    }

    // Copy backup to target path
    const readStream = createReadStream(backupPath);
    const writeStream = createWriteStream(targetPath, { mode: 0o600 });

    await pipeline(readStream, writeStream);
  }

  /**
   * Import backup from external file
   */
  async importBackup(sourcePath: string): Promise<Backup> {
    if (!existsSync(sourcePath)) {
      throw new Error(`Source file '${sourcePath}' not found`);
    }

    await this.ensureDirectoryStructure();

    // Generate backup ID based on file hash
    const hash = await this.calculateFileHash(sourcePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `backup-imported-${timestamp}-${hash.substring(0, 8)}`;
    const backupPath = join(this.backupsDir, `${backupId}.tar.gz`);

    // Copy file to backups directory
    const readStream = createReadStream(sourcePath);
    const writeStream = createWriteStream(backupPath, { mode: 0o600 });

    await pipeline(readStream, writeStream);

    // Get backup size
    const stats = await stat(backupPath);

    return {
      id: backupId,
      timestamp: new Date(),
      size: stats.size,
      path: backupPath,
      includes: [],
    };
  }

  /**
   * Rotate log files
   */
  async rotateLogs(): Promise<void> {
    if (!existsSync(this.logsDir)) {
      return;
    }

    const logFiles = ['cli.log', 'daemon.log', 'error.log'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    const maxRotations = 5;

    for (const logFile of logFiles) {
      const logPath = join(this.logsDir, logFile);

      if (!existsSync(logPath)) {
        continue;
      }

      const stats = await stat(logPath);

      // Rotate if file is too large
      if (stats.size > maxSize) {
        // Shift existing rotations
        for (let i = maxRotations - 1; i > 0; i--) {
          const oldPath = join(this.logsDir, `${logFile}.${i}`);
          const newPath = join(this.logsDir, `${logFile}.${i + 1}`);

          if (existsSync(oldPath)) {
            const { rename } = await import('fs/promises');
            await rename(oldPath, newPath);
          }
        }

        // Rotate current log
        const rotatedPath = join(this.logsDir, `${logFile}.1`);
        const { rename } = await import('fs/promises');
        await rename(logPath, rotatedPath);

        // Create new empty log file
        await writeFile(logPath, '', { mode: 0o600 });
      }
    }
  }

  /**
   * Clean old backups
   */
  async cleanOldBackups(maxAge: number = 30): Promise<number> {
    const backups = await this.listBackups();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAge);

    let deletedCount = 0;

    for (const backup of backups) {
      if (backup.timestamp < cutoffDate) {
        await this.deleteBackup(backup.id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Get directory size
   */
  async getDirectorySize(dirPath: string): Promise<number> {
    if (!existsSync(dirPath)) {
      return 0;
    }

    let totalSize = 0;
    const files = await readdir(dirPath);

    for (const file of files) {
      const filePath = join(dirPath, file);
      const stats = await stat(filePath);

      if (stats.isDirectory()) {
        totalSize += await this.getDirectorySize(filePath);
      } else {
        totalSize += stats.size;
      }
    }

    return totalSize;
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    total: number;
    config: number;
    logs: number;
    backups: number;
    profiles: number;
  }> {
    const config = existsSync(join(this.configDir, 'config.json'))
      ? (await stat(join(this.configDir, 'config.json'))).size
      : 0;

    const analytics = existsSync(join(this.configDir, 'analytics.db'))
      ? (await stat(join(this.configDir, 'analytics.db'))).size
      : 0;

    const logs = await this.getDirectorySize(this.logsDir);
    const backups = await this.getDirectorySize(this.backupsDir);
    const profiles = await this.getDirectorySize(this.profilesDir);

    return {
      total: config + analytics + logs + backups + profiles,
      config: config + analytics,
      logs,
      backups,
      profiles,
    };
  }

  /**
   * Calculate file hash
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    for await (const chunk of stream) {
      hash.update(chunk);
    }

    return hash.digest('hex');
  }

  /**
   * Get config directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Get logs directory path
   */
  getLogsDir(): string {
    return this.logsDir;
  }

  /**
   * Get backups directory path
   */
  getBackupsDir(): string {
    return this.backupsDir;
  }

  /**
   * Get profiles directory path
   */
  getProfilesDir(): string {
    return this.profilesDir;
  }
}
