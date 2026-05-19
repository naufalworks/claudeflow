import { randomUUID } from 'crypto';
import type { AnthropicRequest } from '../types/anthropic.types';

type KiroToolContext = {
  tools?: unknown[];
  toolResults?: unknown[];
};

type KiroUserMessage = {
  userInputMessage: {
    content: string;
    modelId: string;
    origin?: 'AI_EDITOR';
    images?: Array<{ format: string; source: { bytes: string } }>;
    userInputMessageContext?: KiroToolContext;
  };
};

type KiroAssistantMessage = {
  assistantResponseMessage: {
    content: string;
    toolUses?: unknown[];
  };
};

type KiroHistoryMessage = KiroUserMessage | KiroAssistantMessage;

export interface KiroRequest {
  conversationState: {
    chatTriggerType: 'MANUAL';
    conversationId: string;
    currentMessage: KiroUserMessage;
    history: KiroHistoryMessage[];
  };
  profileArn?: string;
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
}

export class AnthropicToKiroTransformer {
  transform(request: AnthropicRequest, profileArn?: string): KiroRequest {
    const modelId = this.resolveKiroModelId(request.model);
    const systemContent = this.systemToText(request.system);
    const { currentMessage, history } = this.convertMessages(
      request.messages,
      systemContent,
      request.tools || [],
      modelId
    );

    currentMessage.userInputMessage.origin = 'AI_EDITOR';
    currentMessage.userInputMessage.content = this.withRuntimeContext(
      currentMessage.userInputMessage.content
    );

    const kiroRequest: KiroRequest = {
      conversationState: {
        chatTriggerType: 'MANUAL',
        conversationId: randomUUID(),
        currentMessage,
        history,
      },
    };

    if (profileArn && !this.isSyntheticProfileArn(profileArn)) {
      kiroRequest.profileArn = profileArn;
    }

    if (request.max_tokens || request.temperature !== undefined || request.top_p !== undefined) {
      kiroRequest.inferenceConfig = {};
      if (request.max_tokens) kiroRequest.inferenceConfig.maxTokens = request.max_tokens;
      if (request.temperature !== undefined) {
        kiroRequest.inferenceConfig.temperature = request.temperature;
      }
      if (request.top_p !== undefined) kiroRequest.inferenceConfig.topP = request.top_p;
    }

    return kiroRequest;
  }

  private convertMessages(
    messages: AnthropicRequest['messages'],
    systemContent: string,
    tools: unknown[],
    modelId: string
  ): { currentMessage: KiroUserMessage; history: KiroHistoryMessage[] } {
    const history: KiroHistoryMessage[] = [];
    let currentRole: 'user' | 'assistant' | null = systemContent ? 'user' : null;
    let userTextParts: string[] = systemContent ? [systemContent] : [];
    let userToolResults: unknown[] = [];
    let userImages: Array<{ format: string; source: { bytes: string } }> = [];
    let assistantTextParts: string[] = [];
    let assistantToolUses: unknown[] = [];

    const flush = (): void => {
      if (currentRole === 'user') {
        history.push(this.buildUserMessage(userTextParts, userToolResults, userImages, modelId));
        userTextParts = [];
        userToolResults = [];
        userImages = [];
      } else if (currentRole === 'assistant') {
        const content = assistantTextParts.join('\n\n').trim();
        if (content || assistantToolUses.length > 0) {
          const assistantMessage: KiroAssistantMessage = {
            assistantResponseMessage: {
              content,
            },
          };
          if (assistantToolUses.length > 0) {
            assistantMessage.assistantResponseMessage.toolUses = assistantToolUses;
          }
          history.push(assistantMessage);
        }
        assistantTextParts = [];
        assistantToolUses = [];
      }
    };

    for (const message of messages) {
      if (message.role === 'user') {
        if (currentRole !== 'user') {
          flush();
          currentRole = 'user';
        }
        const extracted = this.extractUserContent(message.content);
        userTextParts.push(...extracted.textParts);
        userToolResults.push(...extracted.toolResults);
        userImages.push(...extracted.images);
      } else if (message.role === 'assistant') {
        if (currentRole !== 'assistant') {
          flush();
          currentRole = 'assistant';
        }
        const extracted = this.extractAssistantContent(message.content);
        assistantTextParts.push(...extracted.textParts);
        assistantToolUses.push(...extracted.toolUses);
      }
    }

    flush();

    let currentMessage: KiroUserMessage | undefined;
    for (let index = history.length - 1; index >= 0; index--) {
      if ('userInputMessage' in history[index]) {
        currentMessage = history.splice(index, 1)[0] as KiroUserMessage;
        break;
      }
    }

    if (!currentMessage) {
      currentMessage = this.buildUserMessage(['continue'], [], [], modelId);
    }

    const convertedTools = this.convertTools(tools);
    if (convertedTools.length > 0) {
      currentMessage.userInputMessage.userInputMessageContext = {
        ...currentMessage.userInputMessage.userInputMessageContext,
        tools: convertedTools,
      };
    }

    return {
      currentMessage,
      history: this.mergeConsecutiveUserMessages(history),
    };
  }

  private buildUserMessage(
    textParts: string[],
    toolResults: unknown[],
    images: Array<{ format: string; source: { bytes: string } }>,
    modelId: string
  ): KiroUserMessage {
    const message: KiroUserMessage = {
      userInputMessage: {
        content:
          textParts.join('\n\n').trim() || (toolResults.length > 0 ? 'Tool results' : 'continue'),
        modelId,
      },
    };

    if (images.length > 0) {
      message.userInputMessage.images = images;
    }

    if (toolResults.length > 0) {
      message.userInputMessage.userInputMessageContext = {
        toolResults,
      };
    }

    return message;
  }

