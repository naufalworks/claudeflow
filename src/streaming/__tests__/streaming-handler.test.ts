/**
 * StreamingHandler Integration Tests
 * 
 * Tests streaming response handling with different modes.
 */

import { StreamingHandler } from '../streaming-handler';
import type { ServerSentEvent, StreamChunk } from '../../types/anthropic.types';
import { AnthropicClientWrapper } from '../../infrastructure/anthropic';

// Mock AnthropicClientWrapper
jest.mock('../../infrastructure/anthropic');

describe('StreamingHandler', () => {
  let handler: StreamingHandler;
  let mockAnthropicClient: jest.Mocked<AnthropicClientWrapper>;

  beforeEach(() => {
    mockAnthropicClient = new AnthropicClientWrapper({
      apiKey: 'test-key',
    }) as jest.Mocked<AnthropicClientWrapper>;
  });

  // ============================================================================
  // Standard Streaming Mode Tests
  // ============================================================================

  describe('Standard Streaming Mode', () => {
    beforeEach(() => {
      handler = new StreamingHandler({ mode: 'standard' });
    });

    it('should handle message_start event', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'message_start',
          data: JSON.stringify({
            message: {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-sonnet-4-20250514',
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 100,
                output_tokens: 0,
              },
            },
          }),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('message_start');
      expect((chunks[0] as any).message.id).toBe('msg_123');
    });

    it('should handle content_block_start event', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: {
              type: 'text',
              text: '',
            },
          }),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('content_block_start');
    });

    it('should handle content_block_delta events and accumulate text', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: {
              type: 'text',
              text: '',
            },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'Hello',
            },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: {
              type: 'text_delta',
              text: ' world',
            },
          }),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[1].type).toBe('content_block_delta');
      expect(chunks[2].type).toBe('content_block_delta');
    });

    it('should handle message_stop event', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'message_stop',
          data: JSON.stringify({}),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('message_stop');
    });

    it('should handle complete streaming flow', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'message_start',
          data: JSON.stringify({
            message: {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-sonnet-4-20250514',
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 100,
                output_tokens: 0,
              },
            },
          }),
        },
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: {
              type: 'text',
              text: '',
            },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'Hello, how can I help you?',
            },
          }),
        },
        {
          event: 'content_block_stop',
          data: JSON.stringify({
            index: 0,
          }),
        },
        {
          event: 'message_delta',
          data: JSON.stringify({
            delta: {
              stop_reason: 'end_turn',
            },
            usage: {
              output_tokens: 7,
            },
          }),
        },
        {
          event: 'message_stop',
          data: JSON.stringify({}),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(6);
      expect(chunks[0].type).toBe('message_start');
      expect(chunks[1].type).toBe('content_block_start');
      expect(chunks[2].type).toBe('content_block_delta');
      expect(chunks[3].type).toBe('content_block_stop');
      expect(chunks[4].type).toBe('message_delta');
      expect(chunks[5].type).toBe('message_stop');
    });

    it('should handle ping events', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'ping',
          data: JSON.stringify({}),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('ping');
    });

    it('should handle error events', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'error',
          data: JSON.stringify({
            error: {
              type: 'rate_limit_error',
              message: 'Rate limit exceeded',
            },
          }),
        },
      ];

      await expect(async () => {
        for await (const _chunk of handler.handleStream(asyncIterableFromArray(events))) {
          // Should throw before yielding
        }
      }).rejects.toThrow('Stream error: Rate limit exceeded');
    });
  });

  // ============================================================================
  // Quality Monitoring Mode Tests
  // ============================================================================

  describe('Quality Monitoring Mode', () => {
    beforeEach(() => {
      handler = new StreamingHandler(
        {
          mode: 'quality_monitored',
          qualityThreshold: 0.8,
          evaluationInterval: 2,
        },
        mockAnthropicClient
      );
    });

    it('should evaluate quality at specified intervals', async () => {
      // Mock Claude Sonnet quality evaluation
      mockAnthropicClient.createMessage = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '0.85' }],
      });

      const events: ServerSentEvent[] = [
        {
          event: 'message_start',
          data: JSON.stringify({
            message: {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-sonnet-4-20250514',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 0 },
            },
          }),
        },
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'This is a high quality response with clear structure and good content.',
            },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: { type: 'text_delta', text: ' More content here.' },
          }),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      // Should evaluate quality after 2 chunks (evaluationInterval = 2)
      expect(mockAnthropicClient.createMessage).toHaveBeenCalled();
    });

    it('should stop early when quality threshold is met', async () => {
      // Mock Claude Sonnet quality evaluation - high quality
      mockAnthropicClient.createMessage = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '0.95' }],
      });

      const events: ServerSentEvent[] = [
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'Excellent response with perfect clarity and structure.',
            },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: { type: 'text_delta', text: ' Additional content.' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: { type: 'text_delta', text: ' This should not be reached.' },
          }),
        },
      ];

      const chunks: StreamChunk[] = [];
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      // Should stop after 2 chunks when quality threshold (0.8) is met with score 0.95
      expect(chunks.length).toBeLessThan(4);
    });

    it('should interrupt stream when quality is too low', async () => {
      // Mock Claude Sonnet quality evaluation - low quality
      mockAnthropicClient.createMessage = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '0.2' }],
      });

      const events: ServerSentEvent[] = [
        {
          event: 'message_start',
          data: JSON.stringify({
            message: {
              id: 'msg_123',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-sonnet-4-20250514',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 0 },
            },
          }),
        },
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: { type: 'text_delta', text: 'Poor quality response with insufficient content.' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: { type: 'text_delta', text: ' More poor content.' },
          }),
        },
      ];

      await expect(async () => {
        for await (const _chunk of handler.handleStream(asyncIterableFromArray(events))) {
          // Should throw when quality is below 0.3
        }
      }).rejects.toThrow('Stream interrupted: Quality score');
    });

    it('should fall back to heuristic if Claude evaluation fails', async () => {
      // Mock Claude Sonnet to throw error
      mockAnthropicClient.createMessage = jest.fn().mockRejectedValue(new Error('API error'));

      const events: ServerSentEvent[] = [
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'This is a response with reasonable length and structure.',
            },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: { type: 'text_delta', text: ' More content here.' },
          }),
        },
      ];

      const chunks: StreamChunk[] = [];
      // Should not throw - falls back to heuristic
      for await (const chunk of handler.handleStream(asyncIterableFromArray(events))) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // getFinalState Tests
  // ============================================================================

  describe('getFinalState', () => {
    beforeEach(() => {
      handler = new StreamingHandler({ mode: 'standard' });
    });

    it('should accumulate final state from stream', async () => {
      const events: ServerSentEvent[] = [
        {
          event: 'message_start',
          data: JSON.stringify({
            message: {
              id: 'msg_456',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-sonnet-4-20250514',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 50, output_tokens: 0 },
            },
          }),
        },
        {
          event: 'content_block_start',
          data: JSON.stringify({
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            index: 0,
            delta: { type: 'text_delta', text: 'Final accumulated text' },
          }),
        },
        {
          event: 'message_delta',
          data: JSON.stringify({
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 5 },
          }),
        },
      ];

      const state = await handler.getFinalState(asyncIterableFromArray(events));

      expect(state.messageId).toBe('msg_456');
      expect(state.model).toBe('claude-sonnet-4-20250514');
      expect(state.stopReason).toBe('end_turn');
      expect(state.usage.input_tokens).toBe(50);
      expect(state.usage.output_tokens).toBe(5);
      expect(state.contentBlocks).toHaveLength(1);
      expect((state.contentBlocks[0] as any).text).toBe('Final accumulated text');
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert array to async iterable
 */
async function* asyncIterableFromArray<T>(array: T[]): AsyncIterable<T> {
  for (const item of array) {
    yield item;
  }
}
