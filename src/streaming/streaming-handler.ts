/**
 * StreamingHandler
 * 
 * Handles server-sent event (SSE) streaming from Anthropic API.
 * Supports different streaming modes:
 * - standard: Basic streaming without quality monitoring
 * - quality_monitored: Evaluate quality during streaming
 * - parallel: Stream multiple responses in parallel
 */

import type {
  ServerSentEvent,
  StreamChunk,
  ContentBlock,
  TextContentBlock,
  StopReason,
  Usage,
} from '../types/anthropic.types';
import { AnthropicClientWrapper } from '../infrastructure/anthropic';

/**
 * Streaming mode configuration
 */
export type StreamingMode = 'standard' | 'quality_monitored' | 'parallel';

/**
 * Streaming options
 */
export interface StreamingOptions {
  mode: StreamingMode;
  qualityThreshold?: number; // For quality_monitored mode (0-1)
  evaluationInterval?: number; // How often to evaluate quality (in chunks)
}

/**
 * Accumulated streaming state
 */
export interface StreamingState {
  messageId: string;
  model: string;
  role: 'assistant';
  contentBlocks: ContentBlock[];
  stopReason: StopReason | null;
  stopSequence: string | null;
  usage: Usage;
  qualityScore?: number;
}

/**
 * StreamingHandler class
 */
export class StreamingHandler {
  private options: StreamingOptions;
  private anthropicClient?: AnthropicClientWrapper;

  constructor(options: StreamingOptions = { mode: 'standard' }, anthropicClient?: AnthropicClientWrapper) {
    this.options = options;
    this.anthropicClient = anthropicClient;
  }

  /**
   * Handle streaming response from Anthropic API
   * 
   * @param stream - AsyncIterable of ServerSentEvent objects
   * @yields StreamChunk objects as events arrive
   */
  async *handleStream(
    stream: AsyncIterable<ServerSentEvent>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const state: StreamingState = {
      messageId: '',
      model: '',
      role: 'assistant',
      contentBlocks: [],
      stopReason: null,
      stopSequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };

    let chunkCount = 0;

    for await (const event of stream) {
      // Parse the SSE event into a StreamChunk
      const chunk = this.parseEvent(event);

      if (!chunk) {
        continue;
      }

      // Update state based on chunk type
      this.updateState(state, chunk);

      // Yield the chunk to the caller
      yield chunk;

      chunkCount++;

      // Quality monitoring (if enabled)
      if (
        this.options.mode === 'quality_monitored' &&
        this.options.evaluationInterval &&
        chunkCount % this.options.evaluationInterval === 0
      ) {
        const qualityScore = await this.evaluateQuality(state);
        state.qualityScore = qualityScore;

        // Check if quality threshold is met
        if (
          this.options.qualityThreshold &&
          qualityScore >= this.options.qualityThreshold
        ) {
          // Early stopping - quality threshold met
          break;
        }

        // Check if quality is too low
        if (qualityScore < 0.3) {
          // Interrupt stream - quality too low
          throw new Error(
            `Stream interrupted: Quality score ${qualityScore} below minimum threshold`
          );
        }
      }
    }
  }

  /**
   * Parse SSE event into StreamChunk
   * 
   * @param event - Server-sent event
   * @returns Parsed StreamChunk or null if invalid
   */
  private parseEvent(event: ServerSentEvent): StreamChunk | null {
    try {
      // SSE format: event: <type>\ndata: <json>
      const data = JSON.parse(event.data);

      // Add the event type to the data
      return {
        type: event.event,
        ...data,
      } as StreamChunk;
    } catch (error) {
      console.error('Failed to parse SSE event:', error);
      return null;
    }
  }

