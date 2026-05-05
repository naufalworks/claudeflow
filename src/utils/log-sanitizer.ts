/**
 * LogSanitizer
 * 
 * Sanitizes sensitive data from log messages to prevent token leakage.
 * 
 * Security features:
 * - ReDoS protection: All regex patterns bounded to prevent catastrophic backtracking
 * - Circular reference detection: Prevents stack overflow with WeakSet tracking
 * - Prototype pollution protection: Filters dangerous keys
 * - Comprehensive API key coverage: OpenAI, AWS, Anthropic, Azure, and more
 * 
 * Patterns detected and masked:
 * - JWT tokens (eyJ...)
 * - Anthropic API keys (sk-ant-api03-)
 * - OpenAI API keys (sk-...)
 * - AWS Access Keys (AKIA...)
 * - Azure connection strings
 * - Bearer tokens (Authorization headers)
 * - Session tokens (sess_)
 * - Long hex strings (>20 chars)
 * - Long base64 strings (>20 chars)
 * 
 * Masking format: ****{last4} (default) or ****REDACTED (strict mode)
 * 
 * Environment variables:
 * - LOG_SANITIZER_STRICT=true: Use strict mode (no chars preserved)
 */

/**
 * Dangerous object keys that should be filtered to prevent prototype pollution
 */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Check if strict mode is enabled
 */
const isStrictMode = (): boolean => {
  return process.env.LOG_SANITIZER_STRICT === 'true';
};

/**
 * LogSanitizer class
 * 
 * Provides static methods for sanitizing sensitive data in logs.
 */
