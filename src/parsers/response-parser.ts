/**
 * Response Parser
 * 
 * Parses and validates Anthropic API responses.
 * Extracts cache usage data, thinking tokens, and tool use content blocks.
 */

import {
  AnthropicResponse,
  Usage,
  ContentBlock,
  StopReason,
  ServerSentEvent,
  StreamChunk,
  MessageStartChunk,
  ContentBlockStartChunk,
  ContentBlockDeltaChunk,
  ContentBlockStopChunk,
  MessageDeltaChunk,
  MessageStopChunk,
  PingChunk,
  ErrorChunk,
} from '../types/index.js';
import { Result, ParseError } from './request-parser';

/**
 * Response Parser class
 */
export class ResponseParser {
  /**
   * Parse server-sent event into StreamChunk
   * 
   * Parses SSE format incrementally and returns typed stream chunks.
   * Handles different event types: message_start, content_block_delta, message_stop, etc.
   */
  parseStream(event: ServerSentEvent): Result<StreamChunk, ParseError> {
    try {
      // Parse the data field as JSON
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch (error) {
        return {
          success: false,
          error: {
            message: 'Failed to parse SSE data as JSON',
            details: error instanceof Error ? error.message : String(error),
          },
        };
      }

      if (!data || typeof data !== 'object') {
        return {
          success: false,
          error: {
            message: 'SSE data must be an object',
            details: data,
          },
        };
      }

      const chunk = data as Record<string, unknown>;

      if (!chunk.type || typeof chunk.type !== 'string') {
        return {
          success: false,
          error: {
            message: 'Stream chunk must have a type field',
            details: data,
          },
        };
      }

      // Parse based on chunk type
      switch (chunk.type) {
        case 'message_start':
          return this.parseMessageStartChunk(chunk);
        case 'content_block_start':
          return this.parseContentBlockStartChunk(chunk);
        case 'content_block_delta':
          return this.parseContentBlockDeltaChunk(chunk);
        case 'content_block_stop':
          return this.parseContentBlockStopChunk(chunk);
        case 'message_delta':
          return this.parseMessageDeltaChunk(chunk);
        case 'message_stop':
          return this.parseMessageStopChunk(chunk);
        case 'ping':
          return this.parsePingChunk(chunk);
        case 'error':
          return this.parseErrorChunk(chunk);
        default:
          return {
            success: false,
            error: {
              message: `Unknown stream chunk type: ${chunk.type}`,
              details: data,
            },
          };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          message: 'Unexpected error during stream parsing',
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Parse raw JSON into AnthropicResponse
   */
  parse(rawResponse: unknown): Result<AnthropicResponse, ParseError> {
    try {
      // Check if input is an object
      if (!rawResponse || typeof rawResponse !== 'object') {
        return {
          success: false,
          error: {
            message: 'Response must be an object',
            details: rawResponse,
          },
        };
      }

      const res = rawResponse as Record<string, unknown>;

      // Parse required fields
      const id = this.parseId(res.id);
      if (!id.success) return id;

      const type = this.parseType(res.type);
      if (!type.success) return type;

      const role = this.parseRole(res.role);
      if (!role.success) return role;

      const content = this.parseContent(res.content);
      if (!content.success) return content;

      const model = this.parseModel(res.model);
      if (!model.success) return model;

      const stopReason = this.parseStopReason(res.stop_reason);
      if (!stopReason.success) return stopReason;

      const usage = this.parseUsage(res.usage);
      if (!usage.success) return usage;

      // Parse optional fields
      const stopSequence = res.stop_sequence !== undefined 
        ? this.parseStopSequence(res.stop_sequence)
        : { success: true as const, value: undefined };
      if (!stopSequence.success) return stopSequence as Result<AnthropicResponse, ParseError>;

      // Construct the response object
      const response: AnthropicResponse = {
        id: id.value,
        type: type.value,
        role: role.value,
        content: content.value,
        model: model.value,
        stop_reason: stopReason.value,
        usage: usage.value,
        ...(stopSequence.value !== undefined && { stop_sequence: stopSequence.value }),
      };

      return { success: true, value: response };
    } catch (error) {
      return {
        success: false,
        error: {
          message: 'Unexpected error during response parsing',
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // ============================================================================
  // Private parsing methods
  // ============================================================================

  private parseId(value: unknown): Result<string, ParseError> {
    if (typeof value !== 'string' || value.trim() === '') {
      return {
        success: false,
        error: {
          message: 'Response id must be a non-empty string',
          field: 'id',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseType(value: unknown): Result<'message', ParseError> {
    if (value !== 'message') {
      return {
        success: false,
        error: {
          message: 'Response type must be "message"',
          field: 'type',
          details: value,
        },
      };
    }
    return { success: true, value: 'message' };
  }

  private parseRole(value: unknown): Result<'assistant', ParseError> {
    if (value !== 'assistant') {
      return {
        success: false,
        error: {
          message: 'Response role must be "assistant"',
          field: 'role',
          details: value,
        },
      };
    }
    return { success: true, value: 'assistant' };
  }

  private parseContent(value: unknown): Result<ContentBlock[], ParseError> {
    if (!Array.isArray(value)) {
      return {
        success: false,
        error: {
          message: 'Response content must be an array',
          field: 'content',
          details: value,
        },
      };
    }

    const blocks: ContentBlock[] = [];
    for (let i = 0; i < value.length; i++) {
      const block = this.parseContentBlock(value[i]);
      if (!block.success) {
        return {
          success: false,
          error: {
            message: `Invalid content block at index ${i}: ${block.error.message}`,
            field: `content[${i}]`,
            details: block.error.details,
          },
        };
      }
      blocks.push(block.value);
    }

    return { success: true, value: blocks };
  }

  private parseContentBlock(value: unknown): Result<ContentBlock, ParseError> {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: {
          message: 'Content block must be an object',
          details: value,
        },
      };
    }

    const block = value as Record<string, unknown>;

    if (!block.type || typeof block.type !== 'string') {
      return {
        success: false,
        error: {
          message: 'Content block must have a type field',
          details: value,
        },
      };
    }

    // Parse based on type
    switch (block.type) {
      case 'text':
        return this.parseTextContentBlock(block);
      case 'tool_use':
        return this.parseToolUseContentBlock(block);
      case 'thinking':
        return this.parseThinkingContentBlock(block);
      default:
        return {
          success: false,
          error: {
            message: `Unknown content block type: ${block.type}`,
            details: value,
          },
        };
    }
  }

  private parseTextContentBlock(block: Record<string, unknown>): Result<ContentBlock, ParseError> {
    if (typeof block.text !== 'string') {
      return {
        success: false,
        error: {
          message: 'Text content block must have a text field',
          details: block,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'text',
        text: block.text,
      },
    };
  }

  private parseToolUseContentBlock(block: Record<string, unknown>): Result<ContentBlock, ParseError> {
    if (typeof block.id !== 'string' || typeof block.name !== 'string') {
      return {
        success: false,
        error: {
          message: 'Tool use content block must have id and name fields',
          details: block,
        },
      };
    }

    if (!block.input || typeof block.input !== 'object') {
      return {
        success: false,
        error: {
          message: 'Tool use content block must have an input object',
          details: block,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      },
    };
  }

  private parseThinkingContentBlock(block: Record<string, unknown>): Result<ContentBlock, ParseError> {
    if (typeof block.thinking !== 'string') {
      return {
        success: false,
        error: {
          message: 'Thinking content block must have a thinking field',
          details: block,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'thinking',
        thinking: block.thinking,
      },
    };
  }

  private parseModel(value: unknown): Result<string, ParseError> {
    if (typeof value !== 'string' || value.trim() === '') {
      return {
        success: false,
        error: {
          message: 'Model must be a non-empty string',
          field: 'model',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseStopReason(value: unknown): Result<StopReason, ParseError> {
    const validStopReasons: StopReason[] = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use'];
    
    if (!validStopReasons.includes(value as StopReason)) {
      return {
        success: false,
        error: {
          message: `Stop reason must be one of: ${validStopReasons.join(', ')}`,
          field: 'stop_reason',
          details: value,
        },
      };
    }

    return { success: true, value: value as StopReason };
  }

  private parseStopSequence(value: unknown): Result<string | undefined, ParseError> {
    if (typeof value !== 'string') {
      return {
        success: false,
        error: {
          message: 'Stop sequence must be a string',
          field: 'stop_sequence',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseUsage(value: unknown): Result<Usage, ParseError> {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: {
          message: 'Usage must be an object',
          field: 'usage',
          details: value,
        },
      };
    }

    const usage = value as Record<string, unknown>;

    // Parse required fields
    if (typeof usage.input_tokens !== 'number' || !Number.isInteger(usage.input_tokens) || usage.input_tokens < 0) {
      return {
        success: false,
        error: {
          message: 'usage.input_tokens must be a non-negative integer',
          field: 'usage.input_tokens',
          details: usage.input_tokens,
        },
      };
    }

    if (typeof usage.output_tokens !== 'number' || !Number.isInteger(usage.output_tokens) || usage.output_tokens < 0) {
      return {
        success: false,
        error: {
          message: 'usage.output_tokens must be a non-negative integer',
          field: 'usage.output_tokens',
          details: usage.output_tokens,
        },
      };
    }

    // Parse optional cache usage fields
    let cacheCreationInputTokens: number | undefined;
    if (usage.cache_creation_input_tokens !== undefined) {
      if (typeof usage.cache_creation_input_tokens !== 'number' || 
          !Number.isInteger(usage.cache_creation_input_tokens) || 
          usage.cache_creation_input_tokens < 0) {
        return {
          success: false,
          error: {
            message: 'usage.cache_creation_input_tokens must be a non-negative integer',
            field: 'usage.cache_creation_input_tokens',
            details: usage.cache_creation_input_tokens,
          },
        };
      }
      cacheCreationInputTokens = usage.cache_creation_input_tokens;
    }

    let cacheReadInputTokens: number | undefined;
    if (usage.cache_read_input_tokens !== undefined) {
      if (typeof usage.cache_read_input_tokens !== 'number' || 
          !Number.isInteger(usage.cache_read_input_tokens) || 
          usage.cache_read_input_tokens < 0) {
        return {
          success: false,
          error: {
            message: 'usage.cache_read_input_tokens must be a non-negative integer',
            field: 'usage.cache_read_input_tokens',
            details: usage.cache_read_input_tokens,
          },
        };
      }
      cacheReadInputTokens = usage.cache_read_input_tokens;
    }

    // Parse optional thinking tokens field
    let thinkingTokens: number | undefined;
    if (usage.thinking_tokens !== undefined) {
      if (typeof usage.thinking_tokens !== 'number' || 
          !Number.isInteger(usage.thinking_tokens) || 
          usage.thinking_tokens < 0) {
        return {
          success: false,
          error: {
            message: 'usage.thinking_tokens must be a non-negative integer',
            field: 'usage.thinking_tokens',
            details: usage.thinking_tokens,
          },
        };
      }
      thinkingTokens = usage.thinking_tokens;
    }

    return {
      success: true,
      value: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        ...(cacheCreationInputTokens !== undefined && { cache_creation_input_tokens: cacheCreationInputTokens }),
        ...(cacheReadInputTokens !== undefined && { cache_read_input_tokens: cacheReadInputTokens }),
        ...(thinkingTokens !== undefined && { thinking_tokens: thinkingTokens }),
      },
    };
  }
  
  // ============================================================================
  // Private streaming chunk parsing methods
  // ============================================================================

  private parseMessageStartChunk(chunk: Record<string, unknown>): Result<MessageStartChunk, ParseError> {
    if (!chunk.message || typeof chunk.message !== 'object') {
      return {
        success: false,
        error: {
          message: 'message_start chunk must have a message field',
          details: chunk,
        },
      };
    }

    const message = chunk.message as Record<string, unknown>;

    // Validate required fields
    if (typeof message.id !== 'string') {
      return {
        success: false,
        error: {
          message: 'message_start.message.id must be a string',
          details: message,
        },
      };
    }

    if (message.type !== 'message') {
      return {
        success: false,
        error: {
          message: 'message_start.message.type must be "message"',
          details: message,
        },
      };
    }

    if (message.role !== 'assistant') {
      return {
        success: false,
        error: {
          message: 'message_start.message.role must be "assistant"',
          details: message,
        },
      };
    }

    if (!Array.isArray(message.content)) {
      return {
        success: false,
        error: {
          message: 'message_start.message.content must be an array',
          details: message,
        },
      };
    }

    if (typeof message.model !== 'string') {
      return {
        success: false,
        error: {
          message: 'message_start.message.model must be a string',
          details: message,
        },
      };
    }

    if (!message.usage || typeof message.usage !== 'object') {
      return {
        success: false,
        error: {
          message: 'message_start.message.usage must be an object',
          details: message,
        },
      };
    }

    const usage = message.usage as Record<string, unknown>;

    if (typeof usage.input_tokens !== 'number' || !Number.isInteger(usage.input_tokens)) {
      return {
        success: false,
        error: {
          message: 'message_start.message.usage.input_tokens must be an integer',
          details: usage,
        },
      };
    }

    if (typeof usage.output_tokens !== 'number' || !Number.isInteger(usage.output_tokens)) {
      return {
        success: false,
        error: {
          message: 'message_start.message.usage.output_tokens must be an integer',
          details: usage,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'message_start',
        message: {
          id: message.id,
          type: 'message',
          role: 'assistant',
          content: [],
          model: message.model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
          },
        },
      },
    };
  }

  private parseContentBlockStartChunk(chunk: Record<string, unknown>): Result<ContentBlockStartChunk, ParseError> {
    if (typeof chunk.index !== 'number' || !Number.isInteger(chunk.index)) {
      return {
        success: false,
        error: {
          message: 'content_block_start chunk must have an integer index field',
          details: chunk,
        },
      };
    }

    if (!chunk.content_block || typeof chunk.content_block !== 'object') {
      return {
        success: false,
        error: {
          message: 'content_block_start chunk must have a content_block field',
          details: chunk,
        },
      };
    }

    const contentBlockResult = this.parseContentBlock(chunk.content_block);
    if (!contentBlockResult.success) {
      return contentBlockResult as Result<ContentBlockStartChunk, ParseError>;
    }

    return {
      success: true,
      value: {
        type: 'content_block_start',
        index: chunk.index,
        content_block: contentBlockResult.value,
      },
    };
  }

  private parseContentBlockDeltaChunk(chunk: Record<string, unknown>): Result<ContentBlockDeltaChunk, ParseError> {
    if (typeof chunk.index !== 'number' || !Number.isInteger(chunk.index)) {
      return {
        success: false,
        error: {
          message: 'content_block_delta chunk must have an integer index field',
          details: chunk,
        },
      };
    }

    if (!chunk.delta || typeof chunk.delta !== 'object') {
      return {
        success: false,
        error: {
          message: 'content_block_delta chunk must have a delta field',
          details: chunk,
        },
      };
    }

    const delta = chunk.delta as Record<string, unknown>;

    if (!delta.type || typeof delta.type !== 'string') {
      return {
        success: false,
        error: {
          message: 'content_block_delta.delta must have a type field',
          details: delta,
        },
      };
    }

    // Parse delta based on type
    if (delta.type === 'text_delta') {
      if (typeof delta.text !== 'string') {
        return {
          success: false,
          error: {
            message: 'text_delta must have a text field',
            details: delta,
          },
        };
      }

      return {
        success: true,
        value: {
          type: 'content_block_delta',
          index: chunk.index,
          delta: {
            type: 'text_delta',
            text: delta.text,
          },
        },
      };
    } else if (delta.type === 'input_json_delta') {
      if (typeof delta.partial_json !== 'string') {
        return {
          success: false,
          error: {
            message: 'input_json_delta must have a partial_json field',
            details: delta,
          },
        };
      }

      return {
        success: true,
        value: {
          type: 'content_block_delta',
          index: chunk.index,
          delta: {
            type: 'input_json_delta',
            partial_json: delta.partial_json,
          },
        },
      };
    } else {
      return {
        success: false,
        error: {
          message: `Unknown delta type: ${delta.type}`,
          details: delta,
        },
      };
    }
  }

  private parseContentBlockStopChunk(chunk: Record<string, unknown>): Result<ContentBlockStopChunk, ParseError> {
    if (typeof chunk.index !== 'number' || !Number.isInteger(chunk.index)) {
      return {
        success: false,
        error: {
          message: 'content_block_stop chunk must have an integer index field',
          details: chunk,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'content_block_stop',
        index: chunk.index,
      },
    };
  }

  private parseMessageDeltaChunk(chunk: Record<string, unknown>): Result<MessageDeltaChunk, ParseError> {
    if (!chunk.delta || typeof chunk.delta !== 'object') {
      return {
        success: false,
        error: {
          message: 'message_delta chunk must have a delta field',
          details: chunk,
        },
      };
    }

    const delta = chunk.delta as Record<string, unknown>;

    const stopReasonResult = this.parseStopReason(delta.stop_reason);
    if (!stopReasonResult.success) {
      return stopReasonResult as Result<MessageDeltaChunk, ParseError>;
    }

    if (!chunk.usage || typeof chunk.usage !== 'object') {
      return {
        success: false,
        error: {
          message: 'message_delta chunk must have a usage field',
          details: chunk,
        },
      };
    }

    const usage = chunk.usage as Record<string, unknown>;

    if (typeof usage.output_tokens !== 'number' || !Number.isInteger(usage.output_tokens)) {
      return {
        success: false,
        error: {
          message: 'message_delta.usage.output_tokens must be an integer',
          details: usage,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'message_delta',
        delta: {
          stop_reason: stopReasonResult.value,
          ...(delta.stop_sequence !== undefined && typeof delta.stop_sequence === 'string' && { stop_sequence: delta.stop_sequence }),
        },
        usage: {
          output_tokens: usage.output_tokens,
        },
      },
    };
  }

  private parseMessageStopChunk(_chunk: Record<string, unknown>): Result<MessageStopChunk, ParseError> {
    return {
      success: true,
      value: {
        type: 'message_stop',
      },
    };
  }

  private parsePingChunk(_chunk: Record<string, unknown>): Result<PingChunk, ParseError> {
    return {
      success: true,
      value: {
        type: 'ping',
      },
    };
  }

  private parseErrorChunk(chunk: Record<string, unknown>): Result<ErrorChunk, ParseError> {
    if (!chunk.error || typeof chunk.error !== 'object') {
      return {
        success: false,
        error: {
          message: 'error chunk must have an error field',
          details: chunk,
        },
      };
    }

    const error = chunk.error as Record<string, unknown>;

    if (typeof error.type !== 'string') {
      return {
        success: false,
        error: {
          message: 'error.type must be a string',
          details: error,
        },
      };
    }

    if (typeof error.message !== 'string') {
      return {
        success: false,
        error: {
          message: 'error.message must be a string',
          details: error,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'error',
        error: {
          type: error.type,
          message: error.message,
        },
      },
    };
  }
}
