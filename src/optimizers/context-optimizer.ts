import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicRequest, Message } from '../types/anthropic.types';

/**
 * ContextOptimizer compresses large conversation histories to reduce token usage
 * while maintaining response quality.
 * 
 * Strategy:
 * - Only optimize conversations with >8000 tokens
 * - Preserve most recent 3 messages without modification
 * - Compress older messages using Claude Haiku summarization
 * - Group old messages into chunks of 4 for summarization
 */
export class ContextOptimizer {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Optimize conversation context by compressing old messages
   * 
   * @param request - The Anthropic request to optimize
   * @returns Optimized request with compressed history
   */
  async optimize(request: AnthropicRequest): Promise<AnthropicRequest> {
    const messages = request.messages;
    const totalTokens = this.estimateTokens(messages);

    // Only compress if conversation is large enough
    if (totalTokens < 8000) {
      return request;
    }

    // Keep recent messages intact (most recent 3)
    const recentCount = 3;
    const recentMessages = messages.slice(-recentCount);
    const oldMessages = messages.slice(0, -recentCount);

    // If there are no old messages to compress, return as-is
    if (oldMessages.length === 0) {
      return request;
    }

    // Compress old messages using Claude Haiku
    const compressedMessages = await this.compressMessages(oldMessages);

    return {
      ...request,
      messages: [...compressedMessages, ...recentMessages],
    };
  }

  /**
   * Compress messages by summarizing them in chunks using Claude Haiku
   * 
   * @param messages - Messages to compress
   * @returns Compressed messages
   */
  private async compressMessages(messages: Message[]): Promise<Message[]> {
    // Group messages into chunks of 4
    const chunks = this.chunkMessages(messages, 4);
    const compressed: Message[] = [];

    for (const chunk of chunks) {
      try {
        // Use Claude Haiku to summarize the chunk
        const summary = await this.anthropic.messages.create({
          model: 'claude-haiku-4-20250514',
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: `Summarize this conversation concisely, preserving key information:\n\n${this.formatMessages(chunk)}`,
            },
          ],
        });

        // Extract text from response
        const summaryText = summary.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as any).text)
          .join('\n');

        compressed.push({
          role: 'assistant',
          content: `[Summarized]: ${summaryText}`,
        });
      } catch (error) {
        console.error('Error compressing messages:', error);
        // If compression fails, include original messages
        compressed.push(...chunk);
      }
    }

    return compressed;
  }

  /**
   * Group messages into chunks of specified size
   * 
   * @param messages - Messages to chunk
   * @param chunkSize - Size of each chunk
   * @returns Array of message chunks
   */
  private chunkMessages(messages: Message[], chunkSize: number): Message[][] {
    const chunks: Message[][] = [];

    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }

    return chunks;
  }

  /**
   * Format messages for summarization prompt
   * 
   * @param messages - Messages to format
   * @returns Formatted string
   */
  private formatMessages(messages: Message[]): string {
    return messages
      .map((msg) => {
        const content = typeof msg.content === 'string' 
          ? msg.content 
          : msg.content.map((block) => {
              if (block.type === 'text') {
                return block.text;
              }
              return `[${block.type}]`;
            }).join(' ');
        
        return `${msg.role.toUpperCase()}: ${content}`;
      })
      .join('\n\n');
  }

  /**
   * Estimate token count for messages (rough approximation)
   * 
   * @param messages - Messages to estimate
   * @returns Estimated token count
   */
  private estimateTokens(messages: Message[]): number {
    let total = 0;

    for (const message of messages) {
      if (typeof message.content === 'string') {
        // Rough estimate: 1 token per 4 characters
        total += Math.ceil(message.content.length / 4);
      } else {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            total += Math.ceil(block.text.length / 4);
          } else if (block.type === 'image') {
            // Images are roughly 1000 tokens
            total += 1000;
          } else if (block.type === 'tool_use' || block.type === 'tool_result') {
            // Tool blocks are roughly 100 tokens
            total += 100;
          }
        }
      }
    }

    return total;
  }

  /**
   * Calculate compression ratio
   * 
   * @param originalMessages - Original messages
   * @param compressedMessages - Compressed messages
   * @returns Compression ratio (0-1, where 0.5 means 50% reduction)
   */
  calculateCompressionRatio(
    originalMessages: Message[],
    compressedMessages: Message[]
  ): number {
    const originalTokens = this.estimateTokens(originalMessages);
    const compressedTokens = this.estimateTokens(compressedMessages);

    if (originalTokens === 0) {
      return 1;
    }

    return compressedTokens / originalTokens;
  }
}
