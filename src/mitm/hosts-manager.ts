/**
 * Hosts File Manager
 *
 * Manages /etc/hosts file modifications for MITM proxy
 * - Backup original hosts file
 * - Add Kiro domain redirects to 127.0.0.1
 * - Restore original hosts file on uninstall
 */

import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface HostsEntry {
  ip: string;
  hostname: string;
  comment?: string;
}

export class HostsManager {
  private readonly hostsPath: string;
  private readonly backupPath: string;
  private readonly marker = '# ClaudeFlow MITM';

  constructor() {
    // Determine hosts file path based on OS
    this.hostsPath = os.platform() === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    this.backupPath = path.join(
      os.homedir(),
      '.claudeflow',
      'hosts.backup'
    );
  }

  /**
   * Check if hosts file has ClaudeFlow entries
   */
  async isInstalled(): Promise<boolean> {
    try {
      const content = await this.readHostsFile();
      return content.includes(this.marker);
    } catch (error) {
      return false;
    }
  }

  /**
   * Install Kiro domain redirects to /etc/hosts
   */
  async install(): Promise<void> {
    // Check if already installed
    if (await this.isInstalled()) {
      throw new Error('ClaudeFlow MITM entries already exist in hosts file');
    }

    // Backup original hosts file
    await this.backup();

    // Kiro domains to redirect
    const entries: HostsEntry[] = [
      {
        ip: '127.0.0.1',
        hostname: 'q.us-east-1.amazonaws.com',
        comment: 'Kiro API (us-east-1)',
      },
      {
        ip: '127.0.0.1',
        hostname: 'q.us-west-2.amazonaws.com',
        comment: 'Kiro API (us-west-2)',
      },
      {
        ip: '127.0.0.1',
        hostname: 'q.eu-west-1.amazonaws.com',
        comment: 'Kiro API (eu-west-1)',
      },
      {
        ip: '127.0.0.1',
        hostname: 'q.ap-southeast-1.amazonaws.com',
        comment: 'Kiro API (ap-southeast-1)',
      },
    ];

    // Read current hosts file
    const currentContent = await this.readHostsFile();

    // Build new entries
    const newEntries = [
      '',
      this.marker,
      ...entries.map(e => `${e.ip}\t${e.hostname}\t# ${e.comment}`),
      `# End ClaudeFlow MITM`,
      '',
    ].join('\n');

    // Append to hosts file
    const newContent = currentContent + newEntries;

    // Write with elevated privileges
    await this.writeHostsFile(newContent);
  }

  /**
   * Uninstall Kiro domain redirects from /etc/hosts
   */
  async uninstall(): Promise<void> {
    // Check if installed
    if (!(await this.isInstalled())) {
      throw new Error('ClaudeFlow MITM entries not found in hosts file');
    }

    // Read current hosts file
    const content = await this.readHostsFile();

    // Remove ClaudeFlow entries
    const lines = content.split('\n');
    const filteredLines: string[] = [];
    let inClaudeFlowBlock = false;

    for (const line of lines) {
      if (line.includes(this.marker)) {
        inClaudeFlowBlock = true;
        continue;
      }
      if (inClaudeFlowBlock && line.includes('# End ClaudeFlow MITM')) {
        inClaudeFlowBlock = false;
        continue;
      }
      if (!inClaudeFlowBlock) {
        filteredLines.push(line);
      }
    }

    // Remove trailing empty lines
    while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() === '') {
      filteredLines.pop();
    }

    const newContent = filteredLines.join('\n') + '\n';

    // Write with elevated privileges
    await this.writeHostsFile(newContent);

    // Remove backup
    await this.removeBackup();
  }

  /**
   * Backup original hosts file
   */
  private async backup(): Promise<void> {
    try {
      const content = await this.readHostsFile();

      // Ensure backup directory exists
      const backupDir = path.dirname(this.backupPath);
      await fs.mkdir(backupDir, { recursive: true });

      // Write backup
      await fs.writeFile(this.backupPath, content, 'utf8');
    } catch (error) {
      throw new Error(`Failed to backup hosts file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Remove backup file
   */
  private async removeBackup(): Promise<void> {
    try {
      await fs.unlink(this.backupPath);
    } catch (error) {
      // Ignore if backup doesn't exist
    }
  }

  /**
   * Restore hosts file from backup
   */
  async restore(): Promise<void> {
    try {
      const backupContent = await fs.readFile(this.backupPath, 'utf8');
      await this.writeHostsFile(backupContent);
      await this.removeBackup();
    } catch (error) {
      throw new Error(`Failed to restore hosts file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Read hosts file (requires elevated privileges on some systems)
   */
  private async readHostsFile(): Promise<string> {
    try {
      return await fs.readFile(this.hostsPath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read hosts file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Write hosts file (requires elevated privileges)
   */
  private async writeHostsFile(content: string): Promise<void> {
    try {
      // On Unix systems, we need sudo to write to /etc/hosts
      if (os.platform() !== 'win32') {
        // Write to temp file first
        const tempPath = path.join(os.tmpdir(), 'claudeflow-hosts-temp');
        await fs.writeFile(tempPath, content, 'utf8');

        // Copy with sudo
        await execAsync(`sudo cp "${tempPath}" "${this.hostsPath}"`);

        // Clean up temp file
        await fs.unlink(tempPath);
      } else {
        // On Windows, write directly (requires admin privileges)
        await fs.writeFile(this.hostsPath, content, 'utf8');
      }
    } catch (error) {
      throw new Error(`Failed to write hosts file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get current hosts file content
   */
  async getContent(): Promise<string> {
    return this.readHostsFile();
  }

  /**
   * Check if backup exists
   */
  async hasBackup(): Promise<boolean> {
    try {
      await fs.access(this.backupPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Flush DNS cache (OS-specific)
   */
  async flushDNS(): Promise<void> {
    try {
      const platform = os.platform();

      if (platform === 'darwin') {
        // macOS
        await execAsync('sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder');
      } else if (platform === 'linux') {
        // Linux (systemd-resolved)
        await execAsync('sudo systemd-resolve --flush-caches || sudo service nscd restart || true');
      } else if (platform === 'win32') {
        // Windows
        await execAsync('ipconfig /flushdns');
      }
    } catch (error) {
      // DNS flush is best-effort, don't fail if it doesn't work
      console.warn('Warning: Failed to flush DNS cache:', error instanceof Error ? error.message : String(error));
    }
  }
}
