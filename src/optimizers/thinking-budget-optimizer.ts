/**
 * Thinking Budget Optimizer
 * 
 * Sets optimal thinking budget based on request complexity.
 * Uses RequestClassification to determine appropriate budget.
 */

import { AnthropicRequest } from '../types';
import { RequestClassification } from './request-classifier';

/**
 * Thinking Budget Optimizer class
 */
export class ThinkingBudgetOptimizer {
  /**
   * Optimize thinking budget based on request complexity
   * 
   * Budget allocation:
   * - Simple requests: 0 tokens (no thinking needed)
   * - Moderate requests: 2000 tokens
   * - Complex requests: 10000 tokens
   * 
   * Preserves user-specified thinking budget if present.
   */
  optimize(
    request: AnthropicRequest,
    classification: RequestClassification
  ): AnthropicRequest {
    // Don't override user-specified thinking budget
    if (request.thinking?.budget_tokens) {
      return request;
    }

    // Set budget based on complexity
    const budgetMap: Record<RequestClassification['complexity'], number> = {
      simple: 0,
      moderate: 2000,
      complex: 10000,
    };

    const budget = budgetMap[classification.complexity];

    // For simple requests, remove thinking config entirely
    if (budget === 0) {
      const { thinking, ...rest } = request;
      return rest as AnthropicRequest;
    }

    // For moderate/complex requests, set thinking budget
    return {
      ...request,
      thinking: {
        type: 'enabled',
        budget_tokens: budget,
      },
    };
  }
}
