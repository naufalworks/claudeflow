/**
 * Security Utilities for CLI Commands
 * 
 * Provides token sanitization, input validation, and audit logging
 * to prevent security vulnerabilities in CLI operations.
 */

import * as crypto from 'crypto';
import { logger } from './logger.js';

/**
 * Valid OAuth providers
 */
const VALID_PROVIDERS = ['aws', 'google', 'github'] as const;
export type OAuthProvider = typeof VALID_PROVIDERS[number];

/**
 * Valid AWS regions for Kiro
 */
const VALID_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-central-1',
  'ap-southeast-1',
] as const;
export type ValidRegion = typeof VALID_REGIONS[number];

/**
 * Sanitize token for display
 * Shows only last 4 characters to prevent token exposure
 * 
 * @param token - Token to sanitize
 * @returns Sanitized token string
 */
export function sanitizeToken(token: string): string {
  if (!token || token.length < 8) {
    return '****';
  }
  
  const last4 = token.slice(-4);
  return `****${last4}`;
}

/**
 * Sanitize error message to remove tokens
 * Removes Bearer tokens, API keys, and other sensitive data
 * 
 * @param error - Error object or message
 * @returns Sanitized error message
 */
export function sanitizeError(error: Error | string): string {
  const message = typeof error === 'string' ? error : error.message;
  
  // Remove Bearer tokens
  let sanitized = message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ****');
  
  // Remove API keys (sk-ant-*, sk-*, etc.)
  sanitized = sanitized.replace(/sk-[a-z0-9-]+[A-Za-z0-9._-]{20,}/gi, 'sk-****');
  
  // Remove long hex strings (>20 chars) - likely tokens
  sanitized = sanitized.replace(/\b[a-f0-9]{21,}\b/gi, '****');
  
  // Remove long base64 strings (>20 chars) - likely tokens
  sanitized = sanitized.replace(/\b[A-Za-z0-9+/]{21,}={0,2}\b/g, '****');
  
  // Remove JWT tokens (three base64 segments separated by dots)
  sanitized = sanitized.replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '****');
  
  return sanitized;
}

/**
 * Validate account ID format
 * Must match pattern: kiro-[hexadecimal]
 * 
 * @param accountId - Account ID to validate
 * @returns True if valid
 * @throws Error if invalid
 */
export function validateAccountId(accountId: string): boolean {
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Account ID is required and must be a string');
  }
  
  // Must start with 'kiro-' followed by hexadecimal characters
  const pattern = /^kiro-[a-f0-9]+$/;
  
  if (!pattern.test(accountId)) {
    throw new Error(
      `Invalid account ID format: ${accountId}. ` +
      `Must match pattern: kiro-[hexadecimal]`
    );
  }
  
  return true;
}

/**
 * Validate region against whitelist
 * Prevents SSRF attacks and invalid region usage
 * 
 * @param region - AWS region to validate
 * @returns True if valid
 * @throws Error if invalid
 */
export function validateRegion(region: string): boolean {
  if (!region || typeof region !== 'string') {
    throw new Error('Region is required and must be a string');
  }
  
  if (!VALID_REGIONS.includes(region as ValidRegion)) {
    throw new Error(
      `Invalid region: ${region}. ` +
      `Must be one of: ${VALID_REGIONS.join(', ')}`
    );
  }
  
  return true;
}

/**
 * Validate OAuth provider against whitelist
 * 
 * @param provider - OAuth provider to validate
 * @returns True if valid
 * @throws Error if invalid
 */
export function validateProvider(provider: string): boolean {
  if (!provider || typeof provider !== 'string') {
    throw new Error('Provider is required and must be a string');
  }
  
  if (!VALID_PROVIDERS.includes(provider as OAuthProvider)) {
    throw new Error(
      `Invalid provider: ${provider}. ` +
      `Must be one of: ${VALID_PROVIDERS.join(', ')}`
    );
  }
  
  return true;
}

/**
 * Generate deterministic account ID from profileArn
 * Uses SHA-256 hash to ensure consistent IDs
 * 
 * Format: kiro-{first16CharsOfHash}
 * 
 * @param profileArn - AWS profile ARN
 * @returns Account ID in format kiro-[hash]
 */
export function generateAccountId(profileArn: string): string {
  if (!profileArn || typeof profileArn !== 'string') {
    throw new Error('Profile ARN is required and must be a string');
  }
  
  // Validate ARN format
  const arnPattern = /^arn:aws:codewhisperer:[a-z0-9-]+:\d+:profile\/[a-zA-Z0-9-]+$/;
  if (!arnPattern.test(profileArn)) {
    throw new Error(
      `Invalid profile ARN format: ${profileArn}. ` +
      `Expected: arn:aws:codewhisperer:{region}:{account-id}:profile/{profile-id}`
    );
  }
  
  // Generate SHA-256 hash
  const hash = crypto.createHash('sha256').update(profileArn).digest('hex');
  
  // Take first 16 characters for account ID
  const accountId = `kiro-${hash.substring(0, 16)}`;
  
  return accountId;
}

/**
 * Log security event for audit trail
 * Logs authentication, authorization, and sensitive operations
 * 
 * @param operation - Operation being performed
 * @param accountId - Account ID (if applicable)
 * @param result - Operation result (success/failure)
 * @param details - Additional details (optional)
 */
export function logSecurityEvent(
  operation: string,
  accountId: string | null,
  result: 'success' | 'failure',
  details?: Record<string, any>
): void {
  const event = {
    timestamp: new Date().toISOString(),
    operation,
    accountId: accountId || 'N/A',
    result,
    details: details || {},
  };
  
  // Log at appropriate level
  if (result === 'success') {
    logger.info('Security event', event);
  } else {
    logger.warn('Security event - failure', event);
  }
}

/**
 * Validate priority value for account routing
 * 
 * @param priority - Priority value to validate
 * @returns True if valid
 * @throws Error if invalid
 */
export function validatePriority(priority: number): boolean {
  if (typeof priority !== 'number') {
    throw new Error('Priority must be a number');
  }
  
  if (!Number.isInteger(priority)) {
    throw new Error('Priority must be an integer');
  }
  
  if (priority < 0 || priority > 100) {
    throw new Error('Priority must be between 0 and 100');
  }
  
  return true;
}

/**
 * Sanitize command-line arguments to prevent injection
 * Removes special characters that could be used for command injection
 * 
 * @param arg - Argument to sanitize
 * @returns Sanitized argument
 */
export function sanitizeCliArgument(arg: string): string {
  if (!arg || typeof arg !== 'string') {
    return '';
  }
  
  // Remove shell metacharacters
  return arg.replace(/[;&|`$(){}[\]<>]/g, '');
}