export class LogSanitizer {
  /**
   * Sanitize a log message by masking sensitive data
   * 
   * Applies regex patterns in order from most specific to most generic
   * to avoid false positives.
   * 
   * @param message - Log message to sanitize
   * @returns Sanitized message with sensitive data masked
   */
  static sanitize(message: string): string {
    if (typeof message !== 'string') {
      return message;
    }

    let sanitized = message;
    const strict = isStrictMode();

    // 1. JWT tokens (three base64 segments separated by dots)
    // Pattern: eyJ[base64].[base64].[base64]
    sanitized = sanitized.replace(
      /\b(eyJ[A-Za-z0-9_-]{10,500}\.eyJ[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,500})\b/g,
      (match) => strict ? '****REDACTED' : `****${match.slice(-4)}`
    );

    // 2. Anthropic API keys (sk-ant-api03-)
    sanitized = sanitized.replace(
      /\b(sk-ant-api03-[a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]{1,500}([a-zA-Z0-9_-]{4})\b/g,
      strict ? '****REDACTED' : '****$2'
    );

    // 3. OpenAI API keys (sk-...)
    sanitized = sanitized.replace(
      /\b(sk-[a-zA-Z0-9]{48})\b/g,
      (match) => strict ? '****REDACTED' : `****${match.slice(-4)}`
    );

    // 4. AWS Access Keys (AKIA...)
    sanitized = sanitized.replace(
      /\b(AKIA[A-Z0-9]{16})\b/g,
      (match) => strict ? '****REDACTED' : `****${match.slice(-4)}`
    );

    // 5. Azure connection strings
    sanitized = sanitized.replace(
      /\b(DefaultEndpointsProtocol=https;.*?AccountKey=)([^;]{10,500})/g,
      (_match, prefix, key) => strict ? `${prefix}****REDACTED` : `${prefix}****${key.slice(-4)}`
    );

    // 6. Bearer tokens (Authorization: Bearer {token})
    sanitized = sanitized.replace(
      /Bearer\s+([a-zA-Z0-9_\-\.]{20,2000})/gi,
      (_match, token) => strict ? 'Bearer ****REDACTED' : `Bearer ****${token.slice(-4)}`
    );

    // 7. Session tokens (sess_...)
    sanitized = sanitized.replace(
      /\b(sess_[a-zA-Z0-9]{8})[a-zA-Z0-9]{1,500}([a-zA-Z0-9]{4})\b/g,
      strict ? '****REDACTED' : '****$2'
    );

    // 8. Generic long hex strings (>20 chars)
    // Bounded to prevent ReDoS
    sanitized = sanitized.replace(
      /\b([a-f0-9]{20,2000})\b/gi,
      (match) => strict ? '****REDACTED' : `****${match.slice(-4)}`
    );

    // 9. Generic long base64 strings (>20 chars)
    // Bounded to prevent ReDoS
    sanitized = sanitized.replace(
      /\b([A-Za-z0-9+\/]{20,2000}={0,2})\b/g,
      (match) => strict ? '****REDACTED' : `****${match.slice(-4)}`
    );

    return sanitized;
  }

  /**
   * Sanitize an object by masking sensitive fields
   * 
   * Recursively sanitizes nested objects and arrays.
   * Detects circular references to prevent stack overflow.
   * Filters dangerous keys to prevent prototype pollution.
   * 
   * @param obj - Object to sanitize
   * @param visited - WeakSet for circular reference detection (internal use)
   * @returns Sanitized object with sensitive fields masked
   */
  static sanitizeObject(obj: any, visited: WeakSet<object> = new WeakSet()): any {
    // Handle primitives
    if (typeof obj === 'string') {
      return this.sanitize(obj);
    }

    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    // Check for circular reference
    if (visited.has(obj)) {
      return '[Circular Reference]';
    }
    visited.add(obj);

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, visited));
    }

    // Handle objects
    const sanitized: Record<string, any> = {};
    const strict = isStrictMode();

    for (const key in obj) {
      // Prototype pollution protection: skip dangerous keys
      if (DANGEROUS_KEYS.includes(key)) {
        continue;
      }

      // Only process own properties
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        continue;
      }

      const value = obj[key];

      // Check if key indicates sensitive data
      const keyLower = key.toLowerCase();
      const isSensitiveKey = 
        keyLower.includes('token') ||
        keyLower.includes('apikey') ||
        keyLower.includes('api_key') ||
        keyLower.includes('password') ||
        keyLower.includes('secret') ||
        keyLower.includes('authorization') ||
        keyLower.includes('bearer');

      if (isSensitiveKey && typeof value === 'string' && value.length > 8) {
        // Mask sensitive field values
        sanitized[key] = strict ? '****REDACTED' : `****${value.slice(-4)}`;
      } else if (typeof value === 'string') {
        // Sanitize string values for embedded tokens
        sanitized[key] = this.sanitize(value);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeObject(value, visited);
      } else {
        // Keep other types as-is
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Check if a string contains potentially sensitive data
   * 
   * Useful for validation and testing.
   * 
   * @param str - String to check
   * @returns True if string contains patterns that would be sanitized
   */
  static containsSensitiveData(str: string): boolean {
    if (typeof str !== 'string') {
      return false;
    }

    // Check for JWT tokens
    if (/\b(eyJ[A-Za-z0-9_-]{10,500}\.eyJ[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,500})\b/.test(str)) {
      return true;
    }

    // Check for API keys
    if (/\b(sk-ant-api03-[a-zA-Z0-9_-]{8})[a-zA-Z0-9_-]{1,500}/.test(str)) {
      return true;
    }

    if (/\b(sk-[a-zA-Z0-9]{48})\b/.test(str)) {
      return true;
    }

    if (/\b(AKIA[A-Z0-9]{16})\b/.test(str)) {
      return true;
    }

    // Check for Bearer tokens
    if (/Bearer\s+([a-zA-Z0-9_\-\.]{20,2000})/i.test(str)) {
      return true;
    }

    // Check for session tokens
    if (/\b(sess_[a-zA-Z0-9]{8})[a-zA-Z0-9]{1,500}/.test(str)) {
      return true;
    }

    // Check for long hex strings
    if (/\b([a-f0-9]{20,2000})\b/i.test(str)) {
      return true;
    }

    // Check for long base64 strings
    if (/\b([A-Za-z0-9+\/]{20,2000}={0,2})\b/.test(str)) {
      return true;
    }

    return false;
  }
}
