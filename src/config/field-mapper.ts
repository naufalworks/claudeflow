/**
 * Case-Insensitive Field Mapper
 *
 * Maps between snake_case and camelCase field names for configuration
 * backward compatibility. This allows users to write config files using
 * either naming convention.
 *
 * Example:
 *   profile_arn → profileArn
 *   request_count → requestCount
 *   expires_at → expiresAt
 */

/**
 * Mapping of snake_case field names to their camelCase equivalents.
 * Covers all fields used in KiroOAuthAccountSchema.
 */
const FIELD_MAP: Record<string, string> = {
  // KiroOAuthAccount fields
  profile_arn: 'profileArn',
  expires_at: 'expiresAt',
  last_used: 'lastUsed',
  request_count: 'requestCount',
  error_count: 'errorCount',
};

/**
 * Reverse mapping: camelCase → snake_case
 */
const REVERSE_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([snake, camel]) => [camel, snake])
);

/**
 * Convert a snake_case field name to camelCase.
 * Returns the original string if no mapping exists.
 */
export function snakeToCamel(fieldName: string): string {
  return FIELD_MAP[fieldName] ?? fieldName;
}

/**
 * Convert a camelCase field name to snake_case.
 * Returns the original string if no mapping exists.
 */
export function camelToSnake(fieldName: string): string {
  return REVERSE_FIELD_MAP[fieldName] ?? fieldName;
}

/**
 * Recursively normalize all object keys from snake_case to camelCase.
 * Handles nested objects and arrays.
 */
export function normalizeKeys<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => normalizeKeys(item)) as T;
  }

  if (typeof obj === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const normalizedKey = snakeToCamel(key);
      normalized[normalizedKey] = normalizeKeys(value);
    }
    return normalized as T;
  }

  return obj as T;
}
