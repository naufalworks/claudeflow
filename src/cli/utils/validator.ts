/**
 * Validator Utility
 * 
 * Input validation utilities for CLI
 */

import type { CLIConfig } from '../types/cli.types.js';

/**
 * Validate Machine ID format
 */
export function validateMachineId(machineId: string): { valid: boolean; error?: string } {
  if (!machineId || machineId.trim() === '') {
    return { valid: false, error: 'Machine ID is required' };
  }

  if (machineId.length < 10) {
    return { valid: false, error: 'Machine ID must be at least 10 characters' };
  }

  if (machineId.length > 100) {
    return { valid: false, error: 'Machine ID must be less than 100 characters' };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(machineId)) {
    return { valid: false, error: 'Machine ID can only contain letters, numbers, hyphens, and underscores' };
  }

  return { valid: true };
}

/**
 * Validate API Key format
 */
export function validateApiKey(apiKey: string): { valid: boolean; error?: string } {
  if (!apiKey || apiKey.trim() === '') {
    return { valid: false, error: 'API Key is required' };
  }

  if (apiKey.length < 20) {
    return { valid: false, error: 'API Key must be at least 20 characters' };
  }

  if (apiKey.length > 200) {
    return { valid: false, error: 'API Key must be less than 200 characters' };
  }

  return { valid: true };
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url || url.trim() === '') {
    return { valid: false, error: 'URL is required' };
  }

  try {
    const parsed = new URL(url);
    
    // Check protocol
    if (!['http:', 'https:', 'redis:', 'rediss:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http, https, redis, or rediss protocol' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validate Account ID format
 */
export function validateAccountId(accountId: string): { valid: boolean; error?: string } {
  if (!accountId || accountId.trim() === '') {
    return { valid: false, error: 'Account ID is required' };
  }

  if (accountId.length < 3) {
    return { valid: false, error: 'Account ID must be at least 3 characters' };
  }

  if (accountId.length > 50) {
    return { valid: false, error: 'Account ID must be less than 50 characters' };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
    return { valid: false, error: 'Account ID can only contain letters, numbers, hyphens, and underscores' };
  }

  return { valid: true };
}

/**
 * Validate combo name format
 */
export function validateComboName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Combo name is required' };
  }

  if (name.length < 3) {
    return { valid: false, error: 'Combo name must be at least 3 characters' };
  }

  if (name.length > 50) {
    return { valid: false, error: 'Combo name must be less than 50 characters' };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores, spaces)
  if (!/^[a-zA-Z0-9_\- ]+$/.test(name)) {
    return { valid: false, error: 'Combo name can only contain letters, numbers, hyphens, underscores, and spaces' };
  }

  return { valid: true };
}

/**
 * Validate profile name format
 */
export function validateProfileName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Profile name is required' };
  }

  if (name.length < 3) {
    return { valid: false, error: 'Profile name must be at least 3 characters' };
  }

  if (name.length > 50) {
    return { valid: false, error: 'Profile name must be less than 50 characters' };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { valid: false, error: 'Profile name can only contain letters, numbers, hyphens, and underscores' };
  }

  // Reserved names
  const reserved = ['default', 'config', 'backup', 'temp', 'test'];
  if (reserved.includes(name.toLowerCase())) {
    return { valid: false, error: `Profile name '${name}' is reserved` };
  }

  return { valid: true };
}

/**
 * Validate port number
 */
export function validatePort(port: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(port)) {
    return { valid: false, error: 'Port must be an integer' };
  }

  if (port < 1024 || port > 65535) {
    return { valid: false, error: 'Port must be between 1024 and 65535' };
  }

  return { valid: true };
}

/**
 * Validate log level
 */
export function validateLogLevel(level: string): { valid: boolean; error?: string } {
  const validLevels = ['debug', 'info', 'warn', 'error'];
  
  if (!validLevels.includes(level)) {
    return { valid: false, error: `Log level must be one of: ${validLevels.join(', ')}` };
  }

  return { valid: true };
}

