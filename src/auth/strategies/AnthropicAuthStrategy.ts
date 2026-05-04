/**
 * AnthropicAuthStrategy
 * 
 * Authentication strategy for direct Anthropic API accounts.
 * Validates API key format and returns credentials for direct API access.
 * No session management or OAuth flow required.
 */

import type { AuthStrategy, AuthResult } from './AuthStrategy';
import type { Account, AnthropicAccount } from '../../config/schema';

/**
 * Validation constants for Anthropic API keys
 */
const ANTHROPIC_KEY_PREFIX = 'sk-ant-';
const MIN_KEY_LENGTH = 40;
const VALID_KEY_PATTERN = /^[a-zA-Z0-9-]+$/;

/**
 * Authentication strategy for direct Anthropic API accounts
 */
export class AnthropicAuthStrategy implements AuthStrategy {
  /**
   * Authenticate a direct Anthropic account
   * 
   * Validates the API key format without making external API calls.
   * Actual API key verification happens when the client makes requests.
   * 
   * @param account - Account to authenticate
   * @returns Authentication result with API key or error
   */
  async authenticate(account: Account): Promise<AuthResult> {
    // Type guard: ensure this is an Anthropic account
    if (account.provider !== 'anthropic') {
      return {
        success: false,
        error: 'Invalid account type',
      };
    }

    const anthropicAccount = account as AnthropicAccount;

    // Validate API key exists
    if (!anthropicAccount.apiKey) {
      return {
        success: false,
        error: 'Invalid API key format',
      };
    }

    const apiKey = anthropicAccount.apiKey;

    // Validate API key format
    if (!this.isValidApiKeyFormat(apiKey)) {
      return {
        success: false,
        error: 'Invalid API key format',
      };
    }

    // Return success with validated API key
    return {
      success: true,
      apiKey: apiKey,
    };
  }

  /**
   * Validate Anthropic API key format
   * 
   * Checks:
   * - Starts with 'sk-ant-' prefix
   * - Minimum length requirement
   * - Valid character set (alphanumeric + hyphens)
   * 
   * @param apiKey - API key to validate
   * @returns True if format is valid
   */
  private isValidApiKeyFormat(apiKey: string): boolean {
    // Check prefix
    if (!apiKey.startsWith(ANTHROPIC_KEY_PREFIX)) {
      return false;
    }

    // Check minimum length
    if (apiKey.length < MIN_KEY_LENGTH) {
      return false;
    }

    // Check character set
    if (!VALID_KEY_PATTERN.test(apiKey)) {
      return false;
    }

    return true;
  }
}
