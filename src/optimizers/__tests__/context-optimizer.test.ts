import { ContextOptimizer } from '../context-optimizer';
import type { AnthropicRequest, Message } from '../../types/anthropic.types';
import Anthropic from '@anthropic-ai/sdk';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk');

describe('ContextOptimizer', () => {
  let optimizer: ContextOptimizer;
  let mockAnthropicCreate: jest.Mock;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock for messages.create
    mockAnthropicCreate = jest.fn();
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => ({
      messages: {
        create: mockAnthropicCreate,
      },
    } as any));

    optimizer = new ContextOptimizer('test-api-key');
  });

  describe('Small Conversation Optimization', () => {
    it('should skip optimization for conversations with <8000 tokens', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      };

      const result = await optimizer.optimize(request);

      // Should return unchanged
      expect(result).toEqual(request);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('should skip optimization when total tokens are exactly 8000', async () => {
      // Create a message with approximately 8000 tokens (32000 characters)
      const largeContent = 'a'.repeat(32000);
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: largeContent },
        ],
      };

      const result = await optimizer.optimize(request);

      // Should return unchanged (not > 8000)
      expect(result).toEqual(request);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });
  });

  describe('Recent Message Preservation', () => {
    it('should preserve most recent 3 messages without modification', async () => {
      // Create a large conversation (>8000 tokens)
      const largeContent = 'a'.repeat(10000); // ~2500 tokens each
      const messages: Message[] = [
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: 'Recent message 1' },
        { role: 'assistant', content: 'Recent message 2' },
        { role: 'user', content: 'Recent message 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Mock Claude Haiku response
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Summary of conversation' }],
      });

      const result = await optimizer.optimize(request);

      // Check that recent 3 messages are preserved
      const resultMessages = result.messages;
      expect(resultMessages[resultMessages.length - 1]).toEqual({
        role: 'user',
        content: 'Recent message 3',
      });
      expect(resultMessages[resultMessages.length - 2]).toEqual({
        role: 'assistant',
        content: 'Recent message 2',
      });
      expect(resultMessages[resultMessages.length - 3]).toEqual({
        role: 'user',
        content: 'Recent message 1',
      });
    });

    it('should handle conversation with exactly 3 messages', async () => {
      const largeContent = 'a'.repeat(10000); // ~2500 tokens each
      const messages: Message[] = [
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      const result = await optimizer.optimize(request);

      // Should return unchanged (no old messages to compress)
      expect(result).toEqual(request);
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });
  });

  describe('Old Message Compression', () => {
    it('should compress old messages using Claude Haiku', async () => {
      const largeContent = 'a'.repeat(10000); // ~2500 tokens each
      const messages: Message[] = [
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Mock Claude Haiku response
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Summarized conversation content' }],
      });

      const result = await optimizer.optimize(request);

      // Should have called Claude Haiku for summarization
      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-20250514',
          max_tokens: 500,
        })
      );

      // Result should have compressed messages + recent 3
      expect(result.messages.length).toBeLessThan(messages.length);
      
      // Should have at least one summarized message
      const hasSummary = result.messages.some(
        (msg) => typeof msg.content === 'string' && msg.content.includes('[Summarized]')
      );
      expect(hasSummary).toBe(true);
    });

    it('should group old messages into chunks of 4', async () => {
      const largeContent = 'a'.repeat(10000);
      const messages: Message[] = [
        // 8 old messages (should create 2 chunks of 4)
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        // 3 recent messages
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Mock Claude Haiku response
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Summary' }],
      });

      await optimizer.optimize(request);

      // Should have called Claude Haiku twice (2 chunks of 4)
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });

    it('should handle partial chunks correctly', async () => {
      const largeContent = 'a'.repeat(10000);
      const messages: Message[] = [
        // 5 old messages (should create 1 chunk of 4 + 1 chunk of 1)
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        // 3 recent messages
        { role: 'assistant', content: 'Recent 1' },
        { role: 'user', content: 'Recent 2' },
        { role: 'assistant', content: 'Recent 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Mock Claude Haiku response
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Summary' }],
      });

      await optimizer.optimize(request);

      // Should have called Claude Haiku twice (1 full chunk + 1 partial)
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Compression Ratio Calculation', () => {
    it('should calculate compression ratio correctly', () => {
      const originalMessages: Message[] = [
        { role: 'user', content: 'a'.repeat(4000) }, // ~1000 tokens
        { role: 'assistant', content: 'a'.repeat(4000) }, // ~1000 tokens
      ];

      const compressedMessages: Message[] = [
        { role: 'assistant', content: '[Summarized]: Short summary' }, // ~10 tokens
      ];

      const ratio = optimizer.calculateCompressionRatio(
        originalMessages,
        compressedMessages
      );

      // Should be significantly compressed
      expect(ratio).toBeLessThan(0.1);
      expect(ratio).toBeGreaterThan(0);
    });

    it('should return 1 for empty original messages', () => {
      const ratio = optimizer.calculateCompressionRatio([], []);
      expect(ratio).toBe(1);
    });

    it('should handle no compression (ratio = 1)', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];

      const ratio = optimizer.calculateCompressionRatio(messages, messages);
      expect(ratio).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle Claude Haiku API errors gracefully', async () => {
      const largeContent = 'a'.repeat(10000);
      const messages: Message[] = [
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Mock Claude Haiku to throw error
      mockAnthropicCreate.mockRejectedValue(new Error('API error'));

      const result = await optimizer.optimize(request);

      // Should still return a result (with original messages if compression fails)
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should log errors when compression fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const largeContent = 'a'.repeat(10000);
      const messages: Message[] = [
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Mock Claude Haiku to throw error
      mockAnthropicCreate.mockRejectedValue(new Error('API error'));

      await optimizer.optimize(request);

      // Should have logged the error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error compressing messages:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Multi-Content Block Messages', () => {
    it('should handle messages with multi-content blocks', async () => {
      const largeContent = 'a'.repeat(10000);
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: largeContent },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } },
          ],
        },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Mock Claude Haiku response
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Summary with image context' }],
      });

      const result = await optimizer.optimize(request);

      // Should handle multi-content blocks
      expect(result.messages).toBeDefined();
      expect(mockAnthropicCreate).toHaveBeenCalled();
    });

    it('should estimate tokens for images correctly', async () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this image' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } },
          ],
        },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
      };

      // Should not optimize (image + text < 8000 tokens)
      const result = await optimizer.optimize(request);
      expect(result).toEqual(request);
    });
  });

  describe('Request Property Preservation', () => {
    it('should preserve all other request properties', async () => {
      const largeContent = 'a'.repeat(10000);
      const messages: Message[] = [
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: largeContent },
        { role: 'assistant', content: largeContent },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
        { role: 'user', content: 'Recent 3' },
      ];

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages,
        temperature: 0.7,
        top_p: 0.9,
        system: 'You are a helpful assistant',
        metadata: { user_id: 'test-user' },
      };

      // Mock Claude Haiku response
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Summary' }],
      });

      const result = await optimizer.optimize(request);

      // Should preserve all properties except messages
      expect(result.model).toBe(request.model);
      expect(result.max_tokens).toBe(request.max_tokens);
      expect(result.temperature).toBe(request.temperature);
      expect(result.top_p).toBe(request.top_p);
      expect(result.system).toBe(request.system);
      expect(result.metadata).toEqual(request.metadata);
    });
  });
});
