/**
 * Request Classifier Unit Tests
 * 
 * Tests classification of simple, moderate, and complex requests
 * with mocked Claude Sonnet responses.
 */

import { RequestClassifier } from '../request-classifier';
import { AnthropicRequest } from '../../types/index.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk');

describe('RequestClassifier', () => {
  let classifier: RequestClassifier;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock for messages.create
    mockCreate = jest.fn();
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    } as any));

    // Create classifier instance
    classifier = new RequestClassifier('test-api-key');
  });

  // ============================================================================
  // Simple Request Tests
  // ============================================================================

  describe('Simple Requests', () => {
    it('should classify single message with no tools as simple', async () => {
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

      // Mock Claude Sonnet response
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: simple
Confidence: 0.95
Reasoning: Single-turn question with minimal tokens and no tools
Suggested Model: claude-haiku-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBe('simple');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.suggestedThinkingBudget).toBe(0);
      expect(result.suggestedModel).toBe('claude-haiku-4-20250514');
    });

    it('should classify short conversation as simple', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
          {
            role: 'assistant',
            content: 'Hi! How can I help you?',
          },
          {
            role: 'user',
            content: 'What time is it?',
          },
        ],
        max_tokens: 100,
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: simple
Confidence: 0.90
Reasoning: Short conversation with straightforward questions
Suggested Model: claude-haiku-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBe('simple');
      expect(result.suggestedThinkingBudget).toBe(0);
    });
  });

  // ============================================================================
  // Moderate Request Tests
  // ============================================================================

  describe('Moderate Requests', () => {
    it('should classify multi-turn conversation as moderate', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Can you help me understand how neural networks work?',
          },
          {
            role: 'assistant',
            content: 'Sure! Neural networks are computational models inspired by biological neurons...',
          },
          {
            role: 'user',
            content: 'What about backpropagation?',
          },
          {
            role: 'assistant',
            content: 'Backpropagation is the algorithm used to train neural networks...',
          },
          {
            role: 'user',
            content: 'Can you give me an example?',
          },
        ],
        max_tokens: 1000,
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: moderate
Confidence: 0.85
Reasoning: Multi-turn technical conversation requiring detailed explanations
Suggested Model: claude-sonnet-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBe('moderate');
      expect(result.suggestedThinkingBudget).toBe(2000);
      expect(result.suggestedModel).toBe('claude-sonnet-4-20250514');
    });

    it('should classify request with tools as moderate', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Search for information about quantum computing',
          },
        ],
        max_tokens: 1000,
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            input_schema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        ],
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: moderate
Confidence: 0.88
Reasoning: Request involves tool usage which adds complexity
Suggested Model: claude-sonnet-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBe('moderate');
      expect(result.suggestedThinkingBudget).toBe(2000);
    });
  });

  // ============================================================================
  // Complex Request Tests
  // ============================================================================

  describe('Complex Requests', () => {
    it('should classify long conversation with tools as complex', async () => {
      const messages = [];
      for (let i = 0; i < 15; i++) {
        messages.push({
          role: 'user' as const,
          content: `Message ${i}: This is a long conversation with detailed technical content...`,
        });
        messages.push({
          role: 'assistant' as const,
          content: `Response ${i}: Here is a detailed explanation with multiple paragraphs...`,
        });
      }

      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages,
        max_tokens: 4000,
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            input_schema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'calculate',
            description: 'Perform calculations',
            input_schema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: complex
Confidence: 0.92
Reasoning: Long multi-turn conversation with multiple tools requiring deep reasoning
Suggested Model: claude-opus-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBe('complex');
      expect(result.suggestedThinkingBudget).toBe(10000);
      expect(result.suggestedModel).toBe('claude-opus-4-20250514');
    });

    it('should classify request with images as complex', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this image',
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: 'base64data...',
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: complex
Confidence: 0.90
Reasoning: Image analysis requires visual understanding and detailed reasoning
Suggested Model: claude-opus-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBe('complex');
      expect(result.suggestedThinkingBudget).toBe(10000);
    });
  });

  // ============================================================================
  // Fallback Heuristic Tests
  // ============================================================================

  describe('Fallback Heuristic Classification', () => {
    it('should use heuristic when Claude Sonnet fails', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Simple question',
          },
        ],
        max_tokens: 100,
      };

      // Mock Claude Sonnet returning invalid response
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'thinking',
            thinking: 'Invalid response type',
          },
        ],
      });

      const result = await classifier.classify(request);

      // Should still return valid classification using heuristic
      expect(result.complexity).toBe('simple');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.suggestedThinkingBudget).toBeDefined();
      expect(result.suggestedModel).toBeDefined();
    });

    it('should classify based on token count heuristic', async () => {
      // Create a request with many tokens
      const longContent = 'word '.repeat(2000); // ~8000 chars = ~2000 tokens

      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: longContent,
          },
        ],
        max_tokens: 1000,
      };

      mockCreate.mockResolvedValue({
        content: [], // Empty response to trigger heuristic
      });

      const result = await classifier.classify(request);

      // Should classify as moderate or complex based on token count
      expect(['moderate', 'complex']).toContain(result.complexity);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle request with system prompt', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        system: 'You are a helpful assistant specialized in mathematics.',
        messages: [
          {
            role: 'user',
            content: 'Solve this equation: x^2 + 5x + 6 = 0',
          },
        ],
        max_tokens: 500,
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: moderate
Confidence: 0.85
Reasoning: Mathematical problem with system context
Suggested Model: claude-sonnet-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBeDefined();
      expect(result.suggestedThinkingBudget).toBeGreaterThanOrEqual(0);
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

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: simple
Confidence: 0.90
Reasoning: Simple multi-part message
Suggested Model: claude-haiku-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBeDefined();
    });

    it('should handle empty messages array gracefully', async () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [],
        max_tokens: 100,
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: `Complexity: simple
Confidence: 0.50
Reasoning: Empty request
Suggested Model: claude-haiku-4-20250514`,
          },
        ],
      });

      const result = await classifier.classify(request);

      expect(result.complexity).toBeDefined();
      expect(result.suggestedThinkingBudget).toBeGreaterThanOrEqual(0);
    });
  });
});
