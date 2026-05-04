/**
 * Request Formatter
 * 
 * Serializes AnthropicRequest objects back to valid Anthropic API JSON format.
 * Preserves all Anthropic-specific features during serialization.
 */

import {
  AnthropicRequest,
  Message,
  ContentBlock,
  SystemBlock,
  isStringContent,
} from '../types/index.js';

/**
 * Request Formatter class
 */
export class RequestFormatter {
  /**
   * Format AnthropicRequest to JSON-serializable object
   */
  format(request: AnthropicRequest): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      model: request.model,
      messages: this.formatMessages(request.messages),
      max_tokens: request.max_tokens,
    };

    // Add optional fields if present
    if (request.system !== undefined) {
      formatted.system = this.formatSystem(request.system);
    }

    if (request.temperature !== undefined) {
      formatted.temperature = request.temperature;
    }

    if (request.top_p !== undefined) {
      formatted.top_p = request.top_p;
    }

    if (request.top_k !== undefined) {
      formatted.top_k = request.top_k;
    }

    if (request.stop_sequences !== undefined) {
      formatted.stop_sequences = request.stop_sequences;
    }

    if (request.stream !== undefined) {
      formatted.stream = request.stream;
    }

    if (request.metadata !== undefined) {
      formatted.metadata = request.metadata;
    }

    if (request.thinking !== undefined) {
      formatted.thinking = {
        type: request.thinking.type,
        budget_tokens: request.thinking.budget_tokens,
      };
    }

    if (request.tools !== undefined) {
      formatted.tools = request.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      }));
    }

    if (request.tool_choice !== undefined) {
      formatted.tool_choice = request.tool_choice;
    }

    return formatted;
  }

  /**
   * Format messages array
   */
  private formatMessages(messages: Message[]): Record<string, unknown>[] {
    return messages.map(message => {
      const formatted: Record<string, unknown> = {
        role: message.role,
        content: this.formatMessageContent(message.content),
      };

      if (message.cache_control !== undefined) {
        formatted.cache_control = message.cache_control;
      }

      return formatted;
    });
  }

  /**
   * Format message content (string or ContentBlock[])
   */
  private formatMessageContent(content: string | ContentBlock[]): string | Record<string, unknown>[] {
    if (isStringContent(content)) {
      return content;
    }

    return content.map(block => this.formatContentBlock(block));
  }

  /**
   * Format a single content block
   */
  private formatContentBlock(block: ContentBlock): Record<string, unknown> {
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          text: block.text,
          ...(block.cache_control && { cache_control: block.cache_control }),
        };

      case 'image':
        return {
          type: 'image',
          source: block.source,
          ...(block.cache_control && { cache_control: block.cache_control }),
        };

      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: isStringContent(block.content)
            ? block.content
            : block.content.map(b => this.formatContentBlock(b)),
          ...(block.is_error !== undefined && { is_error: block.is_error }),
        };

      case 'thinking':
        return {
          type: 'thinking',
          thinking: block.thinking,
        };

      default:
        // This should never happen with proper TypeScript types
        throw new Error(`Unknown content block type: ${(block as any).type}`);
    }
  }

  /**
   * Format system prompt (string or SystemBlock[])
   */
  private formatSystem(system: string | SystemBlock[]): string | Record<string, unknown>[] {
    if (typeof system === 'string') {
      return system;
    }

    return system.map(block => ({
      type: 'text',
      text: block.text,
      ...(block.cache_control && { cache_control: block.cache_control }),
    }));
  }

  /**
   * Format to JSON string
   */
  toJSON(request: AnthropicRequest): string {
    return JSON.stringify(this.format(request));
  }
}
