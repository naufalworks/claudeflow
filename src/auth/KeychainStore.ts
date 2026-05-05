/**
 * Secure credential storage using OS keychain with encrypted file fallback
 * 
 * Implements secure storage for OAuth tokens, refresh tokens, and client secrets.
 * Uses OS-native keychain (macOS Keychain, Windows Credential Manager, Linux libsecret)
 * with fallback to AES-256-GCM encrypted file for CI/CD environments.
 * 
 * Security measures:
 * - File permissions: 0o600 for files, 0o700 for directories
 * - Per-installation random salt
 * - AES-256-GCM with PBKDF2 key derivation (100,000 iterations)
 * - Constant-time comparison for auth tags
 * - Zod schema validation on retrieval
 */

import * as keytar from 'keytar';
import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import type { KeychainCredentials } from '../types/kiro-oauth.types.js';

/**
 * Supported keychain backends
 */
export type KeychainBackend = 
  | 'macos-keychain'
  | 'windows-credential-manager'
  | 'libsecret'
  | 'fallback-encrypted';

/**
 * Encryption parameters for file-based storage
 */
interface EncryptedData {
  iv: string;           // Hex-encoded initialization vector
  authTag: string;      // Hex-encoded GCM authentication tag
  encrypted: string;    // Hex-encoded encrypted data
  accountId: string;    // Account identifier for verification
}

/**
 * Schema for validating retrieved credentials
 */
const KeychainCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  scopes: z.array(z.string()).optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

/**
 * KeychainStore - Secure credential storage
 */
export class KeychainStore {
  private readonly SERVICE_NAME = 'claudeflow';
  private readonly CREDENTIALS_DIR = '.claudeflow';
  private readonly SALT_FILE = '.salt';
  private readonly ITERATIONS = 100000;
  private readonly KEY_LENGTH = 32; // 256 bits for AES-256
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly IV_LENGTH = 16; // 128 bits
  private readonly SALT_LENGTH = 32; // 256 bits

  /**
   * Store credentials for an account
   * Tries OS keychain first, falls back to encrypted file
   */
  async store(accountId: string, credentials: KeychainCredentials): Promise<void> {
    // Validate credentials before storing
    KeychainCredentialsSchema.parse(credentials);

    try {
      // Try keychain first
      await this.storeInKeychain(accountId, credentials);
    } catch (error: any) {
      // Log keychain failure, fall back to file
      console.warn(
        `Keychain storage failed for account ${accountId}, falling back to encrypted file:`,
        error.message
      );
      
      // Fall back to encrypted file
      await this.storeInFile(accountId, credentials);
    }
  }

  /**
   * Retrieve credentials for an account
   * Tries OS keychain first, falls back to encrypted file
   */
  async retrieve(accountId: string): Promise<KeychainCredentials | null> {
    try {
      // Try keychain first
      const credentials = await this.retrieveFromKeychain(accountId);
      if (credentials) {
        return credentials;
      }
    } catch (error: any) {
      console.warn(
        `Keychain retrieval failed for account ${accountId}, trying encrypted file:`,
        error.message
      );
    }

    // Fall back to encrypted file
    return this.retrieveFromFile(accountId);
  }

  /**
   * Delete credentials for an account
   * Deletes from both keychain and file
   */
  async delete(accountId: string): Promise<void> {
    const errors: Error[] = [];

    // Try to delete from keychain
    try {
      await keytar.deletePassword(this.SERVICE_NAME, accountId);
    } catch (error: any) {
      errors.push(error);
    }

    // Try to delete from file
    try {
      const credentialsPath = await this.getCredentialsPath(accountId);
      await fs.unlink(credentialsPath).catch(() => {
        // Ignore if file doesn't exist
      });
    } catch (error: any) {
      errors.push(error);
    }

    // If both failed, throw error
    if (errors.length === 2) {
      throw new Error(
        `Failed to delete credentials for ${accountId}: ${errors.map(e => e.message).join(', ')}`
      );
    }
  }

