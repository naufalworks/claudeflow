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
 */

import type { AnthropicResponse } from '../types/anthropic.types';

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

    // All validations passed
    return true;
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
