/**
 * Unrecoverable Error Detection
 *
 * Detects OAuth errors that indicate the account needs re-authentication
 * and should not be retried. Based on 9router's implementation.
 *
 * Common unrecoverable errors:
 * - refresh_token_reused: Auth0 detects token reuse, revokes entire token family
 * - invalid_grant: Refresh token expired or revoked
 * - token_expired: Token has expired and cannot be refreshed
 * - invalid_token: Token is malformed or invalid
 */

/**
 * OAuth error codes that indicate unrecoverable errors
 */
export const UNRECOVERABLE_ERROR_CODES = [
  'refresh_token_reused',
  'invalid_grant',
  'token_expired',
  'invalid_token',
  'invalid_refresh_token',
  'unauthorized_client',
] as const;

export type UnrecoverableErrorCode = typeof UNRECOVERABLE_ERROR_CODES[number];

/**
 * Result of unrecoverable error check
 */
export interface UnrecoverableErrorResult {
  isUnrecoverable: boolean;
  errorCode?: UnrecoverableErrorCode;
  message?: string;
}

/**
 * Check if an error response indicates an unrecoverable OAuth error
 *
 * @param error - Error object or response body
 * @param statusCode - HTTP status code (optional)
 * @returns Result indicating if error is unrecoverable
 */
export function isUnrecoverableError(
  error: any,
  statusCode?: number
): UnrecoverableErrorResult {
  // Check for 401 Unauthorized - often indicates token issues
  if (statusCode === 401) {
    return {
      isUnrecoverable: true,
      errorCode: 'invalid_token',
      message: 'Authentication failed - token may be expired or invalid',
    };
  }

  // Try to extract error code from various error formats
  let errorCode: string | null = null;
  let errorMessage: string | undefined;

  // Format 1: { error: { code: "..." } }
  if (error?.error?.code) {
    errorCode = error.error.code;
    errorMessage = error.error.message;
  }
  // Format 2: { error: "..." }
  else if (typeof error?.error === 'string') {
    errorCode = error.error;
    errorMessage = error.error_description || error.message;
  }
  // Format 3: { code: "..." }
  else if (error?.code) {
    errorCode = error.code;
    errorMessage = error.message;
  }
  // Format 4: Error object with message
  else if (error instanceof Error) {
    // Try to parse JSON from error message
    try {
      const parsed = JSON.parse(error.message);
      if (parsed?.error?.code) {
        errorCode = parsed.error.code;
      } else if (typeof parsed?.error === 'string') {
        errorCode = parsed.error;
      }
    } catch {
      // Not JSON, check if message contains error code
      for (const code of UNRECOVERABLE_ERROR_CODES) {
        if (error.message.includes(code)) {
          errorCode = code;
          break;
        }
      }
    }
    errorMessage = error.message;
  }
  // Format 5: String error
  else if (typeof error === 'string') {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(error);
      if (parsed?.error?.code) {
        errorCode = parsed.error.code;
      } else if (typeof parsed?.error === 'string') {
        errorCode = parsed.error;
      }
    } catch {
      // Not JSON, check if string contains error code
      for (const code of UNRECOVERABLE_ERROR_CODES) {
        if (error.includes(code)) {
          errorCode = code;
          break;
        }
      }
    }
    errorMessage = error;
  }

  // Check if error code is unrecoverable
  if (errorCode && UNRECOVERABLE_ERROR_CODES.includes(errorCode as any)) {
    return {
      isUnrecoverable: true,
      errorCode: errorCode as UnrecoverableErrorCode,
      message: errorMessage || `Unrecoverable OAuth error: ${errorCode}`,
    };
  }

  return {
    isUnrecoverable: false,
  };
}

/**
 * Check if an error indicates the account should be marked as permanently failed
 *
 * @param error - Error object or response body
 * @param statusCode - HTTP status code (optional)
 * @returns true if account should be marked as permanently failed
 */
export function shouldMarkAccountFailed(error: any, statusCode?: number): boolean {
  const result = isUnrecoverableError(error, statusCode);
  return result.isUnrecoverable;
}

/**
 * Get user-friendly message for unrecoverable error
 *
 * @param errorCode - Unrecoverable error code
 * @returns User-friendly error message
 */
export function getUnrecoverableErrorMessage(errorCode: UnrecoverableErrorCode): string {
  switch (errorCode) {
    case 'refresh_token_reused':
      return 'Refresh token was reused. Please re-authenticate.';
    case 'invalid_grant':
      return 'Refresh token expired or revoked. Please re-authenticate.';
    case 'token_expired':
      return 'Token has expired. Please re-authenticate.';
    case 'invalid_token':
      return 'Token is invalid. Please re-authenticate.';
    case 'invalid_refresh_token':
      return 'Refresh token is invalid. Please re-authenticate.';
    case 'unauthorized_client':
      return 'Client is not authorized. Please re-authenticate.';
    default:
      return 'Authentication failed. Please re-authenticate.';
  }
}
