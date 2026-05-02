/**
 * Anthropic API Data Models
 * 
 * Type definitions for Anthropic Claude API requests and responses.
 * Preserves all native Anthropic features including:
 * - Extended thinking with budget tokens
 * - Prompt caching control markers
 * - Multi-content blocks (text, image, tool_use, tool_result, thinking)
 * - Tool definitions and tool choice
 */

// ============================================================================
// Request Types
// ============================================================================

/**
 * Main Anthropic API request structure
 */
export interface AnthropicRequest {
  model: string;
  messages: Message[];
  system?: string | SystemBlock[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: RequestMetadata;
  
  // Anthropic-specific features
  thinking?: ThinkingConfig;
  tools?: Tool[];
  tool_choice?: ToolChoice;
}

/**
 * Message in conversation history
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  cache_control?: CacheControl;
}

/**
 * System prompt block (for structured system prompts)
 */
export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

/**
 * Content block - discriminated union for different content types
 */
export type ContentBlock = 
  | TextContentBlock
  | ImageContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock
  | ThinkingContentBlock;

/**
 * Text content block
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

/**
 * Image content block
 */
export interface ImageContentBlock {
  type: 'image';
  source: ImageSource;
  cache_control?: CacheControl;
}

/**
 * Image source (base64 or URL)
 */
export interface ImageSource {
  type: 'base64' | 'url';
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data?: string; // base64 encoded image data
  url?: string; // image URL
}

/**
 * Tool use content block (Claude requesting to use a tool)
 */
export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block (result from tool execution)
 */
export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

/**
 * Type alias for tool use (for convenience in ToolOrchestrator)
 */
export type ToolUse = ToolUseContentBlock;

/**
 * Type alias for tool result (for convenience in ToolOrchestrator)
 */
export type ToolResult = ToolResultContentBlock;

/**
 * Thinking content block (extended thinking output)
 */
export interface ThinkingContentBlock {
  type: 'thinking';
  thinking: string;
}

/**
 * Cache control marker for prompt caching
 */
export interface CacheControl {
  type: 'ephemeral';
}

/**
 * Extended thinking configuration
 */
export interface ThinkingConfig {
  type: 'enabled';
  budget_tokens: number;
}

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

/**
 * Tool input schema (JSON Schema)
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * Tool choice configuration
 */
export type ToolChoice = 
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

/**
 * Request metadata
 */
export interface RequestMetadata {
  user_id?: string;
  conversation_id?: string;
  [key: string]: unknown;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Main Anthropic API response structure
 */
export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: StopReason;
  stop_sequence?: string;
  usage: Usage;
}

/**
 * Stop reason for response completion
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

/**
 * Token usage information
 */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  thinking_tokens?: number;
}

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Server-sent event from streaming response
 */
export interface ServerSentEvent {
  event: string;
  data: string;
}

/**
 * Stream chunk - parsed streaming event
 */
export type StreamChunk =
  | MessageStartChunk
  | ContentBlockStartChunk
  | ContentBlockDeltaChunk
  | ContentBlockStopChunk
  | MessageDeltaChunk
  | MessageStopChunk
  | PingChunk
  | ErrorChunk;

/**
 * Message start chunk
 */
export interface MessageStartChunk {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: [];
    model: string;
    stop_reason: null;
    stop_sequence: null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

/**
 * Content block start chunk
 */
export interface ContentBlockStartChunk {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

/**
 * Content block delta chunk
 */
export interface ContentBlockDeltaChunk {
  type: 'content_block_delta';
  index: number;
  delta: ContentDelta;
}

/**
 * Content delta (incremental content update)
 */
export type ContentDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string };

/**
 * Content block stop chunk
 */
export interface ContentBlockStopChunk {
  type: 'content_block_stop';
  index: number;
}

/**
 * Message delta chunk
 */
export interface MessageDeltaChunk {
  type: 'message_delta';
  delta: {
    stop_reason: StopReason;
    stop_sequence?: string;
  };
  usage: {
    output_tokens: number;
  };
}

/**
 * Message stop chunk
 */
export interface MessageStopChunk {
  type: 'message_stop';
}

/**
 * Ping chunk (keepalive)
 */
export interface PingChunk {
  type: 'ping';
}

/**
 * Error chunk
 */
export interface ErrorChunk {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for TextContentBlock
 */
export function isTextContentBlock(block: ContentBlock): block is TextContentBlock {
  return block.type === 'text';
}

/**
 * Type guard for ImageContentBlock
 */
export function isImageContentBlock(block: ContentBlock): block is ImageContentBlock {
  return block.type === 'image';
}

/**
 * Type guard for ToolUseContentBlock
 */
export function isToolUseContentBlock(block: ContentBlock): block is ToolUseContentBlock {
  return block.type === 'tool_use';
}

/**
 * Type guard for ToolResultContentBlock
 */
export function isToolResultContentBlock(block: ContentBlock): block is ToolResultContentBlock {
  return block.type === 'tool_result';
}

/**
 * Type guard for ThinkingContentBlock
 */
export function isThinkingContentBlock(block: ContentBlock): block is ThinkingContentBlock {
  return block.type === 'thinking';
}

/**
 * Type guard to check if content is a string
 */
export function isStringContent(content: string | ContentBlock[]): content is string {
  return typeof content === 'string';
}

/**
 * Type guard to check if content is ContentBlock array
 */
export function isContentBlockArray(content: string | ContentBlock[]): content is ContentBlock[] {
  return Array.isArray(content);
}

/**
 * Type guard for streaming chunks
 */
export function isMessageStartChunk(chunk: StreamChunk): chunk is MessageStartChunk {
  return chunk.type === 'message_start';
}

export function isContentBlockDeltaChunk(chunk: StreamChunk): chunk is ContentBlockDeltaChunk {
  return chunk.type === 'content_block_delta';
}

export function isMessageStopChunk(chunk: StreamChunk): chunk is MessageStopChunk {
  return chunk.type === 'message_stop';
}

export function isErrorChunk(chunk: StreamChunk): chunk is ErrorChunk {
  return chunk.type === 'error';
}
