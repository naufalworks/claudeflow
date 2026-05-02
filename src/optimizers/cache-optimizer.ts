/**
 * Cache Optimizer
 * 
 * Inserts optimal cache_control markers in requests to maximize
 * Anthropic prompt caching effectiveness.
 */

import { AnthropicRequest, Message, ContentBlock } from '../types';

/**
 * Cache analysis result
 */
export interface CacheAnalysis {
  totalTokens: number;
  recommendedCachePoints: number[];
  estimatedCacheHitRate: number;
}

/**
 * Cache Optimizer class
 */
export class CacheOptimizer {
  /**
   * Optimize request by inserting cache_control markers
   * 
   * Only optimizes conversations with >1024 tokens.
   * Inserts markers at strategic points:
   * - After system prompts
   * - After large context blocks (>2000 tokens)
   * - At conversation boundaries (every 5 messages)
   */
  optimize(request: AnthropicRequest): AnthropicRequest {
    const messages = request.messages;
    const totalTokens = this.estimateTokens(messages);

    // Only optimize if conversation is large enough
    if (totalTokens < 1024) {
      return request;
    }

    // Find optimal cache points
    const cachePoints = this.findOptimalCachePoints(messages);

    // Insert cache_control markers
    const optimizedMessages = messages.map((msg, idx) => {
      if (cachePoints.includes(idx)) {
        return {
          ...msg,
          cache_control: { type: 'ephemeral' as const },
        };
      }
      return msg;
    });

    return {
      ...request,
      messages: optimizedMessages,
    };
  }

  /**
   * Analyze conversation and recommend cache points
   */
  analyzeConversation(messages: Message[]): CacheAnalysis {
    const totalTokens = this.estimateTokens(messages);
    const recommendedCachePoints = this.findOptimalCachePoints(messages);

    // Estimate cache hit rate based on conversation structure
    // More cache points = higher hit rate, but diminishing returns
    const estimatedCacheHitRate = Math.min(
      0.9,
      0.3 + recommendedCachePoints.length * 0.15
    );

    return {
      totalTokens,
      recommendedCachePoints,
      estimatedCacheHitRate,
    };
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Find optimal cache points in conversation
   * 
   * Strategy:
   * 1. Cache after system prompts
   * 2. Cache after large context blocks (>2000 tokens)
   * 3. Cache at conversation boundaries (every 5 messages)
   */
  private findOptimalCachePoints(messages: Message[]): number[] {
    const points: number[] = [];

    // Strategy 1: Cache after system prompts
    // System prompts are typically at the beginning and rarely change
    if (messages.length > 0 && this.isSystemLike(messages[0])) {
      points.push(0);
    }

    // Strategy 2: Cache after large context blocks
    // Large blocks are expensive to reprocess
    for (let i = 0; i < messages.length; i++) {
      const tokens = this.estimateMessageTokens(messages[i]);
      if (tokens > 2000) {
        points.push(i);
      }
    }

    // Strategy 3: Cache at conversation boundaries (every 5 messages)
    // This creates natural checkpoints in the conversation
    for (let i = 4; i < messages.length; i += 5) {
      if (!points.includes(i)) {
        points.push(i);
      }
    }

    // Sort and deduplicate
    return [...new Set(points)].sort((a, b) => a - b);
  }

  /**
   * Check if message looks like a system prompt
   * 
   * Heuristics:
   * - First message in conversation
   * - User role
   * - Contains instruction keywords
   */
  private isSystemLike(message: Message): boolean {
    if (message.role !== 'user') {
      return false;
    }

    const content = this.extractTextContent(message);
    const lowerContent = content.toLowerCase();

    // Check for system prompt keywords
    const systemKeywords = [
      'you are',
      'your role',
      'your task',
      'instructions:',
      'guidelines:',
      'rules:',
      'context:',
      'background:',
    ];

    return systemKeywords.some((keyword) => lowerContent.includes(keyword));
  }

  /**
   * Extract text content from message
   */
  private extractTextContent(message: Message): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    const textBlocks = message.content.filter(
      (block): block is ContentBlock & { type: 'text' } => block.type === 'text'
    );

    return textBlocks.map((block) => block.text).join('\n');
  }

  /**
   * Estimate tokens for entire conversation
   */
  private estimateTokens(messages: Message[]): number {
    return messages.reduce(
      (total, msg) => total + this.estimateMessageTokens(msg),
      0
    );
  }

  /**
   * Estimate tokens for a single message
   * 
   * Simple heuristic: ~4 characters per token
   * This is approximate but sufficient for optimization decisions
   */
  private estimateMessageTokens(message: Message): number {
    const content = this.extractTextContent(message);
    return Math.ceil(content.length / 4);
  }
}