  /**
   * Check if credentials exist for an account
   */
  async exists(accountId: string): Promise<boolean> {
    try {
      // Check keychain
      const password = await keytar.getPassword(this.SERVICE_NAME, accountId);
      if (password) {
        return true;
      }
    } catch (error) {
      // Keychain check failed, continue to file check
    }

    // Check file
    try {
      const credentialsPath = await this.getCredentialsPath(accountId);
      await fs.access(credentialsPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect available OS keychain backend
   */
  detectBackend(): KeychainBackend {
    const platform = os.platform();
    
    switch (platform) {
      case 'darwin':
        return 'macos-keychain';
      case 'win32':
        return 'windows-credential-manager';
      case 'linux':
        return 'libsecret';
      default:
        return 'fallback-encrypted';
    }
  }

  /**
   * Store credentials in OS keychain
   */
  private async storeInKeychain(
    accountId: string,
    credentials: KeychainCredentials
  ): Promise<void> {
    const password = JSON.stringify(credentials);
    await keytar.setPassword(this.SERVICE_NAME, accountId, password);
  }

  /**
   * Retrieve credentials from OS keychain
   */
  private async retrieveFromKeychain(
    accountId: string
  ): Promise<KeychainCredentials | null> {
    const password = await keytar.getPassword(this.SERVICE_NAME, accountId);
    
    if (!password) {
      return null;
    }

    // Parse and validate
    const parsed = JSON.parse(password);
    const validated = KeychainCredentialsSchema.parse(parsed) as KeychainCredentials;
    
    return validated;
  }

  /**
   * Store credentials in encrypted file
   */
  private async storeInFile(
    accountId: string,
    credentials: KeychainCredentials
  ): Promise<void> {
    // Ensure directory exists with secure permissions
    await this.ensureDirectoryExists();

    // Get encryption key
    const key = await this.getEncryptionKey();

    // Generate random IV
    const iv = crypto.randomBytes(this.IV_LENGTH);

    // Encrypt
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Create encrypted data structure
    const data: EncryptedData = {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encrypted: encrypted.toString('hex'),
      accountId, // For verification
    };

    // Write to file with secure permissions (0o600 = owner read/write only)
    const credentialsPath = await this.getCredentialsPath(accountId);
    await fs.writeFile(
      credentialsPath,
      JSON.stringify(data, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Retrieve credentials from encrypted file
   */
  private async retrieveFromFile(
    accountId: string
  ): Promise<KeychainCredentials | null> {
    const credentialsPath = await this.getCredentialsPath(accountId);

    try {
      const data = await fs.readFile(credentialsPath, 'utf8');
      const parsed: EncryptedData = JSON.parse(data);

      // Verify account ID matches
      if (parsed.accountId !== accountId) {
        throw new Error('Account ID mismatch in credentials file');
      }

      // Get decryption key
      const key = await this.getEncryptionKey();

      // Decrypt
      const iv = Buffer.from(parsed.iv, 'hex');
      const authTag = Buffer.from(parsed.authTag, 'hex');
      const encrypted = Buffer.from(parsed.encrypted, 'hex');

      const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      // Parse and validate
      const credentials = JSON.parse(decrypted.toString('utf8'));
      const validated = KeychainCredentialsSchema.parse(credentials) as KeychainCredentials;

      return validated;
    } catch (error: any) {
      // File doesn't exist or decryption failed
      if (error.code === 'ENOENT') {
        return null;
      }
      
      throw new Error(`Failed to retrieve credentials from file: ${error.message}`);
    }
  }

  /**
   * Get encryption key derived from machine ID and salt
   */
  private async getEncryptionKey(): Promise<Buffer> {
    // Get or create salt
    const salt = await this.getOrCreateSalt();

    // Get machine ID
    const machineId = this.getMachineId();

    // Derive key using PBKDF2
    const key = crypto.pbkdf2Sync(
      machineId,
      salt,
      this.ITERATIONS,
      this.KEY_LENGTH,
      'sha256'
    );

    return key;
  }

  /**
   * Get or create per-installation salt
   */
  private async getOrCreateSalt(): Promise<Buffer> {
    const saltPath = this.getSaltPath();

    try {
      // Try to read existing salt
      const saltHex = await fs.readFile(saltPath, 'utf8');
      return Buffer.from(saltHex.trim(), 'hex');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      // Generate new random salt
      const salt = crypto.randomBytes(this.SALT_LENGTH);

      // Ensure directory exists
      await this.ensureDirectoryExists();

      // Write salt with secure permissions
      await fs.writeFile(saltPath, salt.toString('hex'), { mode: 0o600 });

      return salt;
    }
  }

  /**
   * Get machine ID for encryption key derivation
   * Combines multiple entropy sources for uniqueness
   */
  private getMachineId(): string {
    const hostname = os.hostname();
    const username = os.userInfo().username;
    const platform = os.platform();
    const arch = os.arch();

    // Combine entropy sources
    const combined = `${hostname}:${username}:${platform}:${arch}:claudeflow`;

    // Hash to get consistent length
    return crypto.createHash('sha256').update(combined).digest('hex');
  }

  /**
   * Get path to credentials file for an account
   */
  private async getCredentialsPath(accountId: string): Promise<string> {
    const dir = path.join(os.homedir(), this.CREDENTIALS_DIR);
    const filename = `${accountId}.json`;
    return path.join(dir, filename);
  }

  /**
   * Get path to salt file
   */
  private getSaltPath(): string {
    return path.join(os.homedir(), this.CREDENTIALS_DIR, this.SALT_FILE);
  }

  /**
   * Ensure credentials directory exists with secure permissions
   */
  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.join(os.homedir(), this.CREDENTIALS_DIR);

    try {
      // Try to create directory with secure permissions (0o700 = owner only)
      await fs.mkdir(dir, { mode: 0o700, recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      // Directory already exists, verify permissions
      const stats = await fs.stat(dir);
      const mode = stats.mode & 0o777;
      
      if (mode !== 0o700) {
        console.warn(
          `Credentials directory ${dir} has insecure permissions ${mode.toString(8)}, expected 700`
        );
      }
    }
  }
}
