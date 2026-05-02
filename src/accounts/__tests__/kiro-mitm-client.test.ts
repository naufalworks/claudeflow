/**
 * KiroMitmClient Integration Tests
 * 
 * Tests MITM router communication and native Anthropic format preservation.
 */

import { KiroMitmClient, KiroMitmError } from '../kiro-mitm-client';
import type { KiroMitmRequestConfig } from '../kiro-mitm-client';
import type { AnthropicRequest, AnthropicResponse } from '../../types/anthropic.types';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('KiroMitmClient', () => {
  let client: KiroMitmClient;

  beforeEach(() => {
    client = new KiroMitmClient();
    jest.clearAllMocks();

    // Setup axios.isAxiosError mock
    (axios.isAxiosError as unknown as jest.Mock) = jest.fn((error: any) => {
      return error && error.isAxiosError === true;
    });
  });

  // ============================================================================
  // Request Sending Tests
  // ============================================================================

  describe('Request Sending', () => {
    it('should send request to MITM router with correct headers', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'Hello, Claude!',
          },
        ],
      };

      const config: KiroMitmRequestConfig = {
        machineId: '3dee6bbab4fd4a736dad0528dee5bfcd59dc9ad5aac55ad621643ca74a822ac5',
        sessionToken: 'session-token-123',
        apiKey: 'sk-ant-api03-test',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const mockResponse: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Hello! How can I help you?',
          },
        ],
        model: 'claude-opus-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 15,
        },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({ data: mockResponse }),
      } as any);

      client = new KiroMitmClient();

      const response = await client.sendRequest(request, config);

      expect(response).toEqual(mockResponse);

      const axiosInstance = mockedAxios.create.mock.results[0].value;
      expect(axiosInstance.post).toHaveBeenCalledWith(
        `${config.mitmRouterUrl}/v1/messages`,
        request,
        {
          headers: {
            'x-machine-id': config.machineId,
            'x-session-token': config.sessionToken,
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          },
        }
      );
    });

    it('should preserve native Anthropic format in request', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'Test message',
          },
        ],
        thinking: {
          type: 'enabled',
          budget_tokens: 5000,
        },
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather information',
            input_schema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        ],
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const mockResponse: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-opus-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({ data: mockResponse }),
      } as any);

      client = new KiroMitmClient();

      await client.sendRequest(request, config);

      const axiosInstance = mockedAxios.create.mock.results[0].value;
      const sentRequest = axiosInstance.post.mock.calls[0][1];

      // Verify native Anthropic format preserved
      expect(sentRequest.thinking).toEqual(request.thinking);
      expect(sentRequest.tools).toEqual(request.tools);
      expect(sentRequest.model).toBe(request.model);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle 401 session expired error', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test' }],
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 401,
          statusText: 'Unauthorized',
        },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(axiosError),
      } as any);

      client = new KiroMitmClient();

      await expect(client.sendRequest(request, config)).rejects.toThrow(
        KiroMitmError
      );

      try {
        await client.sendRequest(request, config);
      } catch (error) {
        expect(error).toBeInstanceOf(KiroMitmError);
        expect((error as KiroMitmError).statusCode).toBe(401);
        expect((error as KiroMitmError).isSessionExpired).toBe(true);
      }
    });

    it('should handle 429 rate limit error', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test' }],
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 429,
          statusText: 'Too Many Requests',
        },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(axiosError),
      } as any);

      client = new KiroMitmClient();

      await expect(client.sendRequest(request, config)).rejects.toThrow(
        'Rate limit exceeded'
      );
    });

    it('should handle 503 service unavailable error', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test' }],
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 503,
          statusText: 'Service Unavailable',
        },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(axiosError),
      } as any);

      client = new KiroMitmClient();

      await expect(client.sendRequest(request, config)).rejects.toThrow(
        'MITM router unavailable'
      );
    });

    it('should handle 400 bad request error', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test' }],
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'Invalid model' },
        },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(axiosError),
      } as any);

      client = new KiroMitmClient();

      await expect(client.sendRequest(request, config)).rejects.toThrow(
        'Invalid request'
      );
    });

    it('should handle network errors', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test' }],
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const axiosError = {
        isAxiosError: true,
        message: 'Network Error',
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(axiosError),
      } as any);

      client = new KiroMitmClient();

      await expect(client.sendRequest(request, config)).rejects.toThrow(
        'Network error'
      );
    });
  });

  // ============================================================================
  // Streaming Tests
  // ============================================================================

  describe('Streaming', () => {
    it('should handle streaming requests', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test' }],
        stream: true,
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const mockStreamData = [
        Buffer.from('event: message_start\ndata: {"type":"message_start"}\n\n'),
        Buffer.from('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n'),
        Buffer.from('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStreamData) {
            yield chunk;
          }
        },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({ data: mockStream }),
      } as any);

      client = new KiroMitmClient();

      const chunks: string[] = [];
      for await (const chunk of client.sendStreamingRequest(request, config)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toContain('message_start');
      expect(chunks[1]).toContain('content_block_delta');
      expect(chunks[2]).toContain('message_stop');
    });

    it('should preserve native Anthropic streaming format', async () => {
      const request: AnthropicRequest = {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Test' }],
        stream: true,
      };

      const config: KiroMitmRequestConfig = {
        machineId: 'machine-123',
        apiKey: 'key-123',
        mitmRouterUrl: 'http://3.68.219.151:20128',
      };

      const mockStreamData = [
        Buffer.from('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"model":"claude-opus-4-20250514"}}\n\n'),
      ];

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of mockStreamData) {
            yield chunk;
          }
        },
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockResolvedValue({ data: mockStream }),
      } as any);

      client = new KiroMitmClient();

      const chunks: string[] = [];
      for await (const chunk of client.sendStreamingRequest(request, config)) {
        chunks.push(chunk);
      }

      // Verify native Anthropic SSE format preserved
      expect(chunks[0]).toContain('event: message_start');
      expect(chunks[0]).toContain('"type":"message_start"');
      expect(chunks[0]).toContain('"model":"claude-opus-4-20250514"');
    });
  });

  // ============================================================================
  // Connection Tests
  // ============================================================================

  describe('Connection Tests', () => {
    it('should test connection successfully', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ status: 200 }),
      } as any);

      client = new KiroMitmClient();

      const result = await client.testConnection('http://3.68.219.151:20128');

      expect(result).toBe(true);
    });

    it('should return false on connection failure', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Connection failed')),
      } as any);

      client = new KiroMitmClient();

      const result = await client.testConnection('http://3.68.219.151:20128');

      expect(result).toBe(false);
    });

    it('should get MITM router version', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ data: { version: '1.0.0' } }),
      } as any);

      client = new KiroMitmClient();

      const version = await client.getVersion('http://3.68.219.151:20128');

      expect(version).toBe('1.0.0');
    });

    it('should return null when version endpoint fails', async () => {
      mockedAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Not found')),
      } as any);

      client = new KiroMitmClient();

      const version = await client.getVersion('http://3.68.219.151:20128');

      expect(version).toBeNull();
    });
  });
});
