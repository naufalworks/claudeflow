/**
 * Semantic Deduplication Engine
 * 
 * Detects semantically similar prompts and returns cached responses.
 * Uses Voyage AI for embeddings and Qdrant for vector search.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { Redis } from 'ioredis';
import axios from 'axios';
import { AnthropicRequest, AnthropicResponse } from '../types/index.js';
import { createHash } from 'crypto';

/**
 * Cache result from semantic deduplication check
 */
export interface CacheResult {
  hit: boolean;
  response?: AnthropicResponse;
  similarity?: number;
  cacheKey?: string;
}

/**
 * Semantic Deduplication Engine class
 */
export class SemanticDeduplicationEngine {
  private qdrant: QdrantClient;
  private redis: Redis;
  private voyageApiKey: string;
  private collectionName: string;

  constructor(
    qdrantUrl: string,
    redisUrl: string,
    voyageApiKey: string,
    collectionName: string = 'claudeflow_prompts'
  ) {
    this.qdrant = new QdrantClient({ url: qdrantUrl });
    this.redis = new Redis(redisUrl);
    this.voyageApiKey = voyageApiKey;
    this.collectionName = collectionName;
  }

  /**
   * Check cache for semantically similar prompts
   * 
   * Generates embedding for the request, searches Qdrant for similar prompts,
   * and retrieves cached response from Redis if found.
   */
  async checkCache(request: AnthropicRequest): Promise<CacheResult> {
    try {
      // 1. Extract prompt text from request
      const promptText = this.extractPromptText(request);

      // 2. Generate embedding using Voyage AI
      const embedding = await this.generateEmbedding(promptText);

      // 3. Search Qdrant for similar prompts (cosine similarity > 0.95)
      const searchResults = await this.qdrant.search(this.collectionName, {
        vector: embedding,
        limit: 1,
        score_threshold: 0.95,
      });

      if (searchResults.length === 0) {
        return { hit: false };
      }

      // 4. Retrieve cached response from Redis
      const cacheKey = String(searchResults[0].id);
      const cachedResponse = await this.redis.get(`response:${cacheKey}`);

      if (!cachedResponse) {
        return { hit: false };
      }

      // 5. Parse and return cached response
      const response = JSON.parse(cachedResponse) as AnthropicResponse;

      return {
        hit: true,
        response,
        similarity: searchResults[0].score,
        cacheKey,
      };
    } catch (error) {
      // Log error but don't fail the request
      console.error('Error checking semantic cache:', error);
      return { hit: false };
    }
  }

  /**
   * Store response in cache
   * 
   * Generates embedding for the request, stores it in Qdrant,
   * and stores the response in Redis with 24-hour TTL.
   */
  async storeResponse(
    request: AnthropicRequest,
    response: AnthropicResponse
  ): Promise<void> {
    try {
      // 1. Extract prompt text from request
      const promptText = this.extractPromptText(request);

      // 2. Generate embedding using Voyage AI
      const embedding = await this.generateEmbedding(promptText);

      // 3. Generate unique cache key
      const cacheKey = this.generateCacheKey(request);

      // 4. Store embedding in Qdrant with metadata
      await this.qdrant.upsert(this.collectionName, {
        points: [
          {
            id: cacheKey,
            vector: embedding,
            payload: {
              timestamp: Date.now(),
              model: request.model,
              conversationId: request.metadata?.conversation_id,
              messageCount: request.messages.length,
            },
          },
        ],
      });

      // 5. Store response in Redis with 24-hour TTL (86400 seconds)
      await this.redis.setex(
        `response:${cacheKey}`,
        86400,
        JSON.stringify(response)
      );
    } catch (error) {
      // Log error but don't fail the request
      console.error('Error storing in semantic cache:', error);
    }
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Extract prompt text from request for embedding generation
   * 
   * Combines all user messages and system prompt into a single text.
   */
  private extractPromptText(request: AnthropicRequest): string {
    const parts: string[] = [];

    // Add system prompt if present
    if (request.system) {
      if (typeof request.system === 'string') {
        parts.push(request.system);
      } else {
        for (const block of request.system) {
          if (block.type === 'text') {
            parts.push(block.text);
          }
        }
      }
    }

    // Add all messages
    for (const message of request.messages) {
      if (typeof message.content === 'string') {
        parts.push(`${message.role}: ${message.content}`);
      } else {
        for (const block of message.content) {
          if (block.type === 'text') {
            parts.push(`${message.role}: ${block.text}`);
          } else if (block.type === 'thinking') {
            parts.push(`${message.role} (thinking): ${block.thinking}`);
          } else if (block.type === 'tool_result') {
            if (typeof block.content === 'string') {
              parts.push(`${message.role} (tool result): ${block.content}`);
            }
          }
        }
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Generate embedding using Voyage AI
   * 
   * Calls Voyage AI API to generate 768-dimensional embedding.
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        'https://api.voyageai.com/v1/embeddings',
        {
          input: text,
          model: 'voyage-2',
        },
        {
          headers: {
            'Authorization': `Bearer ${this.voyageApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data?.data?.[0]?.embedding) {
        return response.data.data[0].embedding;
      }

      throw new Error('Invalid response from Voyage AI');
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Generate unique cache key for request
   * 
   * Uses SHA-256 hash of prompt text and model.
   */
  private generateCacheKey(request: AnthropicRequest): string {
    const promptText = this.extractPromptText(request);
    const data = `${request.model}:${promptText}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
