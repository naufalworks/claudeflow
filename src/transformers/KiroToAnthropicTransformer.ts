/**
 * KiroToAnthropicTransformer
 *
 * Converts Kiro (AWS CodeWhisperer) streaming events to Anthropic format
 *
 * Kiro streaming events:
 * - assistantResponseEvent: text content
 * - codeEvent: code blocks
 * - supplementaryWebLinksEvent: references
 * - reasoningContentEvent: thinking/reasoning
 *
 * Anthropic format:
 * {
 *   id: "msg_123",
 *   type: "message",
 *   role: "assistant",
 *   content: [{type: "text", text: "Hello"}],
 *   model: "claude-sonnet-4-20250514",
 *   usage: {input_tokens: 10, output_tokens: 5}
 * }
 */

import type { AnthropicResponse } from '../types/anthropic.types';

export interface KiroStreamEvent {
  assistantResponseEvent?: { content: string };
  codeEvent?: { content: string };
  reasoningContentEvent?: { content: string };
  toolUseEvent?: { toolUseId?: string; name?: string; input?: any };
  supplementaryWebLinksEvent?: { references: any[] };
  messageMetadataEvent?: { usage?: any };
  metricsEvent?: { inputTokens?: number; outputTokens?: number };
}

export class KiroToAnthropicTransformer {
  private responseId: string;
  private model: string;
  private currentTextBlock: string = '';
  private currentThinkingBlock: string = '';
  private usage: any = { input_tokens: 0, output_tokens: 0 };
  private toolUses = new Map<
    string,
    { id: string; name: string; input: Record<string, unknown>; inputText: string }
  >();
  private toolUseOrder: string[] = [];
  private contextUsagePercentage = 0;

  constructor(model: string) {
    this.responseId = `msg_${Date.now()}`;
    this.model = model;
  }

  get id(): string {
    return this.responseId;
  }

  /**
   * Process a Kiro streaming event and accumulate content
   */
  processStreamEvent(event: KiroStreamEvent): void {
    // Handle assistant response (text content)
    if (event.assistantResponseEvent?.content) {
      this.currentTextBlock += event.assistantResponseEvent.content;
    }

    // Handle code event
    if (event.codeEvent?.content) {
      this.currentTextBlock += event.codeEvent.content;
    }

    // Handle reasoning/thinking event
    if (event.reasoningContentEvent?.content) {
      this.currentThinkingBlock += event.reasoningContentEvent.content;
    }

    if (event.toolUseEvent) {
      this.processToolUseEvent(event.toolUseEvent);
    }

    // Handle usage metadata
    if (event.messageMetadataEvent?.usage) {
      this.usage = {
        input_tokens: event.messageMetadataEvent.usage.inputTokens || 0,
        output_tokens: event.messageMetadataEvent.usage.outputTokens || 0,
      };
    }

    if (event.metricsEvent) {
      this.usage = {
        input_tokens: event.metricsEvent.inputTokens || this.usage.input_tokens || 0,
        output_tokens: event.metricsEvent.outputTokens || this.usage.output_tokens || 0,
      };
    }
  }

  processEventFrame(eventType: string, payload: Record<string, any> | null): void {
    if (!payload) return;
    const eventPayload = payload[eventType] || payload;

    if (eventType === 'assistantResponseEvent') {
      this.processStreamEvent({ assistantResponseEvent: eventPayload as any });
    } else if (eventType === 'codeEvent') {
      this.processStreamEvent({ codeEvent: eventPayload as any });
    } else if (eventType === 'reasoningContentEvent') {
      this.processStreamEvent({ reasoningContentEvent: eventPayload as any });
    } else if (eventType === 'toolUseEvent') {
      const toolPayload = eventPayload.toolUseEvent || eventPayload.toolUses || eventPayload;
      const toolUses = Array.isArray(toolPayload) ? toolPayload : [toolPayload];
      for (const toolUse of toolUses) {
        this.processStreamEvent({ toolUseEvent: toolUse as any });
      }
    } else if (eventType === 'messageMetadataEvent') {
      this.processStreamEvent({ messageMetadataEvent: eventPayload as any });
    } else if (eventType === 'metricsEvent') {
      const metrics = eventPayload.metricsEvent || eventPayload;
      this.processStreamEvent({ metricsEvent: metrics as any });
    } else if (eventType === 'contextUsageEvent') {
      const contextUsage = eventPayload.contextUsageEvent || eventPayload;
      if (typeof contextUsage.contextUsagePercentage === 'number') {
        this.contextUsagePercentage = contextUsage.contextUsagePercentage;
      }
    }
  }

