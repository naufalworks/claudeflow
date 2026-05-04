/**
 * Request Parser
 * 
 * Parses and validates Anthropic API requests.
 * Preserves all native Anthropic features including cache_control markers,
 * thinking configuration, tools, and multi-content blocks.
 */

import {
  AnthropicRequest,
  Message,
  ContentBlock,
  ThinkingConfig,
  Tool,
  ToolChoice,
  CacheControl,
  SystemBlock,
  RequestMetadata,
  isContentBlockArray,
} from '../types/index.js';

/**
 * Result type for parser operations
 */
export type Result<T, E> = 
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Parse error with details
 */
export interface ParseError {
  message: string;
  field?: string;
  details?: unknown;
}

/**
 * Validation error with details
 */
export interface ValidationError {
  message: string;
  field: string;
  value?: unknown;
}

/**
 * Request Parser class
 */
export class RequestParser {
  /**
   * Parse raw JSON into AnthropicRequest
   */
  parse(rawRequest: unknown): Result<AnthropicRequest, ParseError> {
    try {
      // Check if input is an object
      if (!rawRequest || typeof rawRequest !== 'object') {
        return {
          success: false,
          error: {
            message: 'Request must be an object',
            details: rawRequest,
          },
        };
      }

      const req = rawRequest as Record<string, unknown>;

      // Parse required fields
      const model = this.parseModel(req.model);
      if (!model.success) return model;

      const messages = this.parseMessages(req.messages);
      if (!messages.success) return messages;

      const maxTokens = this.parseMaxTokens(req.max_tokens);
      if (!maxTokens.success) return maxTokens;

      // Parse optional fields
      const system = req.system !== undefined ? this.parseSystem(req.system) : { success: true as const, value: undefined };
      if (!system.success) return system as Result<AnthropicRequest, ParseError>;

      const temperature = req.temperature !== undefined ? this.parseTemperature(req.temperature) : { success: true as const, value: undefined };
      if (!temperature.success) return temperature as Result<AnthropicRequest, ParseError>;

      const topP = req.top_p !== undefined ? this.parseTopP(req.top_p) : { success: true as const, value: undefined };
      if (!topP.success) return topP as Result<AnthropicRequest, ParseError>;

      const topK = req.top_k !== undefined ? this.parseTopK(req.top_k) : { success: true as const, value: undefined };
      if (!topK.success) return topK as Result<AnthropicRequest, ParseError>;

      const stopSequences = req.stop_sequences !== undefined ? this.parseStopSequences(req.stop_sequences) : { success: true as const, value: undefined };
      if (!stopSequences.success) return stopSequences as Result<AnthropicRequest, ParseError>;

      const stream = req.stream !== undefined ? this.parseStream(req.stream) : { success: true as const, value: undefined };
      if (!stream.success) return stream as Result<AnthropicRequest, ParseError>;

      const metadata = req.metadata !== undefined ? this.parseMetadata(req.metadata) : { success: true as const, value: undefined };
      if (!metadata.success) return metadata as Result<AnthropicRequest, ParseError>;

      const thinking = req.thinking !== undefined ? this.parseThinking(req.thinking) : { success: true as const, value: undefined };
      if (!thinking.success) return thinking as Result<AnthropicRequest, ParseError>;

      const tools = req.tools !== undefined ? this.parseTools(req.tools) : { success: true as const, value: undefined };
      if (!tools.success) return tools as Result<AnthropicRequest, ParseError>;

      const toolChoice = req.tool_choice !== undefined ? this.parseToolChoice(req.tool_choice) : { success: true as const, value: undefined };
      if (!toolChoice.success) return toolChoice as Result<AnthropicRequest, ParseError>;

      // Construct the request object
      const request: AnthropicRequest = {
        model: model.value,
        messages: messages.value,
        max_tokens: maxTokens.value,
        ...(system.value !== undefined && { system: system.value }),
        ...(temperature.value !== undefined && { temperature: temperature.value }),
        ...(topP.value !== undefined && { top_p: topP.value }),
        ...(topK.value !== undefined && { top_k: topK.value }),
        ...(stopSequences.value !== undefined && { stop_sequences: stopSequences.value }),
        ...(stream.value !== undefined && { stream: stream.value }),
        ...(metadata.value !== undefined && { metadata: metadata.value }),
        ...(thinking.value !== undefined && { thinking: thinking.value }),
        ...(tools.value !== undefined && { tools: tools.value }),
        ...(toolChoice.value !== undefined && { tool_choice: toolChoice.value }),
      };

      return { success: true, value: request };
    } catch (error) {
      return {
        success: false,
        error: {
          message: 'Unexpected error during parsing',
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Validate an AnthropicRequest
   */
  validate(request: AnthropicRequest): Result<void, ValidationError> {
    // Validate model
    if (!request.model || typeof request.model !== 'string' || request.model.trim() === '') {
      return {
        success: false,
        error: {
          message: 'Model must be a non-empty string',
          field: 'model',
          value: request.model,
        },
      };
    }

    // Validate messages array is not empty
    if (!request.messages || request.messages.length === 0) {
      return {
        success: false,
        error: {
          message: 'Messages array must not be empty',
          field: 'messages',
          value: request.messages,
        },
      };
    }

    // Validate message alternation (user/assistant with exceptions for tool results)
    const validationResult = this.validateMessageAlternation(request.messages);
    if (!validationResult.success) return validationResult;

    // Validate max_tokens is positive
    if (request.max_tokens <= 0) {
      return {
        success: false,
        error: {
          message: 'max_tokens must be a positive integer',
          field: 'max_tokens',
          value: request.max_tokens,
        },
      };
    }

    // Validate cache_control markers are on valid message boundaries
    const cacheValidation = this.validateCacheControlMarkers(request.messages);
    if (!cacheValidation.success) return cacheValidation;

    return { success: true, value: undefined };
  }

  // ============================================================================
  // Private parsing methods
  // ============================================================================

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

  private parseMessages(value: unknown): Result<Message[], ParseError> {
    if (!Array.isArray(value)) {
      return {
        success: false,
        error: {
          message: 'Messages must be an array',
          field: 'messages',
          details: value,
        },
      };
    }

    if (value.length === 0) {
      return {
        success: false,
        error: {
          message: 'Messages array must not be empty',
          field: 'messages',
        },
      };
    }

    const messages: Message[] = [];
    for (let i = 0; i < value.length; i++) {
      const msg = value[i];
      if (!msg || typeof msg !== 'object') {
        return {
          success: false,
          error: {
            message: `Message at index ${i} must be an object`,
            field: `messages[${i}]`,
            details: msg,
          },
        };
      }

      const msgObj = msg as Record<string, unknown>;

      // Parse role
      if (msgObj.role !== 'user' && msgObj.role !== 'assistant') {
        return {
          success: false,
          error: {
            message: `Message role must be 'user' or 'assistant'`,
            field: `messages[${i}].role`,
            details: msgObj.role,
          },
        };
      }

      // Parse content
      const content = this.parseMessageContent(msgObj.content);
      if (!content.success) {
        return {
          success: false,
          error: {
            message: content.error.message,
            field: `messages[${i}].content`,
            details: content.error.details,
          },
        };
      }

      // Parse cache_control (optional)
      const cacheControl = msgObj.cache_control !== undefined 
        ? this.parseCacheControl(msgObj.cache_control)
        : { success: true as const, value: undefined };
      
      if (!cacheControl.success) {
        return {
          success: false,
          error: {
            message: cacheControl.error.message,
            field: `messages[${i}].cache_control`,
            details: cacheControl.error.details,
          },
        };
      }

      messages.push({
        role: msgObj.role as 'user' | 'assistant',
        content: content.value,
        ...(cacheControl.value && { cache_control: cacheControl.value }),
      });
    }

    return { success: true, value: messages };
  }

  private parseMessageContent(value: unknown): Result<string | ContentBlock[], ParseError> {
    // Content can be a string or array of ContentBlocks
    if (typeof value === 'string') {
      return { success: true, value };
    }

    if (Array.isArray(value)) {
      const blocks: ContentBlock[] = [];
      for (let i = 0; i < value.length; i++) {
        const block = this.parseContentBlock(value[i]);
        if (!block.success) {
          return {
            success: false,
            error: {
              message: `Invalid content block at index ${i}: ${block.error.message}`,
              details: block.error.details,
            },
          };
        }
        blocks.push(block.value);
      }
      return { success: true, value: blocks };
    }

    return {
      success: false,
      error: {
        message: 'Content must be a string or array of content blocks',
        details: value,
      },
    };
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
      case 'image':
        return this.parseImageContentBlock(block);
      case 'tool_use':
        return this.parseToolUseContentBlock(block);
      case 'tool_result':
        return this.parseToolResultContentBlock(block);
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

    const cacheControl = block.cache_control !== undefined
      ? this.parseCacheControl(block.cache_control)
      : { success: true as const, value: undefined };

    if (!cacheControl.success) {
      return {
        success: false,
        error: {
          message: `Invalid cache_control: ${cacheControl.error.message}`,
          details: cacheControl.error.details,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'text',
        text: block.text,
        ...(cacheControl.value && { cache_control: cacheControl.value }),
      },
    };
  }

  private parseImageContentBlock(block: Record<string, unknown>): Result<ContentBlock, ParseError> {
    if (!block.source || typeof block.source !== 'object') {
      return {
        success: false,
        error: {
          message: 'Image content block must have a source field',
          details: block,
        },
      };
    }

    // For now, accept the source as-is (detailed validation can be added)
    return {
      success: true,
      value: {
        type: 'image',
        source: block.source as any,
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

  private parseToolResultContentBlock(block: Record<string, unknown>): Result<ContentBlock, ParseError> {
    if (typeof block.tool_use_id !== 'string') {
      return {
        success: false,
        error: {
          message: 'Tool result content block must have a tool_use_id field',
          details: block,
        },
      };
    }

    // Content can be string or ContentBlock[]
    const content = this.parseMessageContent(block.content);
    if (!content.success) return content as Result<ContentBlock, ParseError>;

    return {
      success: true,
      value: {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: content.value,
        ...(typeof block.is_error === 'boolean' && { is_error: block.is_error }),
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

  private parseCacheControl(value: unknown): Result<CacheControl | undefined, ParseError> {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: {
          message: 'cache_control must be an object',
          details: value,
        },
      };
    }

    const cc = value as Record<string, unknown>;
    if (cc.type !== 'ephemeral') {
      return {
        success: false,
        error: {
          message: 'cache_control type must be "ephemeral"',
          details: value,
        },
      };
    }

    return { success: true, value: { type: 'ephemeral' } };
  }

  private parseMaxTokens(value: unknown): Result<number, ParseError> {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return {
        success: false,
        error: {
          message: 'max_tokens must be a positive integer',
          field: 'max_tokens',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseSystem(value: unknown): Result<string | SystemBlock[] | undefined, ParseError> {
    if (typeof value === 'string') {
      return { success: true, value };
    }

    if (Array.isArray(value)) {
      // Parse as SystemBlock[]
      const blocks: SystemBlock[] = [];
      for (const block of value) {
        if (!block || typeof block !== 'object') {
          return {
            success: false,
            error: {
              message: 'System block must be an object',
              field: 'system',
              details: block,
            },
          };
        }

        const b = block as Record<string, unknown>;
        if (b.type !== 'text' || typeof b.text !== 'string') {
          return {
            success: false,
            error: {
              message: 'System block must have type "text" and a text field',
              field: 'system',
              details: block,
            },
          };
        }

        const cacheControl = b.cache_control !== undefined
          ? this.parseCacheControl(b.cache_control)
          : { success: true as const, value: undefined };

        if (!cacheControl.success) {
          return {
            success: false,
            error: {
              message: cacheControl.error.message,
              field: 'system.cache_control',
              details: cacheControl.error.details,
            },
          };
        }

        blocks.push({
          type: 'text',
          text: b.text,
          ...(cacheControl.value && { cache_control: cacheControl.value }),
        });
      }
      return { success: true, value: blocks };
    }

    return {
      success: false,
      error: {
        message: 'system must be a string or array of system blocks',
        field: 'system',
        details: value,
      },
    };
  }

  private parseTemperature(value: unknown): Result<number | undefined, ParseError> {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      return {
        success: false,
        error: {
          message: 'temperature must be a number between 0 and 1',
          field: 'temperature',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseTopP(value: unknown): Result<number | undefined, ParseError> {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      return {
        success: false,
        error: {
          message: 'top_p must be a number between 0 and 1',
          field: 'top_p',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseTopK(value: unknown): Result<number | undefined, ParseError> {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return {
        success: false,
        error: {
          message: 'top_k must be a non-negative integer',
          field: 'top_k',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseStopSequences(value: unknown): Result<string[] | undefined, ParseError> {
    if (!Array.isArray(value)) {
      return {
        success: false,
        error: {
          message: 'stop_sequences must be an array',
          field: 'stop_sequences',
          details: value,
        },
      };
    }

    for (const seq of value) {
      if (typeof seq !== 'string') {
        return {
          success: false,
          error: {
            message: 'stop_sequences must be an array of strings',
            field: 'stop_sequences',
            details: value,
          },
        };
      }
    }

    return { success: true, value };
  }

  private parseStream(value: unknown): Result<boolean | undefined, ParseError> {
    if (typeof value !== 'boolean') {
      return {
        success: false,
        error: {
          message: 'stream must be a boolean',
          field: 'stream',
          details: value,
        },
      };
    }
    return { success: true, value };
  }

  private parseMetadata(value: unknown): Result<RequestMetadata | undefined, ParseError> {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: {
          message: 'metadata must be an object',
          field: 'metadata',
          details: value,
        },
      };
    }
    return { success: true, value: value as RequestMetadata };
  }

  private parseThinking(value: unknown): Result<ThinkingConfig | undefined, ParseError> {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: {
          message: 'thinking must be an object',
          field: 'thinking',
          details: value,
        },
      };
    }

    const thinking = value as Record<string, unknown>;
    if (thinking.type !== 'enabled') {
      return {
        success: false,
        error: {
          message: 'thinking type must be "enabled"',
          field: 'thinking.type',
          details: value,
        },
      };
    }

    if (typeof thinking.budget_tokens !== 'number' || !Number.isInteger(thinking.budget_tokens) || thinking.budget_tokens < 0) {
      return {
        success: false,
        error: {
          message: 'thinking.budget_tokens must be a non-negative integer',
          field: 'thinking.budget_tokens',
          details: value,
        },
      };
    }

    return {
      success: true,
      value: {
        type: 'enabled',
        budget_tokens: thinking.budget_tokens,
      },
    };
  }

  private parseTools(value: unknown): Result<Tool[] | undefined, ParseError> {
    if (!Array.isArray(value)) {
      return {
        success: false,
        error: {
          message: 'tools must be an array',
          field: 'tools',
          details: value,
        },
      };
    }

    const tools: Tool[] = [];
    for (const tool of value) {
      if (!tool || typeof tool !== 'object') {
        return {
          success: false,
          error: {
            message: 'Each tool must be an object',
            field: 'tools',
            details: tool,
          },
        };
      }

      const t = tool as Record<string, unknown>;
      if (typeof t.name !== 'string' || typeof t.description !== 'string') {
        return {
          success: false,
          error: {
            message: 'Tool must have name and description fields',
            field: 'tools',
            details: tool,
          },
        };
      }

      if (!t.input_schema || typeof t.input_schema !== 'object') {
        return {
          success: false,
          error: {
            message: 'Tool must have an input_schema object',
            field: 'tools',
            details: tool,
          },
        };
      }

      tools.push({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as any,
      });
    }

    return { success: true, value: tools };
  }

  private parseToolChoice(value: unknown): Result<ToolChoice | undefined, ParseError> {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: {
          message: 'tool_choice must be an object',
          field: 'tool_choice',
          details: value,
        },
      };
    }

    const tc = value as Record<string, unknown>;
    if (tc.type === 'auto') {
      return { success: true, value: { type: 'auto' } };
    } else if (tc.type === 'any') {
      return { success: true, value: { type: 'any' } };
    } else if (tc.type === 'tool') {
      if (typeof tc.name !== 'string') {
        return {
          success: false,
          error: {
            message: 'tool_choice with type "tool" must have a name field',
            field: 'tool_choice.name',
            details: value,
          },
        };
      }
      return { success: true, value: { type: 'tool', name: tc.name } };
    }

    return {
      success: false,
      error: {
        message: 'tool_choice type must be "auto", "any", or "tool"',
        field: 'tool_choice.type',
        details: value,
      },
    };
  }

  // ============================================================================
  // Private validation methods
  // ============================================================================

  private validateMessageAlternation(messages: Message[]): Result<void, ValidationError> {
    // Messages should generally alternate between user and assistant
    // Exception: tool_result messages can follow assistant messages
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const curr = messages[i];

      // Check if current message has tool_result content
      const hasToolResult = isContentBlockArray(curr.content) && 
        curr.content.some(block => block.type === 'tool_result');

      // If not a tool result, check alternation
      if (!hasToolResult && prev.role === curr.role) {
        return {
          success: false,
          error: {
            message: `Messages must alternate between user and assistant (found consecutive ${curr.role} messages)`,
            field: `messages[${i}]`,
            value: curr.role,
          },
        };
      }
    }

    return { success: true, value: undefined };
  }

  private validateCacheControlMarkers(_messages: Message[]): Result<void, ValidationError> {
    // Cache control markers must be on valid message boundaries
    // For now, we accept any placement (detailed validation can be added)
    return { success: true, value: undefined };
  }
}
