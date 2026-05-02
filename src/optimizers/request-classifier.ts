/**
 * Request Classifier
 * 
 * Classifies request complexity using Claude Sonnet to determine
 * optimal thinking budget and model selection.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicRequest } from '../types';

/**
 * Request classification result
 */
export interface RequestClassification {
  complexity: 'simple' | 'moderate' | 'complex';
  confidence: number;
  reasoning: string;
  suggestedThinkingBudget: number;
  suggestedModel: string;
}

/**
 * Request features extracted for classification
 */
interface RequestFeatures {
  messageCount: number;
  totalTokens: number;
  hasTools: boolean;
  hasImages: boolean;
  systemPromptLength: number;
}

/**
 * Request Classifier class
 */
export class RequestClassifier {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Classify request complexity
   * 
   * Uses Claude Sonnet to analyze request features and determine complexity level.
   * Returns classification with suggested thinking budget and model.
   */
  async classify(request: AnthropicRequest): Promise<RequestClassification> {
    // Extract features from request
    const features = this.extractFeatures(request);

    // Generate classification prompt
    const prompt = this.generateClassificationPrompt(features);

    // Call Claude Sonnet for classification
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Parse classification from response
    return this.parseClassification(response, features);
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Extract features from request for classification
   */
  private extractFeatures(request: AnthropicRequest): RequestFeatures {
    const messageCount = request.messages.length;
    const totalTokens = this.estimateTokens(request);
    const hasTools = Boolean(request.tools && request.tools.length > 0);
    const hasImages = this.containsImages(request);
    const systemPromptLength = request.system 
      ? this.estimateSystemTokens(request.system)
      : 0;

    return {
      messageCount,
      totalTokens,
      hasTools,
      hasImages,
      systemPromptLength,
    };
  }

  /**
   * Estimate total tokens in request
   * 
   * Uses rough heuristic: 1 token ≈ 4 characters
   */
  private estimateTokens(request: AnthropicRequest): number {
    let totalChars = 0;

    // Count message tokens
    for (const message of request.messages) {
      if (typeof message.content === 'string') {
        totalChars += message.content.length;
      } else {
        for (const block of message.content) {
          if (block.type === 'text') {
            totalChars += block.text.length;
          } else if (block.type === 'thinking') {
            totalChars += block.thinking.length;
          } else if (block.type === 'tool_result') {
            if (typeof block.content === 'string') {
              totalChars += block.content.length;
            }
          }
        }
      }
    }

    // Count system prompt tokens
    if (request.system) {
      totalChars += this.estimateSystemTokens(request.system) * 4;
    }

    // Convert chars to tokens (rough estimate: 1 token ≈ 4 chars)
    return Math.ceil(totalChars / 4);
  }

  /**
   * Estimate tokens in system prompt
   */
  private estimateSystemTokens(system: string | any[]): number {
    if (typeof system === 'string') {
      return Math.ceil(system.length / 4);
    } else {
      let totalChars = 0;
      for (const block of system) {
        if (block.type === 'text') {
          totalChars += block.text.length;
        }
      }
      return Math.ceil(totalChars / 4);
    }
  }

  /**
   * Check if request contains images
   */
  private containsImages(request: AnthropicRequest): boolean {
    for (const message of request.messages) {
      if (typeof message.content !== 'string') {
        for (const block of message.content) {
          if (block.type === 'image') {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Generate classification prompt for Claude Sonnet
   */
  private generateClassificationPrompt(features: RequestFeatures): string {
    return `Classify the complexity of this API request:

Message count: ${features.messageCount}
Estimated tokens: ${features.totalTokens}
Has tools: ${features.hasTools ? 'Yes' : 'No'}
Has images: ${features.hasImages ? 'Yes' : 'No'}
System prompt length: ${features.systemPromptLength} tokens

Based on these features, classify the request as:
- "simple": Single-turn, no tools, straightforward question (<1000 tokens)
- "moderate": Multi-turn conversation, may have tools, moderate complexity (1000-5000 tokens)
- "complex": Long conversation, tools, images, or complex reasoning (>5000 tokens)

Respond in this exact format:
Complexity: [simple|moderate|complex]
Confidence: [0.0-1.0]
Reasoning: [brief explanation]
Suggested Model: [claude-haiku-4-20250514|claude-sonnet-4-20250514|claude-opus-4-20250514]`;
  }

  /**
   * Parse classification from Claude Sonnet response
   */
  private parseClassification(
    response: Anthropic.Message,
    features: RequestFeatures
  ): RequestClassification {
    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      // Fallback to heuristic classification
      return this.heuristicClassification(features);
    }

    const text = textBlock.text;

    // Parse complexity
    const complexityMatch = text.match(/Complexity:\s*(simple|moderate|complex)/i);
    const complexity = (complexityMatch?.[1]?.toLowerCase() as 'simple' | 'moderate' | 'complex') || 'moderate';

    // Parse confidence
    const confidenceMatch = text.match(/Confidence:\s*([\d.]+)/i);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.8;

    // Parse reasoning
    const reasoningMatch = text.match(/Reasoning:\s*(.+?)(?:\n|$)/i);
    const reasoning = reasoningMatch?.[1]?.trim() || 'Classification based on request features';

    // Parse suggested model
    const modelMatch = text.match(/Suggested Model:\s*(claude-[a-z]+-\d+-\d+)/i);
    const suggestedModel = modelMatch?.[1] || this.getDefaultModel(complexity);

    // Determine thinking budget based on complexity
    const suggestedThinkingBudget = this.getThinkingBudget(complexity);

    return {
      complexity,
      confidence,
      reasoning,
      suggestedThinkingBudget,
      suggestedModel,
    };
  }

  /**
   * Fallback heuristic classification when Claude Sonnet fails
   */
  private heuristicClassification(features: RequestFeatures): RequestClassification {
    let complexity: 'simple' | 'moderate' | 'complex';
    let reasoning: string;

    if (features.totalTokens < 1000 && !features.hasTools && !features.hasImages) {
      complexity = 'simple';
      reasoning = 'Single-turn request with minimal tokens, no tools or images';
    } else if (features.totalTokens < 5000 && features.messageCount < 10) {
      complexity = 'moderate';
      reasoning = 'Multi-turn conversation with moderate token count';
    } else {
      complexity = 'complex';
      reasoning = 'Long conversation or complex request with tools/images';
    }

    return {
      complexity,
      confidence: 0.7,
      reasoning,
      suggestedThinkingBudget: this.getThinkingBudget(complexity),
      suggestedModel: this.getDefaultModel(complexity),
    };
  }

  /**
   * Get thinking budget based on complexity
   */
  private getThinkingBudget(complexity: 'simple' | 'moderate' | 'complex'): number {
    switch (complexity) {
      case 'simple':
        return 0;
      case 'moderate':
        return 2000;
      case 'complex':
        return 10000;
    }
  }

  /**
   * Get default model based on complexity
   */
  private getDefaultModel(complexity: 'simple' | 'moderate' | 'complex'): string {
    switch (complexity) {
      case 'simple':
        return 'claude-haiku-4-20250514';
      case 'moderate':
        return 'claude-sonnet-4-20250514';
      case 'complex':
        return 'claude-opus-4-20250514';
    }
  }
}
