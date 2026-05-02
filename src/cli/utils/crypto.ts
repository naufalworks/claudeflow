/**
 * Crypto Utility
 * 
 * Encryption/decryption utilities for sensitive data
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Encryption algorithm
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

/**
 * Generate encryption key from password
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data: string, password: string): string {
  try {
    // Generate random salt and IV
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    // Derive key from password
    const key = deriveKey(password, salt);

    // Create cipher
    const cipher = createCipheriv(ALGORITHM, key, iv);

    // Encrypt data
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get auth tag
    const tag = cipher.getAuthTag();

    // Combine salt + iv + tag + encrypted data
    const result = Buffer.concat([
      salt,
      iv,
      tag,
      Buffer.from(encrypted, 'hex'),
    ]);

    // Return as base64
    return result.toString('base64');
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encryptedData: string, password: string): string {
  try {
    // Decode from base64
    const buffer = Buffer.from(encryptedData, 'base64');

    // Extract components
    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    // Derive key from password
    const key = deriveKey(password, salt);

    // Create decipher
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    // Decrypt data
    let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate a random encryption key
 */
export function generateKey(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Hash data using SHA-256
 */
export function hash(data: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a random token
 */
export function generateToken(length: number = 32): string {
  return randomBytes(length).toString('base64url');
}

/**
 * Mask sensitive data for display
 */
export function maskSensitive(data: string, visibleChars: number = 4): string {
  if (!data || data.length <= visibleChars * 2) {
    return '****';
  }

  const start = data.substring(0, visibleChars);
  const end = data.substring(data.length - visibleChars);
  return `${start}****${end}`;
}

/**
 * Validate encrypted data format
 */
export function isEncrypted(data: string): boolean {
  try {
    const buffer = Buffer.from(data, 'base64');
    
    // Check minimum length (salt + iv + tag + at least 1 byte of data)
    const minLength = SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
    return buffer.length >= minLength;
  } catch {
    return false;
  }
}

/**
 * Encrypt object (converts to JSON first)
 */
export function encryptObject<T>(obj: T, password: string): string {
  const json = JSON.stringify(obj);
  return encrypt(json, password);
}

/**
 * Decrypt object (parses JSON after decryption)
 */
export function decryptObject<T>(encryptedData: string, password: string): T {
  const json = decrypt(encryptedData, password);
  return JSON.parse(json) as T;
}

/**
 * Generate a secure random password
 */
export function generatePassword(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const bytes = randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    password += chars[bytes[i] % chars.length];
  }

  return password;
}

/**
 * Compare two strings in constant time (prevents timing attacks)
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
