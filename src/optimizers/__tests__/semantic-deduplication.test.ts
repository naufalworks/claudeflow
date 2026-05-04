/**
 * Semantic Deduplication Integration Tests
 * 
 * Tests cache miss, cache hit, and near-miss scenarios with mocked
 * Qdrant, Redis, and Voyage AI services.
 */

import { SemanticDeduplicationEngine } from '../semantic-deduplication';
import { AnthropicRequest, AnthropicResponse } from '../../types/index.js';
import axios from 'axios';

// Create mock functions
const mockQdrantSearch = jest.fn();
const mockQdrantUpsert = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSetex = jest.fn();
const mockRedisQuit = jest.fn();

// Mock dependencies at module level
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    search: mockQdrantSearch,
    upsert: mockQdrantUpsert,
  })),
}));

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
    quit: mockRedisQuit,
  })),
}));

jest.mock('axios');

describe('SemanticDeduplicationEngine', () => {
  let engine: SemanticDeduplicationEngine;
  const mockAxiosPost = axios.post as jest.MockedFunction<typeof axios.post>;

  const mockEmbedding = new Array(768).fill(0).map((_, i) => i / 768);

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create engine instance
    engine = new SemanticDeduplicationEngine(
      'http://localhost:6333',
      'redis://localhost:6379',
      'test-voyage-api-key'
    );
  });

  afterEach(async () => {
    await engine.close();
  });

  // ============================================================================
  // Cache Miss Tests
  // ============================================================================

  describe('Cache Miss Scenarios', () => {
    it('should return cache miss when no similar prompts found', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'What is the capital of France?',
          },
        ],
        max_tokens: 100,
      };

      // Mock Voyage AI embedding generation
      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      // Mock Qdrant search returning no results
      mockQdrantSearch.mockResolvedValue([]);

      const result = await engine.checkCache(request);

      expect(result.hit).toBe(false);
      expect(result.response).toBeUndefined();
      expect(result.similarity).toBeUndefined();
      expect(result.cacheKey).toBeUndefined();

      // Verify Voyage AI was called
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://api.voyageai.com/v1/embeddings',
        expect.objectContaining({
          input: expect.any(String),
          model: 'voyage-2',
        }),
        expect.any(Object)
      );

      // Verify Qdrant search was called
      expect(mockQdrantSearch).toHaveBeenCalledWith(
        'claudeflow_prompts',
        expect.objectContaining({
          vector: mockEmbedding,
          limit: 1,
          score_threshold: 0.95,
        })
      );
    });

    it('should return cache miss when Redis has no cached response', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'What is 2+2?',
          },
        ],
        max_tokens: 100,
      };

      // Mock Voyage AI
      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      // Mock Qdrant search returning a result
      mockQdrantSearch.mockResolvedValue([
        {
          id: 'cache-key-123',
          score: 0.98,
        },
      ]);

      // Mock Redis returning null (no cached response)
      mockRedisGet.mockResolvedValue(null);

      const result = await engine.checkCache(request);

      expect(result.hit).toBe(false);
      expect(mockRedisGet).toHaveBeenCalledWith('response:cache-key-123');
    });
  });

  // ============================================================================
  // Cache Hit Tests
  // ============================================================================

  describe('Cache Hit Scenarios', () => {
    it('should return cached response on exact match', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'What is the capital of France?',
          },
        ],
        max_tokens: 100,
      };

      const cachedResponse: AnthropicResponse = {
        id: 'msg_cached_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'The capital of France is Paris.',
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 8,
        },
      };

      // Mock Voyage AI
      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      // Mock Qdrant search returning high similarity match
      mockQdrantSearch.mockResolvedValue([
        {
          id: 'cache-key-456',
          score: 0.99,
        },
      ]);

      // Mock Redis returning cached response
      mockRedisGet.mockResolvedValue(JSON.stringify(cachedResponse));

      const result = await engine.checkCache(request);

      expect(result.hit).toBe(true);
      expect(result.response).toEqual(cachedResponse);
      expect(result.similarity).toBe(0.99);
      expect(result.cacheKey).toBe('cache-key-456');
    });

    it('should handle cached response with all optional fields', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Complex question',
          },
        ],
        max_tokens: 1000,
      };

      const cachedResponse: AnthropicResponse = {
        id: 'msg_cached_789',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me think about this...',
          },
          {
            type: 'text',
            text: 'Here is my answer.',
          },
        ],
        model: 'claude-opus-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: 'STOP',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          thinking_tokens: 15,
        },
      };

      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      mockQdrantSearch.mockResolvedValue([
        {
          id: 'cache-key-789',
          score: 0.97,
        },
      ]);

      mockRedisGet.mockResolvedValue(JSON.stringify(cachedResponse));

      const result = await engine.checkCache(request);

      expect(result.hit).toBe(true);
      expect(result.response).toEqual(cachedResponse);
    });
  });

  // ============================================================================
  // Near-Miss Tests
  // ============================================================================

  describe('Near-Miss Scenarios', () => {
    it('should return cache miss when similarity is below threshold (0.85-0.95)', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'What is the capital of Germany?',
          },
        ],
        max_tokens: 100,
      };

      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      // Mock Qdrant search returning no results (score_threshold filters out low similarity)
      // In reality, Qdrant won't return results below the threshold (0.95)
      mockQdrantSearch.mockResolvedValue([]);

      const result = await engine.checkCache(request);

      // Should be treated as cache miss due to low similarity
      expect(result.hit).toBe(false);
    });
  });

  // ============================================================================
  // Store Response Tests
  // ============================================================================

  describe('Store Response', () => {
    it('should store embedding in Qdrant and response in Redis', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'What is machine learning?',
          },
        ],
        max_tokens: 500,
        metadata: {
          conversation_id: 'conv-123',
        },
      };

      const response: AnthropicResponse = {
        id: 'msg_new_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Machine learning is a subset of artificial intelligence...',
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 20,
          output_tokens: 50,
        },
      };

      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      mockQdrantUpsert.mockResolvedValue({});
      mockRedisSetex.mockResolvedValue('OK');

      await engine.storeResponse(request, response);

      // Verify Voyage AI was called
      expect(mockAxiosPost).toHaveBeenCalled();

      // Verify Qdrant upsert was called
      expect(mockQdrantUpsert).toHaveBeenCalledWith(
        'claudeflow_prompts',
        expect.objectContaining({
          points: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              vector: mockEmbedding,
              payload: expect.objectContaining({
                timestamp: expect.any(Number),
                model: 'claude-sonnet-4-20250514',
                conversationId: 'conv-123',
                messageCount: 1,
              }),
            }),
          ]),
        })
      );

      // Verify Redis setex was called with 24-hour TTL
      expect(mockRedisSetex).toHaveBeenCalledWith(
        expect.stringMatching(/^response:/),
        86400, // 24 hours in seconds
        JSON.stringify(response)
      );
    });

    it('should handle request with system prompt', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        system: 'You are a helpful assistant.',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        max_tokens: 100,
      };

      const response: AnthropicResponse = {
        id: 'msg_sys_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Hello! How can I help you?',
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 15,
          output_tokens: 10,
        },
      };

      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      mockQdrantUpsert.mockResolvedValue({});
      mockRedisSetex.mockResolvedValue('OK');

      await engine.storeResponse(request, response);

      // Should successfully store
      expect(mockQdrantUpsert).toHaveBeenCalled();
      expect(mockRedisSetex).toHaveBeenCalled();
    });

    it('should handle request with multi-content blocks', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'First part',
              },
              {
                type: 'text',
                text: 'Second part',
              },
            ],
          },
        ],
        max_tokens: 100,
      };

      const response: AnthropicResponse = {
        id: 'msg_multi_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Response',
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      mockQdrantUpsert.mockResolvedValue({});
      mockRedisSetex.mockResolvedValue('OK');

      await engine.storeResponse(request, response);

      expect(mockQdrantUpsert).toHaveBeenCalled();
      expect(mockRedisSetex).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should return cache miss on Voyage AI error', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Test',
          },
        ],
        max_tokens: 100,
      };

      // Mock Voyage AI error
      mockAxiosPost.mockRejectedValue(new Error('Voyage AI error'));

      const result = await engine.checkCache(request);

      expect(result.hit).toBe(false);
    });

    it('should return cache miss on Qdrant error', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Test',
          },
        ],
        max_tokens: 100,
      };

      mockAxiosPost.mockResolvedValue({
        data: {
          data: [{ embedding: mockEmbedding }],
        },
      });

      // Mock Qdrant error
      mockQdrantSearch.mockRejectedValue(new Error('Qdrant error'));

      const result = await engine.checkCache(request);

      expect(result.hit).toBe(false);
    });

    it('should not throw on store error', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Test',
          },
        ],
        max_tokens: 100,
      };

      const response: AnthropicResponse = {
        id: 'msg_error_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Response',
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 5,
          output_tokens: 5,
        },
      };

      // Mock Voyage AI error
      mockAxiosPost.mockRejectedValue(new Error('Voyage AI error'));

      // Should not throw
      await expect(engine.storeResponse(request, response)).resolves.not.toThrow();
    });
  });
});
