/**
 * ResponseFormatValidator
 * 
 * Validates that API responses are in raw Anthropic format.
 * Rejects OpenAI format and other non-Anthropic formats.
 * 
 * CRITICAL: ClaudeFlow ONLY supports raw Anthropic format.
 * NO format conversion is supported anywhere in the system.
 * 
 * Security features:
 * - Prototype pollution protection via hasOwnProperty checks
 * - Size limits to prevent DoS attacks
 * - Range validation for numeric values
 * - Deep validation of content blocks
 * 
 * Enhanced features:
 * - Validates prompt caching fields (cache_creation_input_tokens, cache_read_input_tokens)
 * - Provides detailed validation errors via validateDetailed() method
 * - Detailed OpenAI format rejection logging
 */

import type { AnthropicResponse } from '../types/anthropic.types';

/**
 * Validation result with detailed error messages
 */
export interface ValidationResult {
  /** Whether the response is valid */
  valid: boolean;
  /** Array of validation error messages (empty if valid) */
  errors: string[];
}

/**
 * Validation limits to prevent DoS attacks
 */
const VALIDATION_LIMITS = {
  MAX_STRING_LENGTH: 1000,
  MAX_CONTENT_BLOCKS: 100,
  MAX_TOKEN_COUNT: 1000000,
  MIN_TOKEN_COUNT: 0,
} as const;

/**
 * Valid content block types in Anthropic format
 */
const VALID_CONTENT_TYPES = ['text', 'image', 'tool_use', 'tool_result', 'thinking'] as const;

/**
 * Response format validator
 * 
 * Validates that responses conform to raw Anthropic API format.
 * Used by all API clients to ensure format consistency.
 */
export class ResponseFormatValidator {
  /**
   * Validate that response is in raw Anthropic format
   * 
   * Checks for required Anthropic fields:
   * - id: string (starts with "msg_", max 1000 chars)
   * - type: "message"
   * - role: "assistant"
   * - content: array of ContentBlock (max 100 items)
   * - model: string (max 1000 chars)
   * - stop_reason: string | null
   * - usage: object with input_tokens and output_tokens (0-1000000)
   * 
   * Rejects:
   * - OpenAI format (has "choices" array)
   * - Malformed responses
   * - Responses exceeding size limits
   * 
   * @param response - Response object to validate (unknown type for safety)
   * @returns True if valid Anthropic format, false otherwise
   */
  isAnthropicFormat(response: unknown): response is AnthropicResponse {
    // Type guard: must be object
    if (!response || typeof response !== 'object') {
      return false;
    }

    // Cast to any for property access (we'll validate each property)
    const resp = response as Record<string, unknown>;

    // Reject OpenAI format (has "choices" array)
    if (this.hasOwnProperty(resp, 'choices')) {
      return false;
    }

    // Validate id field
    if (!this.hasOwnProperty(resp, 'id') || 
        typeof resp.id !== 'string' || 
        !resp.id.startsWith('msg_') ||
        resp.id.length > VALIDATION_LIMITS.MAX_STRING_LENGTH) {
      return false;
    }

    // Validate type field
    if (!this.hasOwnProperty(resp, 'type') || resp.type !== 'message') {
      return false;
    }

    // Validate role field
    if (!this.hasOwnProperty(resp, 'role') || resp.role !== 'assistant') {
      return false;
    }

    // Validate content field
    if (!this.hasOwnProperty(resp, 'content') || !Array.isArray(resp.content)) {
      return false;
    }

    // Validate content array size
    if (resp.content.length > VALIDATION_LIMITS.MAX_CONTENT_BLOCKS) {
      return false;
    }

    // Validate each content block
    for (const block of resp.content) {
      if (!this.isValidContentBlock(block)) {
        return false;
      }
    }

    // Validate model field
    if (!this.hasOwnProperty(resp, 'model') || 
        typeof resp.model !== 'string' ||
        resp.model.length > VALIDATION_LIMITS.MAX_STRING_LENGTH) {
      return false;
    }

    // Validate stop_reason field (can be null or string)
    if (!this.hasOwnProperty(resp, 'stop_reason')) {
      return false;
    }
    if (resp.stop_reason !== null && 
        (typeof resp.stop_reason !== 'string' || 
         resp.stop_reason.length > VALIDATION_LIMITS.MAX_STRING_LENGTH)) {
      return false;
    }

    // Validate usage object
    if (!this.hasOwnProperty(resp, 'usage') || 
        typeof resp.usage !== 'object' || 
        resp.usage === null) {
      return false;
    }

    const usage = resp.usage as Record<string, unknown>;

    // Validate input_tokens
    if (!this.hasOwnProperty(usage, 'input_tokens') || 
        typeof usage.input_tokens !== 'number' ||
        !this.isValidTokenCount(usage.input_tokens)) {
      return false;
    }

    // Validate output_tokens
    if (!this.hasOwnProperty(usage, 'output_tokens') || 
        typeof usage.output_tokens !== 'number' ||
        !this.isValidTokenCount(usage.output_tokens)) {
      return false;
    }

    // Validate cache_creation_input_tokens (optional)
    if (this.hasOwnProperty(usage, 'cache_creation_input_tokens')) {
      if (typeof usage.cache_creation_input_tokens !== 'number' ||
          !this.isValidTokenCount(usage.cache_creation_input_tokens)) {
        return false;
      }
    }

    // Validate cache_read_input_tokens (optional)
    if (this.hasOwnProperty(usage, 'cache_read_input_tokens')) {
      if (typeof usage.cache_read_input_tokens !== 'number' ||
          !this.isValidTokenCount(usage.cache_read_input_tokens)) {
        return false;
      }
    }

    // All validations passed
    return true;
  }

