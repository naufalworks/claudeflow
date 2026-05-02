/**
 * Response Formatter
 * 
 * Serializes AnthropicResponse objects back to valid Anthropic API JSON format.
 * Preserves all Anthropic-specific features during serialization.
 */

import {
  AnthropicResponse,
  ContentBlock,
  Usage,
} from '../types';

/**
 * Response Formatter class
 */
export class ResponseFormatter {
  /**
   * Format AnthropicResponse to JSON
   * 
   * Serializes the response object back to valid Anthropic API JSON format.
   * Preserves all optional fields and Anthropic-specific features.
   * Excludes undefined values from the output.
   */
  format(response: AnthropicResponse): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      id: response.id,
      type: response.type,
      role: response.role,
      content: this.formatContentBlocks(response.content),
      model: response.model,
      stop_reason: response.stop_reason,
      usage: this.formatUsage(response.usage),
    };

    // Add optional fields if present (and not undefined)
    if (response.stop_sequence !== undefined) {
      formatted.stop_sequence = response.stop_sequence;
    }

    return formatted;
  }

  // ============================================================================
  // Private formatting methods
  // ============================================================================

  private formatContentBlocks(blocks: ContentBlock[]): unknown[] {
    return blocks.map(block => this.formatContentBlock(block));
  }

  private formatContentBlock(block: ContentBlock): Record<string, unknown> {
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          text: block.text,
        };

      case 'thinking':
        return {
          type: 'thinking',
          thinking: block.thinking,
        };

      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };

      case 'image':
        return {
          type: 'image',
          source: block.source,
          ...(block.cache_control && { cache_control: block.cache_control }),
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: typeof block.content === 'string' 
            ? block.content 
            : this.formatContentBlocks(block.content),
          ...(block.is_error !== undefined && { is_error: block.is_error }),
        };

      default:
        // This should never happen with proper TypeScript types
        throw new Error(`Unknown content block type: ${(block as any).type}`);
    }
  }

  private formatUsage(usage: Usage): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    };

    // Add optional cache usage fields if present
    if (usage.cache_creation_input_tokens !== undefined) {
      formatted.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    }

    if (usage.cache_read_input_tokens !== undefined) {
      formatted.cache_read_input_tokens = usage.cache_read_input_tokens;
    }

    // Add optional thinking tokens if present
    if (usage.thinking_tokens !== undefined) {
      formatted.thinking_tokens = usage.thinking_tokens;
    }

    return formatted;
  }
}
