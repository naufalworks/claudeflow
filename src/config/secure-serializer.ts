/**
 * Secure configuration serialization
 * 
 * Ensures sensitive credentials are never written to config files.
 * All sensitive data (tokens, secrets, API keys) should be stored in OS keychain.
 * 
 * Security measures:
 * - Strip all sensitive fields before serialization
 * - Validate output contains no sensitive patterns
 * - Add placeholder text for transparency
 * - Log warnings if sensitive data detected
 */

/**
 * List of sensitive field names that should never appear in config files
 */
const SENSITIVE_FIELDS = [
  'accessToken',
  'refreshToken',
  'clientSecret',
  'apiKey',
  'sessionToken',
  'token',
  'password',
  'secret',
  'key',
  'credentials',
] as const;

/**
 * Patterns that indicate sensitive data in serialized output
 * 
 * Note: Patterns are deliberately tight to avoid false positives.
 * They match only in JSON field contexts with sufficiently long values.
 */
const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,           // Bearer tokens in Authorization headers
  /"(?:access|refresh|session)_?token"\s*:\s*"[^"]{20,}"/i,  // Token fields (>20 chars)
  /"(?:api|client)_?(?:key|secret)"\s*:\s*"[^"]{20,}"/i,     // Key/secret fields (>20 chars)
  /"password"\s*:\s*"[^"]{8,}"/i,                              // Password fields (>8 chars)
];

/**
 * Serialize an account object, stripping all sensitive fields
 * 
 * @param account - Account object to serialize
 * @returns Safe account object with sensitive fields removed
 */
export function serializeAccount(account: any): any {
  if (!account || typeof account !== 'object') {
    return account;
  }

  // Create shallow copy
  const safe = { ...account };

  // Remove all sensitive fields
  for (const field of SENSITIVE_FIELDS) {
    if (field in safe) {
      delete safe[field];
    }
  }

  // For kiro-oauth accounts, add placeholder to indicate where credentials are stored
  if (safe.provider === 'kiro-oauth') {
    safe._credentials = 'stored in OS keychain';
  }

  // Recursively clean nested objects
  for (const key in safe) {
    if (typeof safe[key] === 'object' && safe[key] !== null) {
      safe[key] = serializeAccount(safe[key]);
    }
  }

  return safe;
}

/**
 * Validate that serialized JSON contains no sensitive data
 * 
 * @param json - JSON string to validate
 * @returns true if clean, false if sensitive data detected
 */
export function validateNoSensitiveData(json: string): boolean {
  // Check for sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(json)) {
      console.warn(
        `⚠️  Sensitive data pattern detected in config output: ${pattern.source}`
      );
      return false;
    }
  }

  // Check for sensitive field names with non-empty values
  // Only flag fields with values >20 chars (short values are likely placeholders)
  for (const field of SENSITIVE_FIELDS) {
    const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"[^"]{20,}"`, 'i');
    if (fieldPattern.test(json)) {
      console.warn(
        `⚠️  Sensitive field "${field}" with value detected in config output`
      );
      return false;
    }
  }

  return true;
}

/**
 * Serialize entire config object, stripping sensitive data from all accounts
 * 
 * Handles both:
 * - Full config objects with `accounts` array
 * - Individual account objects (detected by `provider` field)
 * 
 * @param config - Config object or account object
 * @returns Safe object with all sensitive fields removed
 */
export function serializeConfig(config: any): any {
  if (!config || typeof config !== 'object') {
    return config;
  }

  // If input looks like an account (has provider field), serialize as account
  if ('provider' in config) {
    return serializeAccount(config);
  }

  // Otherwise treat as config object
  const safe = { ...config };

  // Clean accounts array
  if (Array.isArray(safe.accounts)) {
    safe.accounts = safe.accounts.map(serializeAccount);
  }

  // Clean any other nested objects
  for (const key in safe) {
    if (key !== 'accounts' && typeof safe[key] === 'object' && safe[key] !== null) {
      if (Array.isArray(safe[key])) {
        safe[key] = safe[key].map((item: any) => 
          typeof item === 'object' ? serializeAccount(item) : item
        );
      } else {
        safe[key] = serializeAccount(safe[key]);
      }
    }
  }

  return safe;
}

/**
 * Safely serialize config to JSON string with validation
 * 
 * @param config - Config object to serialize
 * @param pretty - Whether to pretty-print (default: true)
 * @returns JSON string with all sensitive data removed
 * @throws Error if sensitive data detected after serialization
 */
export function safeStringify(config: any, pretty: boolean = true): string {
  // Serialize and strip sensitive data
  const safe = serializeConfig(config);

  // Convert to JSON
  const json = pretty ? JSON.stringify(safe, null, 2) : JSON.stringify(safe);

  // Validate output
  if (!validateNoSensitiveData(json)) {
    throw new Error(
      'Sensitive data detected in config output. This is a security issue. ' +
      'Please report this bug.'
    );
  }

  return json;
}