/**
 * Validate configuration object
 */
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration must be an object'] };
  }

  const cfg = config as Partial<CLIConfig>;

  // Validate version
  if (!cfg.version || typeof cfg.version !== 'string') {
    errors.push('version: must be a string');
  }

  // Validate activeProfile
  if (!cfg.activeProfile || typeof cfg.activeProfile !== 'string') {
    errors.push('activeProfile: must be a string');
  }

  // Validate accounts
  if (!Array.isArray(cfg.accounts)) {
    errors.push('accounts: must be an array');
  } else {
    cfg.accounts.forEach((account, index) => {
      if (!account.id) {
        errors.push(`accounts[${index}].id: is required`);
      }
      if (!account.provider) {
        errors.push(`accounts[${index}].provider: is required`);
      }
      // apiKey is required for anthropic, proxy, and kiro (legacy) providers
      // but NOT for kiro-oauth (credentials stored in OS keychain)
      if (
        account.provider !== 'kiro-oauth' &&
        !('apiKey' in account && account.apiKey)
      ) {
        errors.push(`accounts[${index}].apiKey: is required`);
      }
      
      // Validate provider-specific fields
      if (account.provider === 'kiro') {
        if (!account.kiroConfig?.machineId) {
          errors.push(`accounts[${index}].kiroConfig.machineId: is required for OAuth accounts`);
        }
        if (!account.kiroConfig?.mitmRouterUrl) {
          errors.push(`accounts[${index}].kiroConfig.mitmRouterUrl: is required for OAuth accounts`);
        }
      } else if (account.provider === 'proxy') {
        if (!('baseURL' in account && account.baseURL)) {
          errors.push(`accounts[${index}].baseURL: is required for proxy accounts`);
        }
      } else if (account.provider === 'kiro-oauth') {
        // Validate kiro-oauth specific fields
        if (!('region' in account && account.region)) {
          errors.push(`accounts[${index}].region: is required for kiro-oauth accounts`);
        }
        if (!('profileArn' in account && account.profileArn)) {
          errors.push(`accounts[${index}].profileArn: is required for kiro-oauth accounts`);
        }
      }
    });
  }

  // Validate combos
  if (!Array.isArray(cfg.combos)) {
    errors.push('combos: must be an array');
  } else {
    cfg.combos.forEach((combo, index) => {
      if (!combo.name) {
        errors.push(`combos[${index}].name: is required`);
      }
      if (!Array.isArray(combo.accounts)) {
        errors.push(`combos[${index}].accounts: must be an array`);
      }
      if (!combo.strategy) {
        errors.push(`combos[${index}].strategy: is required`);
      }
    });
  }

  // Validate infrastructure
  if (!cfg.infrastructure || typeof cfg.infrastructure !== 'object') {
    errors.push('infrastructure: must be an object');
  } else {
    const infra = cfg.infrastructure;
    if (!infra.qdrantUrl) {
      errors.push('infrastructure.qdrantUrl: is required');
    }
    if (!infra.redisUrl) {
      errors.push('infrastructure.redisUrl: is required');
    }
  }

  // Validate daemon
  if (!cfg.daemon || typeof cfg.daemon !== 'object') {
    errors.push('daemon: must be an object');
  } else {
    const daemon = cfg.daemon;
    if (typeof daemon.port !== 'number') {
      errors.push('daemon.port: must be a number');
    }
    if (!daemon.host) {
      errors.push('daemon.host: is required');
    }
    if (!daemon.logLevel) {
      errors.push('daemon.logLevel: is required');
    }
  }

  // Validate preferences
  if (!cfg.preferences || typeof cfg.preferences !== 'object') {
    errors.push('preferences: must be an object');
  } else {
    const prefs = cfg.preferences;
    if (typeof prefs.colorOutput !== 'boolean') {
      errors.push('preferences.colorOutput: must be a boolean');
    }
    if (typeof prefs.progressBars !== 'boolean') {
      errors.push('preferences.progressBars: must be a boolean');
    }
    if (typeof prefs.autoUpdate !== 'boolean') {
      errors.push('preferences.autoUpdate: must be a boolean');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate email format
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || email.trim() === '') {
    return { valid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
}

/**
 * Validate file path
 */
export function validateFilePath(path: string): { valid: boolean; error?: string } {
  if (!path || path.trim() === '') {
    return { valid: false, error: 'File path is required' };
  }

  // Check for invalid characters
  const invalidChars = /[<>:"|?*\x00-\x1F]/;
  if (invalidChars.test(path)) {
    return { valid: false, error: 'File path contains invalid characters' };
  }

  return { valid: true };
}
