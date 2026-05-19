import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicRequest, AnthropicResponse } from '../types/anthropic.types';

export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
}

export class AnthropicClientWrapper {
  private client: Anthropic;
  private apiKey: string;

  constructor(config: AnthropicConfig) {
    this.apiKey = config.apiKey;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  getClient(): Anthropic {
    return this.client;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey || this.apiKey === 'not-configured') {
      return true;
    }

    try {
      // Test with a minimal request
      await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  async createMessage(request: Partial<AnthropicRequest>): Promise<AnthropicResponse> {
    const response = await this.client.messages.create({
      model: request.model || 'claude-sonnet-4-20250514',
      max_tokens: request.max_tokens || 1024,
      messages: request.messages || [],
      system: request.system,
      temperature: request.temperature,
      top_p: request.top_p,
      top_k: request.top_k,
      stop_sequences: request.stop_sequences,
      stream: request.stream,
      metadata: request.metadata,
    } as any);

    return response as AnthropicResponse;
  }

  getApiKey(): string {
    return this.apiKey;
  }
}
