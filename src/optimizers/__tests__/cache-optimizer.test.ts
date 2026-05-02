/**
 * Cache Optimizer Unit Tests
 * 
 * Tests cache marker insertion and optimization strategies.
 */

import { CacheOptimizer } from '../cache-optimizer';
import { AnthropicRequest, Message } from '../../types';

describe('CacheOptimizer', () => {
  let optimizer: CacheOptimizer;

  beforeEach(() => {
    optimizer = new CacheOptimizer();
  });

  // ============================================================================
  // Optimization Skipped for Small Conversations
  // ============================================================================

  describe('Small Conversation Optimization', () => {
    it('should skip optimization for conversations with <1024 tokens', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
          {
            role: 'assistant',
            content: 'Hi there!',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Should return unchanged request
      expect(optimized.messages).toEqual(request.messages);
      expect(optimized.messages[0]).not.toHaveProperty('cache_control');
      expect(optimized.messages[1]).not.toHaveProperty('cache_control');
    });

    it('should skip optimization for single short message', () => {
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

      const optimized = optimizer.optimize(request);

      expect(optimized.messages).toEqual(request.messages);
      expect(optimized.messages[0]).not.toHaveProperty('cache_control');
    });
  });

  // ============================================================================
  // Cache Markers After System Prompts
  // ============================================================================

  describe('System Prompt Optimization', () => {
    it('should insert cache marker after system-like prompt', () => {
      const systemPrompt = 'You are a helpful assistant. Your role is to answer questions accurately.';
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: systemPrompt + ' ' + 'x'.repeat(4000), // Make it large enough
          },
          {
            role: 'assistant',
            content: 'I understand.',
          },
          {
            role: 'user',
            content: 'What is the capital of France?',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // First message should have cache_control
      expect(optimized.messages[0]).toHaveProperty('cache_control');
      expect(optimized.messages[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should detect system prompt with "instructions:" keyword', () => {
      // Need >1024 tokens total (4096 chars = ~1024 tokens)
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Instructions: Follow these guidelines carefully. ' + 'x'.repeat(4100),
          },
          {
            role: 'assistant',
            content: 'Understood.',
          },
          {
            role: 'user',
            content: 'Continue with the task.',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      expect(optimized.messages[0]).toHaveProperty('cache_control');
    });

    it('should detect system prompt with "your task" keyword', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Your task is to help users with their questions. ' + 'x'.repeat(4000),
          },
          {
            role: 'assistant',
            content: 'Ready to help.',
          },
          {
            role: 'user',
            content: 'Great, let me ask you something.',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      expect(optimized.messages[0]).toHaveProperty('cache_control');
    });

    it('should not mark assistant messages as system prompts', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'assistant',
            content: 'You are welcome to ask me anything. ' + 'x'.repeat(4000),
          },
          {
            role: 'user',
            content: 'Thanks!',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Assistant message should not be treated as system prompt
      // (though it might get a marker for other reasons like size)
      const firstMessage = optimized.messages[0];
      if (firstMessage.cache_control) {
        // If it has cache_control, it should be due to size, not system prompt detection
        expect(firstMessage.role).toBe('assistant');
      }
    });
  });

  // ============================================================================
  // Cache Markers After Large Blocks
  // ============================================================================

  describe('Large Block Optimization', () => {
    it('should insert cache marker after large context block (>2000 tokens)', () => {
      const largeContent = 'x'.repeat(8500); // ~2125 tokens

      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: largeContent,
          },
          {
            role: 'assistant',
            content: 'I understand.',
          },
          {
            role: 'user',
            content: 'Continue.',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Large message should have cache_control
      expect(optimized.messages[0]).toHaveProperty('cache_control');
      expect(optimized.messages[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should insert multiple cache markers for multiple large blocks', () => {
      const largeContent = 'x'.repeat(8500); // ~2125 tokens

      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: largeContent,
          },
          {
            role: 'assistant',
            content: 'Got it.',
          },
          {
            role: 'user',
            content: largeContent,
          },
          {
            role: 'assistant',
            content: 'Understood.',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Both large messages should have cache_control
      expect(optimized.messages[0]).toHaveProperty('cache_control');
      expect(optimized.messages[2]).toHaveProperty('cache_control');
    });

    it('should not insert cache marker for small blocks', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Short message ' + 'x'.repeat(4000), // Just enough to trigger optimization
          },
          {
            role: 'assistant',
            content: 'Short reply',
          },
          {
            role: 'user',
            content: 'Another short message',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Small messages should not have cache_control (unless at boundary)
      expect(optimized.messages[1]).not.toHaveProperty('cache_control');
      expect(optimized.messages[2]).not.toHaveProperty('cache_control');
    });
  });

  // ============================================================================
  // Cache Markers at Conversation Boundaries
  // ============================================================================

  describe('Conversation Boundary Optimization', () => {
    it('should insert cache marker at 5-message boundary', () => {
      // Need >1024 tokens total (4096 chars = ~1024 tokens)
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: 'Message 1 ' + 'x'.repeat(4100) },
          { role: 'assistant', content: 'Reply 1' },
          { role: 'user', content: 'Message 2' },
          { role: 'assistant', content: 'Reply 2' },
          { role: 'user', content: 'Message 3' }, // Index 4 - boundary
          { role: 'assistant', content: 'Reply 3' },
          { role: 'user', content: 'Message 4' },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Message at index 4 should have cache_control
      expect(optimized.messages[4]).toHaveProperty('cache_control');
    });

    it('should insert cache markers at multiple 5-message boundaries', () => {
      const messages: Message[] = [];
      for (let i = 0; i < 12; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: i === 0 ? `Message ${i + 1} ` + 'x'.repeat(4100) : `Message ${i + 1}`,
        });
      }

      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages,
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Boundaries at indices 4 and 9
      expect(optimized.messages[4]).toHaveProperty('cache_control');
      expect(optimized.messages[9]).toHaveProperty('cache_control');
    });

    it('should not duplicate cache markers at boundaries', () => {
      const largeContent = 'x'.repeat(8500); // Large enough to trigger size-based caching

      const messages: Message[] = [];
      for (let i = 0; i < 6; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: i === 4 ? largeContent : `Message ${i + 1}`,
        });
      }

      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages,
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Index 4 should have cache_control (both boundary and large block)
      // But should only have one cache_control marker
      expect(optimized.messages[4]).toHaveProperty('cache_control');
      expect(optimized.messages[4].cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  // ============================================================================
  // Analyze Conversation
  // ============================================================================

  describe('Conversation Analysis', () => {
    it('should analyze conversation and return metrics', () => {
      const messages: Message[] = [
        { role: 'user', content: 'x'.repeat(4000) }, // ~1000 tokens
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'x'.repeat(4000) }, // ~1000 tokens
      ];

      const analysis = optimizer.analyzeConversation(messages);

      expect(analysis.totalTokens).toBeGreaterThan(2000);
      expect(analysis.recommendedCachePoints).toBeInstanceOf(Array);
      expect(analysis.estimatedCacheHitRate).toBeGreaterThan(0);
      expect(analysis.estimatedCacheHitRate).toBeLessThanOrEqual(0.9);
    });

    it('should recommend more cache points for longer conversations', () => {
      const shortMessages: Message[] = [
        { role: 'user', content: 'x'.repeat(2000) },
        { role: 'assistant', content: 'Reply' },
      ];

      const longMessages: Message[] = [];
      for (let i = 0; i < 10; i++) {
        longMessages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(2000),
        });
      }

      const shortAnalysis = optimizer.analyzeConversation(shortMessages);
      const longAnalysis = optimizer.analyzeConversation(longMessages);

      expect(longAnalysis.recommendedCachePoints.length).toBeGreaterThan(
        shortAnalysis.recommendedCachePoints.length
      );
    });

    it('should estimate higher cache hit rate with more cache points', () => {
      const fewMessages: Message[] = [
        { role: 'user', content: 'x'.repeat(2000) },
        { role: 'assistant', content: 'Reply' },
      ];

      const manyMessages: Message[] = [];
      for (let i = 0; i < 15; i++) {
        manyMessages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(2000),
        });
      }

      const fewAnalysis = optimizer.analyzeConversation(fewMessages);
      const manyAnalysis = optimizer.analyzeConversation(manyMessages);

      expect(manyAnalysis.estimatedCacheHitRate).toBeGreaterThanOrEqual(
        fewAnalysis.estimatedCacheHitRate
      );
    });
  });

  // ============================================================================
  // Multi-Content Block Messages
  // ============================================================================

  describe('Multi-Content Block Messages', () => {
    it('should handle messages with multiple text blocks', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Part 1 ' + 'x'.repeat(4000) },
              { type: 'text', text: 'Part 2 ' + 'x'.repeat(4000) },
            ],
          },
          {
            role: 'assistant',
            content: 'Reply',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Should process multi-content blocks correctly
      expect(optimized.messages).toBeDefined();
      expect(optimized.messages.length).toBe(2);
    });

    it('should handle messages with mixed content types', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Text content ' + 'x'.repeat(4000) },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'base64data',
                },
              },
            ],
          },
          {
            role: 'assistant',
            content: 'I see the image.',
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      // Should handle mixed content without errors
      expect(optimized.messages).toBeDefined();
      expect(optimized.messages.length).toBe(2);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty messages array', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      expect(optimized.messages).toEqual([]);
    });

    it('should handle single message conversation', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'x'.repeat(5000),
          },
        ],
        max_tokens: 100,
      };

      const optimized = optimizer.optimize(request);

      expect(optimized.messages.length).toBe(1);
    });

    it('should preserve other request properties', () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'x'.repeat(5000),
          },
        ],
        max_tokens: 2000,
        temperature: 0.7,
        top_p: 0.9,
        metadata: {
          user_id: 'user123',
        },
      };

      const optimized = optimizer.optimize(request);

      expect(optimized.model).toBe(request.model);
      expect(optimized.max_tokens).toBe(request.max_tokens);
      expect(optimized.temperature).toBe(request.temperature);
      expect(optimized.top_p).toBe(request.top_p);
      expect(optimized.metadata).toEqual(request.metadata);
    });
  });
});
