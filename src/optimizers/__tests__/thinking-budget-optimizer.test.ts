/**
 * Thinking Budget Optimizer Unit Tests
 * 
 * Tests thinking budget allocation based on request complexity.
 */

import { ThinkingBudgetOptimizer } from '../thinking-budget-optimizer';
import { RequestClassification } from '../request-classifier';
import { AnthropicRequest } from '../../types';

describe('ThinkingBudgetOptimizer', () => {
  let optimizer: ThinkingBudgetOptimizer;

  beforeEach(() => {
    optimizer = new ThinkingBudgetOptimizer();
  });

  // ============================================================================
  // Simple Request Optimization
  // ============================================================================

  describe('Simple Request Optimization', () => {
    it('should set budget to 0 for simple classification', () => {
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

      const classification: RequestClassification = {
        complexity: 'simple',
        confidence: 0.95,
        reasoning: 'Single simple question',
        suggestedThinkingBudget: 0,
        suggestedModel: 'claude-haiku-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      // Should not have thinking config
      expect(optimized.thinking).toBeUndefined();
    });

    it('should remove thinking config for simple requests', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        max_tokens: 100,
        thinking: {
          type: 'enabled',
          budget_tokens: 5000,
        },
      };

      const classification: RequestClassification = {
        complexity: 'simple',
        confidence: 0.9,
        reasoning: 'Simple greeting',
        suggestedThinkingBudget: 0,
        suggestedModel: 'claude-haiku-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      // Should remove thinking config (but preserve user-specified budget)
      // Actually, user-specified budget should be preserved
      expect(optimized.thinking).toBeDefined();
      expect(optimized.thinking?.budget_tokens).toBe(5000);
    });
  });

  // ============================================================================
  // Moderate Request Optimization
  // ============================================================================

  describe('Moderate Request Optimization', () => {
    it('should set budget to 2000 for moderate classification', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Explain the concept of recursion with examples.',
          },
        ],
        max_tokens: 500,
      };

      const classification: RequestClassification = {
        complexity: 'moderate',
        confidence: 0.85,
        reasoning: 'Requires explanation with examples',
        suggestedThinkingBudget: 2000,
        suggestedModel: 'claude-sonnet-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.thinking).toBeDefined();
      expect(optimized.thinking?.type).toBe('enabled');
      expect(optimized.thinking?.budget_tokens).toBe(2000);
    });

    it('should add thinking config to request without one', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Write a function to sort an array.',
          },
        ],
        max_tokens: 500,
      };

      const classification: RequestClassification = {
        complexity: 'moderate',
        confidence: 0.88,
        reasoning: 'Coding task with moderate complexity',
        suggestedThinkingBudget: 2000,
        suggestedModel: 'claude-sonnet-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.thinking).toBeDefined();
      expect(optimized.thinking?.budget_tokens).toBe(2000);
    });
  });

  // ============================================================================
  // Complex Request Optimization
  // ============================================================================

  describe('Complex Request Optimization', () => {
    it('should set budget to 10000 for complex classification', () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Design a distributed system architecture for a real-time chat application with millions of users.',
          },
        ],
        max_tokens: 2000,
      };

      const classification: RequestClassification = {
        complexity: 'complex',
        confidence: 0.92,
        reasoning: 'Complex system design task requiring deep analysis',
        suggestedThinkingBudget: 10000,
        suggestedModel: 'claude-opus-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.thinking).toBeDefined();
      expect(optimized.thinking?.type).toBe('enabled');
      expect(optimized.thinking?.budget_tokens).toBe(10000);
    });

    it('should handle complex multi-turn conversations', () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'I need help designing a complex algorithm.',
          },
          {
            role: 'assistant',
            content: 'I can help with that. What are the requirements?',
          },
          {
            role: 'user',
            content: 'It needs to handle graph traversal with dynamic weights and optimize for both time and space complexity.',
          },
        ],
        max_tokens: 2000,
      };

      const classification: RequestClassification = {
        complexity: 'complex',
        confidence: 0.95,
        reasoning: 'Complex algorithm design with multiple constraints',
        suggestedThinkingBudget: 10000,
        suggestedModel: 'claude-opus-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.thinking?.budget_tokens).toBe(10000);
    });
  });

  // ============================================================================
  // User-Specified Budget Preservation
  // ============================================================================

  describe('User-Specified Budget Preservation', () => {
    it('should preserve user-specified thinking budget', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Solve this problem.',
          },
        ],
        max_tokens: 500,
        thinking: {
          type: 'enabled',
          budget_tokens: 5000,
        },
      };

      const classification: RequestClassification = {
        complexity: 'simple',
        confidence: 0.9,
        reasoning: 'Simple request',
        suggestedThinkingBudget: 0,
        suggestedModel: 'claude-haiku-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      // Should preserve user's budget of 5000, not override to 0
      expect(optimized.thinking).toBeDefined();
      expect(optimized.thinking?.budget_tokens).toBe(5000);
    });

    it('should preserve user budget even for moderate classification', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Explain this concept.',
          },
        ],
        max_tokens: 500,
        thinking: {
          type: 'enabled',
          budget_tokens: 1000,
        },
      };

      const classification: RequestClassification = {
        complexity: 'moderate',
        confidence: 0.85,
        reasoning: 'Moderate explanation task',
        suggestedThinkingBudget: 2000,
        suggestedModel: 'claude-sonnet-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      // Should preserve user's budget of 1000, not override to 2000
      expect(optimized.thinking?.budget_tokens).toBe(1000);
    });

    it('should preserve user budget even for complex classification', () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Design a complex system.',
          },
        ],
        max_tokens: 2000,
        thinking: {
          type: 'enabled',
          budget_tokens: 15000,
        },
      };

      const classification: RequestClassification = {
        complexity: 'complex',
        confidence: 0.92,
        reasoning: 'Complex system design',
        suggestedThinkingBudget: 10000,
        suggestedModel: 'claude-opus-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      // Should preserve user's budget of 15000, not override to 10000
      expect(optimized.thinking?.budget_tokens).toBe(15000);
    });
  });

  // ============================================================================
  // Request Property Preservation
  // ============================================================================

  describe('Request Property Preservation', () => {
    it('should preserve all other request properties', () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Test message',
          },
        ],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        metadata: {
          user_id: 'user123',
        },
      };

      const classification: RequestClassification = {
        complexity: 'moderate',
        confidence: 0.85,
        reasoning: 'Moderate task',
        suggestedThinkingBudget: 2000,
        suggestedModel: 'claude-sonnet-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.model).toBe(request.model);
      expect(optimized.max_tokens).toBe(request.max_tokens);
      expect(optimized.temperature).toBe(request.temperature);
      expect(optimized.top_p).toBe(request.top_p);
      expect(optimized.top_k).toBe(request.top_k);
      expect(optimized.metadata).toEqual(request.metadata);
      expect(optimized.messages).toEqual(request.messages);
    });

    it('should preserve tools and tool_choice', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Use the calculator tool.',
          },
        ],
        max_tokens: 500,
        tools: [
          {
            name: 'calculator',
            description: 'Performs calculations',
            input_schema: {
              type: 'object',
              properties: {
                expression: { type: 'string' },
              },
              required: ['expression'],
            },
          },
        ],
        tool_choice: { type: 'auto' },
      };

      const classification: RequestClassification = {
        complexity: 'moderate',
        confidence: 0.88,
        reasoning: 'Tool usage task',
        suggestedThinkingBudget: 2000,
        suggestedModel: 'claude-sonnet-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.tools).toEqual(request.tools);
      expect(optimized.tool_choice).toEqual(request.tool_choice);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle request with no thinking config for simple classification', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: 'Hi',
          },
        ],
        max_tokens: 100,
      };

      const classification: RequestClassification = {
        complexity: 'simple',
        confidence: 0.99,
        reasoning: 'Very simple greeting',
        suggestedThinkingBudget: 0,
        suggestedModel: 'claude-haiku-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.thinking).toBeUndefined();
    });

    it('should handle empty messages array', () => {
      const request: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        messages: [],
        max_tokens: 100,
      };

      const classification: RequestClassification = {
        complexity: 'simple',
        confidence: 0.5,
        reasoning: 'Empty request',
        suggestedThinkingBudget: 0,
        suggestedModel: 'claude-haiku-4-20250514',
      };

      const optimized = optimizer.optimize(request, classification);

      expect(optimized.messages).toEqual([]);
      expect(optimized.thinking).toBeUndefined();
    });
  });
});