  /**
   * Validate response with detailed error messages
   * 
   * Performs the same validation as isAnthropicFormat() but collects
   * all validation errors instead of returning on first failure.
   * 
   * Useful for debugging format issues and providing actionable feedback.
   * 
   * @param response - Response object to validate
   * @returns Validation result with detailed error messages
   */
  validateDetailed(response: unknown): ValidationResult {
    const errors: string[] = [];

    // Type guard: must be object
    if (!response || typeof response !== 'object') {
      errors.push('Response is not an object');
      return { valid: false, errors };
    }

    const resp = response as Record<string, unknown>;

    // Check for OpenAI format (detailed error message)
    if (this.hasOwnProperty(resp, 'choices')) {
      errors.push(
        '❌ REJECTED: Response is in OpenAI format (detected "choices" field).\n\n' +
        'ClaudeFlow ONLY supports native Anthropic format. OpenAI format loses critical capabilities:\n' +
        '  • Extended thinking (thinking.budget_tokens)\n' +
        '  • Prompt caching (cache_control markers)\n' +
        '  • Thinking blocks and cache usage metrics\n\n' +
        'SOLUTION:\n' +
        '  1. Use direct Anthropic API (recommended)\n' +
        '  2. Use a true MITM proxy that forwards Anthropic format unchanged\n' +
        '  3. Use Kiro OAuth for free Claude access\n\n' +
        'NOT SUPPORTED:\n' +
        '  ❌ 9router (converts to OpenAI format)\n' +
        '  ❌ OpenRouter (OpenAI format)\n' +
        '  ❌ Any proxy that returns OpenAI format\n\n' +
        'See docs/ANTHROPIC_FORMAT_ONLY.md for migration guide.'
      );
    }

    // Additional OpenAI format indicators
    if (this.hasOwnProperty(resp, 'object') && resp.object === 'chat.completion') {
      errors.push(
        '❌ REJECTED: Detected OpenAI chat completion format (object: "chat.completion").\n' +
        'This is OpenAI format, not Anthropic format. See docs/ANTHROPIC_FORMAT_ONLY.md for details.'
      );
    }

    // Check for other OpenAI-specific fields
    if (this.hasOwnProperty(resp, 'created') && this.hasOwnProperty(resp, 'model') &&
        !this.hasOwnProperty(resp, 'type')) {
      errors.push(
        '❌ REJECTED: Response structure matches OpenAI format (has "created" but missing "type").\n' +
        'ClaudeFlow requires native Anthropic format.'
      );
    }

    // Validate id field
    if (!this.hasOwnProperty(resp, 'id')) {
      errors.push('Missing required field: id');
    } else if (typeof resp.id !== 'string') {
      errors.push('Field "id" must be a string');
    } else if (!resp.id.startsWith('msg_')) {
      errors.push('Field "id" must start with "msg_" (Anthropic message ID format)');
    } else if (resp.id.length > VALIDATION_LIMITS.MAX_STRING_LENGTH) {
      errors.push(`Field "id" exceeds maximum length of ${VALIDATION_LIMITS.MAX_STRING_LENGTH}`);
    }

    // Validate type field
    if (!this.hasOwnProperty(resp, 'type')) {
      errors.push('Missing required field: type');
    } else if (resp.type !== 'message') {
      errors.push('Field "type" must be "message"');
    }

    // Validate role field
    if (!this.hasOwnProperty(resp, 'role')) {
      errors.push('Missing required field: role');
    } else if (resp.role !== 'assistant') {
      errors.push('Field "role" must be "assistant"');
    }

    // Validate content field
    if (!this.hasOwnProperty(resp, 'content')) {
      errors.push('Missing required field: content');
    } else if (!Array.isArray(resp.content)) {
      errors.push('Field "content" must be an array');
    } else {
      // Validate content array size
      if (resp.content.length > VALIDATION_LIMITS.MAX_CONTENT_BLOCKS) {
        errors.push(
          `Field "content" exceeds maximum of ${VALIDATION_LIMITS.MAX_CONTENT_BLOCKS} blocks`
        );
      }

      // Validate each content block
      resp.content.forEach((block, index) => {
        const blockError = this.validateContentBlock(block);
        if (blockError) {
          errors.push(`Invalid content block at index ${index}: ${blockError}`);
        }
      });
    }

    // Validate model field
    if (!this.hasOwnProperty(resp, 'model')) {
      errors.push('Missing required field: model');
    } else if (typeof resp.model !== 'string') {
      errors.push('Field "model" must be a string');
    } else if (resp.model.length > VALIDATION_LIMITS.MAX_STRING_LENGTH) {
      errors.push(`Field "model" exceeds maximum length of ${VALIDATION_LIMITS.MAX_STRING_LENGTH}`);
    }

    // Validate stop_reason field
    if (!this.hasOwnProperty(resp, 'stop_reason')) {
      errors.push('Missing required field: stop_reason');
    } else if (resp.stop_reason !== null && typeof resp.stop_reason !== 'string') {
      errors.push('Field "stop_reason" must be a string or null');
    } else if (
      resp.stop_reason !== null &&
      resp.stop_reason.length > VALIDATION_LIMITS.MAX_STRING_LENGTH
    ) {
      errors.push(
        `Field "stop_reason" exceeds maximum length of ${VALIDATION_LIMITS.MAX_STRING_LENGTH}`
      );
    }

    // Validate usage object
    if (!this.hasOwnProperty(resp, 'usage')) {
      errors.push('Missing required field: usage');
    } else if (typeof resp.usage !== 'object' || resp.usage === null) {
      errors.push('Field "usage" must be an object');
    } else {
      const usage = resp.usage as Record<string, unknown>;

      // Validate input_tokens
      const inputTokensError = this.validateUsageField(
        usage,
        'input_tokens',
        true
      );
      if (inputTokensError) {
        errors.push(inputTokensError);
      }

      // Validate output_tokens
      const outputTokensError = this.validateUsageField(
        usage,
        'output_tokens',
        true
      );
      if (outputTokensError) {
        errors.push(outputTokensError);
      }

      // Validate cache_creation_input_tokens (optional)
      const cacheCreationError = this.validateUsageField(
        usage,
        'cache_creation_input_tokens',
        false
      );
      if (cacheCreationError) {
        errors.push(cacheCreationError);
      }

      // Validate cache_read_input_tokens (optional)
      const cacheReadError = this.validateUsageField(
        usage,
        'cache_read_input_tokens',
        false
      );
      if (cacheReadError) {
        errors.push(cacheReadError);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a content block structure
   * 
   * Checks that the block has a valid 'type' field matching one of:
   * - 'text'
   * - 'image'
   * - 'tool_use'
   * - 'tool_result'
   * - 'thinking'
   * 
   * @param block - Content block to validate
   * @returns True if valid content block
   */
  private isValidContentBlock(block: unknown): boolean {
    if (!block || typeof block !== 'object') {
      return false;
    }

    const contentBlock = block as Record<string, unknown>;

    // Check for type field
    if (!this.hasOwnProperty(contentBlock, 'type') || 
        typeof contentBlock.type !== 'string') {
      return false;
    }

    // Validate type is one of the valid content types
    return VALID_CONTENT_TYPES.includes(contentBlock.type as any);
  }

  /**
   * Validate a content block and return error message if invalid
   * 
   * @param block - Content block to validate
   * @returns Error message if invalid, null if valid
   */
  private validateContentBlock(block: unknown): string | null {
    if (!block || typeof block !== 'object') {
      return 'Content block must be an object';
    }

    const contentBlock = block as Record<string, unknown>;

    // Check for type field
    if (!this.hasOwnProperty(contentBlock, 'type')) {
      return 'Missing required field: type';
    }

    if (typeof contentBlock.type !== 'string') {
      return 'Field "type" must be a string';
    }

    // Validate type is one of the valid content types
    if (!VALID_CONTENT_TYPES.includes(contentBlock.type as any)) {
      return `Invalid content type: "${contentBlock.type}". Must be one of: ${VALID_CONTENT_TYPES.join(', ')}`;
    }

    return null;
  }

  /**
   * Validate a usage field (token count)
   * 
   * @param usage - Usage object
   * @param fieldName - Field name to validate
   * @param required - Whether the field is required
   * @returns Error message if invalid, null if valid
   */
  private validateUsageField(
    usage: Record<string, unknown>,
    fieldName: string,
    required: boolean
  ): string | null {
    const hasField = this.hasOwnProperty(usage, fieldName);

    // If field is required but missing
    if (required && !hasField) {
      return `Missing required field in usage: ${fieldName}`;
    }

    // If field is optional and missing, that's OK
    if (!required && !hasField) {
      return null;
    }

    // Field exists, validate it
    const value = usage[fieldName];

    if (typeof value !== 'number') {
      return `Field "usage.${fieldName}" must be a number`;
    }

    if (!this.isValidTokenCount(value)) {
      return `Field "usage.${fieldName}" must be an integer between ${VALIDATION_LIMITS.MIN_TOKEN_COUNT} and ${VALIDATION_LIMITS.MAX_TOKEN_COUNT}`;
    }

    return null;
  }

  /**
   * Validate token count is within acceptable range
   * 
   * @param count - Token count to validate
   * @returns True if valid (0 to 1000000)
   */
  private isValidTokenCount(count: number): boolean {
    return Number.isInteger(count) && 
           count >= VALIDATION_LIMITS.MIN_TOKEN_COUNT && 
           count <= VALIDATION_LIMITS.MAX_TOKEN_COUNT;
  }

  /**
   * Safe hasOwnProperty check to prevent prototype pollution
   * 
   * @param obj - Object to check
   * @param prop - Property name
   * @returns True if object has own property
   */
  private hasOwnProperty(obj: Record<string, unknown>, prop: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }
}