  /**
   * Update streaming state based on chunk
   * 
   * @param state - Current streaming state
   * @param chunk - New chunk to process
   */
  private updateState(state: StreamingState, chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'message_start':
        state.messageId = chunk.message.id;
        state.model = chunk.message.model;
        state.usage.input_tokens = chunk.message.usage.input_tokens;
        state.usage.output_tokens = chunk.message.usage.output_tokens;
        break;

      case 'content_block_start':
        // Initialize new content block
        state.contentBlocks[chunk.index] = chunk.content_block;
        break;

      case 'content_block_delta':
        // Accumulate delta into content block
        if (chunk.delta.type === 'text_delta') {
          const block = state.contentBlocks[chunk.index] as TextContentBlock;
          if (block && block.type === 'text') {
            block.text += chunk.delta.text;
          } else {
            // Initialize text block if not exists
            state.contentBlocks[chunk.index] = {
              type: 'text',
              text: chunk.delta.text,
            };
          }
        } else if (chunk.delta.type === 'input_json_delta') {
          // Handle tool input JSON delta
          // This would accumulate partial JSON for tool_use blocks
          // For now, we'll skip this as it's more complex
        }
        break;

      case 'content_block_stop':
        // Content block complete (no action needed)
        break;

      case 'message_delta':
        state.stopReason = chunk.delta.stop_reason;
        state.stopSequence = chunk.delta.stop_sequence || null;
        state.usage.output_tokens += chunk.usage.output_tokens;
        break;

      case 'message_stop':
        // Stream complete (no action needed)
        break;

      case 'ping':
        // Keepalive (no action needed)
        break;

      case 'error':
        throw new Error(`Stream error: ${chunk.error.message}`);
    }
  }

  /**
   * Evaluate quality of accumulated content using Claude Sonnet
   * 
   * @param state - Current streaming state
   * @returns Quality score (0-1)
   */
  private async evaluateQuality(state: StreamingState): Promise<number> {
    // Extract text content from all content blocks
    const textContent = state.contentBlocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as TextContentBlock).text)
      .join('\n');

    if (!textContent || textContent.length < 50) {
      // Not enough content to evaluate
      return 0.5;
    }

    // Use Claude Sonnet for quality evaluation if available
    if (this.anthropicClient) {
      try {
        return await this.evaluateQualityWithClaude(textContent);
      } catch (error) {
        console.error('Failed to evaluate quality with Claude:', error);
        // Fall back to simple heuristic
        return this.simpleQualityHeuristic(textContent);
      }
    }

    // Fall back to simple heuristic if no client available
    return this.simpleQualityHeuristic(textContent);
  }

  /**
   * Evaluate quality using Claude Sonnet
   * 
   * @param text - Text content to evaluate
   * @returns Quality score (0-1)
   */
  private async evaluateQualityWithClaude(text: string): Promise<number> {
    const prompt = `Evaluate the quality of the following text on a scale of 0 to 1, where:
- 0.0-0.3: Poor quality (incomplete, incoherent, or nonsensical)
- 0.3-0.5: Below average (some issues with clarity or completeness)
- 0.5-0.7: Average quality (acceptable but could be improved)
- 0.7-0.9: Good quality (clear, coherent, and well-structured)
- 0.9-1.0: Excellent quality (exceptional clarity, completeness, and structure)

Consider:
1. Coherence and logical flow
2. Completeness of thoughts
3. Clarity of expression
4. Relevance to the topic
5. Grammar and structure

Text to evaluate:
"""
${text}
"""

Respond with ONLY a number between 0 and 1 (e.g., 0.75). Do not include any explanation.`;

    const response = await this.anthropicClient!.createMessage({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract the score from the response
    const scoreText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as TextContentBlock).text)
      .join('')
      .trim();

    const score = parseFloat(scoreText);

    // Validate score is between 0 and 1
    if (isNaN(score) || score < 0 || score > 1) {
      console.warn(`Invalid quality score from Claude: ${scoreText}`);
      return 0.5; // Default to average
    }

    return score;
  }

  /**
   * Simple quality heuristic (placeholder for Claude Sonnet evaluation)
   * 
   * @param text - Text content to evaluate
   * @returns Quality score (0-1)
   */
  private simpleQualityHeuristic(text: string): Promise<number> {
    // Simple heuristic based on:
    // - Length (longer is generally better up to a point)
    // - Sentence structure (presence of punctuation)
    // - Paragraph structure (presence of newlines)

    let score = 0.5; // Base score

    // Length factor (optimal around 200-500 chars)
    if (text.length > 100) score += 0.1;
    if (text.length > 200) score += 0.1;
    if (text.length > 500) score += 0.1;

    // Sentence structure (has punctuation)
    if (/[.!?]/.test(text)) score += 0.1;

    // Paragraph structure (has newlines)
    if (/\n/.test(text)) score += 0.1;

    // Cap at 1.0
    score = Math.min(score, 1.0);

    return Promise.resolve(score);
  }

  /**
   * Get final accumulated state
   * 
   * @param stream - AsyncIterable of ServerSentEvent objects
   * @returns Final streaming state
   */
  async getFinalState(
    stream: AsyncIterable<ServerSentEvent>
  ): Promise<StreamingState> {
    const state: StreamingState = {
      messageId: '',
      model: '',
      role: 'assistant',
      contentBlocks: [],
      stopReason: null,
      stopSequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };

    for await (const event of stream) {
      const chunk = this.parseEvent(event);
      if (chunk) {
        this.updateState(state, chunk);
      }
    }

    return state;
  }
}