  /**
   * Finalize and return complete Anthropic response
   */
  finalize(): AnthropicResponse {
    const content: any[] = [];

    // Add thinking block if present (extended thinking)
    if (this.currentThinkingBlock) {
      content.push({
        type: 'thinking',
        thinking: this.currentThinkingBlock,
      });
    }

    // Add text block
    if (this.currentTextBlock) {
      content.push({
        type: 'text',
        text: this.currentTextBlock,
      });
    }

    for (const toolUseId of this.toolUseOrder) {
      const toolUse = this.toolUses.get(toolUseId);
      if (!toolUse) continue;
      content.push({
        type: 'tool_use',
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
      });
    }

    // If no content, add empty text block
    if (content.length === 0) {
      content.push({
        type: 'text',
        text: '',
      });
    }

    const usage = this.finalUsage();

    return {
      id: this.responseId,
      type: 'message',
      role: 'assistant',
      content,
      model: this.model,
      stop_reason: this.toolUses.size > 0 ? 'tool_use' : 'end_turn',
      stop_sequence: undefined,
      usage,
    };
  }

  private processToolUseEvent(toolUseEvent: {
    toolUseId?: string;
    name?: string;
    input?: unknown;
  }): void {
    const id = toolUseEvent.toolUseId || `toolu_${Date.now()}_${this.toolUses.size}`;
    let toolUse = this.toolUses.get(id);

    if (!toolUse) {
      toolUse = {
        id,
        name: toolUseEvent.name || '',
        input: {},
        inputText: '',
      };
      this.toolUses.set(id, toolUse);
      this.toolUseOrder.push(id);
    }

    if (toolUseEvent.name) {
      toolUse.name = toolUseEvent.name;
    }

    if (typeof toolUseEvent.input === 'string') {
      toolUse.inputText += toolUseEvent.input;
      toolUse.input = this.normalizeToolInput(toolUse.inputText);
    } else if (toolUseEvent.input && typeof toolUseEvent.input === 'object') {
      toolUse.input = this.normalizeToolInput(toolUseEvent.input);
    }
  }

  private finalUsage(): { input_tokens: number; output_tokens: number } {
    const outputEstimate =
      this.currentTextBlock || this.currentThinkingBlock
        ? Math.max(
            1,
            Math.ceil((this.currentTextBlock.length + this.currentThinkingBlock.length) / 4)
          )
        : 0;
    const inputEstimate =
      this.contextUsagePercentage > 0
        ? Math.max(1, Math.floor((this.contextUsagePercentage / 100) * 200000))
        : 0;

    return {
      input_tokens: this.usage.input_tokens || inputEstimate,
      output_tokens: this.usage.output_tokens || outputEstimate,
    };
  }

  private normalizeToolInput(input: unknown): Record<string, unknown> {
    if (!input) return {};
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  }

  /**
   * Parse Kiro SSE event string
   */
  static parseSSEEvent(chunk: string): KiroStreamEvent | null {
    const lines = chunk.split('\n');
    let eventType = '';
    let eventData = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith(':event-type:')) {
        eventType = line.slice(12).trim();
      } else if (line.startsWith('data:')) {
        eventData = line.slice(5).trim();
      } else if (line.trim() && !line.startsWith(':')) {
        eventData = line.trim();
      }
    }

    if (!eventData) return null;

    try {
      const data = JSON.parse(eventData);

      // Map event type to event object
      if (eventType === 'assistantResponseEvent' || data.assistantResponseEvent) {
        return {
          assistantResponseEvent: data.assistantResponseEvent || data,
        };
      } else if (eventType === 'codeEvent' || data.codeEvent) {
        return {
          codeEvent: data.codeEvent || data,
        };
      } else if (eventType === 'reasoningContentEvent' || data.reasoningContentEvent) {
        return {
          reasoningContentEvent: data.reasoningContentEvent || data,
        };
      } else if (eventType === 'supplementaryWebLinksEvent' || data.supplementaryWebLinksEvent) {
        return {
          supplementaryWebLinksEvent: data.supplementaryWebLinksEvent || data,
        };
      } else if (eventType === 'messageMetadataEvent' || data.messageMetadataEvent) {
        return {
          messageMetadataEvent: data.messageMetadataEvent || data,
        };
      }

      return null;
    } catch {
      return null;
    }
  }
}