  private extractUserContent(content: unknown): {
    textParts: string[];
    toolResults: unknown[];
    images: Array<{ format: string; source: { bytes: string } }>;
  } {
    const textParts: string[] = [];
    const toolResults: unknown[] = [];
    const images: Array<{ format: string; source: { bytes: string } }> = [];

    if (typeof content === 'string') {
      textParts.push(content);
      return { textParts, toolResults, images };
    }

    if (!Array.isArray(content)) {
      return { textParts, toolResults, images };
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const typedBlock = block as Record<string, any>;

      if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
        textParts.push(typedBlock.text);
      } else if (typedBlock.type === 'tool_result') {
        toolResults.push({
          toolUseId: typedBlock.tool_use_id,
          status: typedBlock.is_error ? 'error' : 'success',
          content: [{ text: this.contentToText(typedBlock.content) }],
        });
      } else if (typedBlock.type === 'image') {
        const image = this.convertImageBlock(typedBlock);
        if (image) images.push(image);
      }
    }

    return { textParts, toolResults, images };
  }

  private extractAssistantContent(content: unknown): {
    textParts: string[];
    toolUses: unknown[];
  } {
    const textParts: string[] = [];
    const toolUses: unknown[] = [];

    if (typeof content === 'string') {
      textParts.push(content);
      return { textParts, toolUses };
    }

    if (!Array.isArray(content)) {
      return { textParts, toolUses };
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const typedBlock = block as Record<string, any>;

      if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
        textParts.push(typedBlock.text);
      } else if (typedBlock.type === 'tool_use') {
        toolUses.push({
          toolUseId: typedBlock.id || randomUUID(),
          name: typedBlock.name || '',
          input: this.normalizeObject(typedBlock.input),
        });
      }
    }

    return { textParts, toolUses };
  }

  private convertTools(tools: unknown[]): unknown[] {
    return tools
      .filter((tool): tool is Record<string, any> => !!tool && typeof tool === 'object')
      .map((tool) => {
        const schema = this.normalizeSchema(tool.input_schema);
        return {
          toolSpecification: {
            name: tool.name,
            description: tool.description || `Tool: ${tool.name}`,
            inputSchema: {
              json: schema,
            },
          },
        };
      });
  }

  private convertImageBlock(
    block: Record<string, any>
  ): { format: string; source: { bytes: string } } | null {
    const source = block.source;
    if (!source || typeof source !== 'object' || source.type !== 'base64' || !source.data) {
      return null;
    }

    const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png';
    return {
      format: mediaType.split('/')[1] || mediaType,
      source: {
        bytes: source.data,
      },
    };
  }

  private mergeConsecutiveUserMessages(history: KiroHistoryMessage[]): KiroHistoryMessage[] {
    const merged: KiroHistoryMessage[] = [];

    for (const item of history) {
      const previous = merged[merged.length - 1];
      if (previous && 'userInputMessage' in previous && 'userInputMessage' in item) {
        previous.userInputMessage.content += `\n\n${item.userInputMessage.content}`;
        if (item.userInputMessage.images) {
          previous.userInputMessage.images = [
            ...(previous.userInputMessage.images || []),
            ...item.userInputMessage.images,
          ];
        }
        if (item.userInputMessage.userInputMessageContext?.toolResults) {
          previous.userInputMessage.userInputMessageContext = {
            ...previous.userInputMessage.userInputMessageContext,
            toolResults: [
              ...(previous.userInputMessage.userInputMessageContext?.toolResults || []),
              ...item.userInputMessage.userInputMessageContext.toolResults,
            ],
          };
        }
      } else {
        merged.push(item);
      }
    }

    return merged;
  }

  private systemToText(system: AnthropicRequest['system']): string {
    if (!system) return '';
    if (typeof system === 'string') return system;
    if (!Array.isArray(system)) return '';

    return system
      .map((block) => {
        if (block && typeof block === 'object' && 'text' in block) {
          return String(block.text || '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  private contentToText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (item && typeof item === 'object' && 'text' in item) {
            return String((item as { text?: unknown }).text || '');
          }
          return typeof item === 'string' ? item : JSON.stringify(item);
        })
        .filter(Boolean)
        .join('\n');
    }
    if (content === undefined || content === null) return '';
    return JSON.stringify(content);
  }

  private normalizeSchema(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { type: 'object', properties: {}, required: [] };
    }

    const normalized = { ...(schema as Record<string, unknown>) };
    if (!Array.isArray(normalized.required)) {
      normalized.required = [];
    }
    if (!normalized.type) {
      normalized.type = 'object';
    }
    if (!normalized.properties) {
      normalized.properties = {};
    }
    return normalized;
  }

  private normalizeObject(input: unknown): Record<string, unknown> {
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

  private withRuntimeContext(content: string): string {
    return `[Context: Current time is ${new Date().toISOString()}]\n\n${content || 'continue'}`;
  }

  private resolveKiroModelId(model: string): string {
    if (!model || model === 'auto') return 'auto';
    if (model === 'claude-sonnet-4.5' || model === 'claude-sonnet-4') return model;
    if (model === 'claude-haiku-4.5') return model;
    if (/haiku/i.test(model)) return 'claude-haiku-4.5';
    if (/sonnet/i.test(model)) return 'claude-sonnet-4.5';
    return model;
  }

  private isSyntheticProfileArn(profileArn: string): boolean {
    return /^arn:aws:codewhisperer:[a-z0-9-]+:000000000000:profile\//.test(profileArn);
  }
}
