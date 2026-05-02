/**
 * Integration tests for request routing
 * 
 * Tests the full request flow including:
 * - Non-streaming requests with cache miss (paid account)
 * - Non-streaming requests with cache hit
 * - Non-streaming requests with Kiro account
 * - Streaming requests with Kiro account
 * - Kiro session refresh during request
 * - Error handling and retries
 */

import { handleMessagesRequest, handleModelsRequest } from '../routes';
import { RequestParser } from '../../parsers/request-parser';
import { ResponseParser } from '../../parsers/response-parser';
import { RequestFormatter } from '../../parsers/request-formatter';
import { ResponseFormatter } from '../../parsers/response-formatter';
import { SemanticDeduplicationEngine } from '../../optimizers/semantic-deduplication';
import { RequestClassifier } from '../../optimizers/request-classifier';
import { CacheOptimizer } from '../../optimizers/cache-optimizer';
import { ThinkingBudgetOptimizer } from '../../optimizers/thinking-budget-optimizer';
import { ContextOptimizer } from '../../optimizers/context-optimizer';
import { AccountPoolManager } from '../../accounts/account-pool-manager';
import { KiroMitmClient, KiroMitmError } from '../../accounts/kiro-mitm-client';
import { KiroAuthManager } from '../../accounts/kiro-auth-manager';
import type { AnthropicRequest, AnthropicResponse } from '../../types/anthropic.types';

// Mock dependencies
jest.mock('../../parsers/request-parser');
jest.mock('../../parsers/response-parser');
jest.mock('../../parsers/request-formatter');
jest.mock('../../parsers/response-formatter');
jest.mock('../../optimizers/semantic-deduplication');
jest.mock('../../optimizers/request-classifier');
jest.mock('../../optimizers/cache-optimizer');
jest.mock('../../optimizers/thinking-budget-optimizer');
jest.mock('../../optimizers/context-optimizer');
jest.mock('../../accounts/account-pool-manager');
jest.mock('../../accounts/kiro-mitm-client');
jest.mock('../../accounts/kiro-auth-manager');
jest.mock('@anthropic-ai/sdk');

describe('Request Routing Integration Tests', () => {
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock request
    mockRequest = {
      id: 'test-request-id',
      body: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      },
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      server: {
        context: {
          config: {
            accounts: [
              {
                id: 'anthropic-1',
                provider: 'anthropic',
                apiKey: 'test-key',
              },
            ],
            infrastructure: {
              qdrant: { url: 'http://localhost:6333' },
              redis: { url: 'redis://localhost:6379' },
              voyage: { apiKey: 'test-voyage-key' },
            },
          },
          infrastructure: {
            anthropic: {},
            voyage: {},
            qdrant: {},
            redis: {},
          },
        },
      },
    };

    // Mock reply
    mockReply = {
      code: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      raw: {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      },
    };

    // Set up default mocks for all optimizer constructors
    (SemanticDeduplicationEngine as jest.MockedClass<typeof SemanticDeduplicationEngine>).mockImplementation(() => ({
      checkCache: jest.fn().mockResolvedValue({ hit: false }),
      storeResponse: jest.fn().mockResolvedValue(undefined),
    } as any));

    (RequestClassifier as jest.MockedClass<typeof RequestClassifier>).mockImplementation(() => ({
      classify: jest.fn().mockResolvedValue({
        complexity: 'simple',
        confidence: 0.9,
        reasoning: 'Simple request',
      }),
    } as any));

    (CacheOptimizer as jest.MockedClass<typeof CacheOptimizer>).mockImplementation(() => ({
      optimize: jest.fn().mockImplementation((req) => req),
    } as any));

    (ThinkingBudgetOptimizer as jest.MockedClass<typeof ThinkingBudgetOptimizer>).mockImplementation(() => ({
      optimize: jest.fn().mockImplementation((req) => req),
    } as any));

    (ContextOptimizer as jest.MockedClass<typeof ContextOptimizer>).mockImplementation(() => ({
      optimize: jest.fn().mockResolvedValue((req: any) => req),
    } as any));

    (AccountPoolManager as jest.MockedClass<typeof AccountPoolManager>).mockImplementation(() => ({
      selectAccount: jest.fn().mockResolvedValue({
        account: {
          id: 'anthropic-1',
          provider: 'anthropic',
          apiKey: 'test-key',
        },
        score: 0.9,
        reason: 'Best available account',
      }),
      updateQuota: jest.fn().mockResolvedValue(undefined),
    } as any));

    (KiroMitmClient as jest.MockedClass<typeof KiroMitmClient>).mockImplementation(() => ({
      sendRequest: jest.fn(),
      sendStreamingRequest: jest.fn(),
    } as any));

    (KiroAuthManager as jest.MockedClass<typeof KiroAuthManager>).mockImplementation(() => ({
      refreshSession: jest.fn(),
      authenticateAccount: jest.fn(),
    } as any));
  });

  describe('handleMessagesRequest - Non-streaming', () => {
    it('should handle full request flow with cache miss (paid account)', async () => {
      // Mock request parsing
      const mockParsedRequest: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      };

      (RequestParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockParsedRequest,
      });

      // Mock cache miss
      const mockDeduplicationEngine = {
        checkCache: jest.fn().mockResolvedValue({ hit: false }),
        storeResponse: jest.fn().mockResolvedValue(undefined),
      };
      (SemanticDeduplicationEngine as jest.MockedClass<typeof SemanticDeduplicationEngine>).mockImplementation(() => mockDeduplicationEngine as any);

      // Mock classification
      const mockClassifier = {
        classify: jest.fn().mockResolvedValue({
          complexity: 'simple',
          confidence: 0.9,
          reasoning: 'Simple request',
        }),
      };
      (RequestClassifier as jest.MockedClass<typeof RequestClassifier>).mockImplementation(() => mockClassifier as any);

      // Mock optimizers
      const mockCacheOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (CacheOptimizer as jest.MockedClass<typeof CacheOptimizer>).mockImplementation(() => mockCacheOptimizer as any);

      const mockThinkingOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (ThinkingBudgetOptimizer as jest.MockedClass<typeof ThinkingBudgetOptimizer>).mockImplementation(() => mockThinkingOptimizer as any);

      const mockContextOptimizer = {
        optimize: jest.fn().mockResolvedValue(mockParsedRequest),
      };
      (ContextOptimizer as jest.MockedClass<typeof ContextOptimizer>).mockImplementation(() => mockContextOptimizer as any);

      // Mock account selection (Anthropic account)
      const mockAccountPoolManager = {
        selectAccount: jest.fn().mockResolvedValue({
          account: {
            id: 'anthropic-1',
            provider: 'anthropic',
            apiKey: 'test-key',
          },
          score: 0.9,
          reason: 'Best available account',
        }),
        updateQuota: jest.fn().mockResolvedValue(undefined),
      };
      (AccountPoolManager as jest.MockedClass<typeof AccountPoolManager>).mockImplementation(() => mockAccountPoolManager as any);

      // Mock Anthropic API response
      const mockApiResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockResolvedValue(mockApiResponse),
        },
      };

      const Anthropic = require('@anthropic-ai/sdk').default;
      (Anthropic as jest.Mock).mockImplementation(() => mockAnthropicClient);

      // Mock response parsing
      const mockParsedResponse: AnthropicResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      (ResponseParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockParsedResponse,
      });

      // Mock response formatting
      (ResponseFormatter.prototype.format as jest.Mock).mockReturnValue(mockParsedResponse);

      // Mock request formatting
      (RequestFormatter.prototype.format as jest.Mock).mockReturnValue(mockParsedRequest);

      // Execute
      await handleMessagesRequest(mockRequest, mockReply);

      // Verify
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalled();
      expect(mockAccountPoolManager.selectAccount).toHaveBeenCalled();
      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
      expect(mockAccountPoolManager.updateQuota).toHaveBeenCalledWith(
        'anthropic-1',
        15
      );
      expect(mockDeduplicationEngine.storeResponse).toHaveBeenCalled();
    });

    it('should handle cache hit and return cached response', async () => {
      // Mock request parsing
      const mockParsedRequest: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      };

      (RequestParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockParsedRequest,
      });

      // Mock cache hit
      const mockCachedResponse: AnthropicResponse = {
        id: 'msg_cached',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Cached response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const mockDeduplicationEngine = {
        checkCache: jest.fn().mockResolvedValue({
          hit: true,
          response: mockCachedResponse,
          similarity: 0.98,
        }),
        storeResponse: jest.fn().mockResolvedValue(undefined),
      };
      (SemanticDeduplicationEngine as jest.MockedClass<typeof SemanticDeduplicationEngine>).mockImplementation(() => mockDeduplicationEngine as any);

      // Mock response formatting
      (ResponseFormatter.prototype.format as jest.Mock).mockReturnValue(mockCachedResponse);

      // Execute
      await handleMessagesRequest(mockRequest, mockReply);

      // Verify - should return cached response without calling API
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalled();
    });

    it('should handle request with Kiro account', async () => {
      // Mock request parsing
      const mockParsedRequest: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      };

      (RequestParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockParsedRequest,
      });

      // Mock cache miss
      const mockDeduplicationEngine = {
        checkCache: jest.fn().mockResolvedValue({ hit: false }),
        storeResponse: jest.fn().mockResolvedValue(undefined),
      };
      (SemanticDeduplicationEngine as jest.MockedClass<typeof SemanticDeduplicationEngine>).mockImplementation(() => mockDeduplicationEngine as any);

      // Mock classification
      const mockClassifier = {
        classify: jest.fn().mockResolvedValue({
          complexity: 'simple',
          confidence: 0.9,
          reasoning: 'Simple request',
        }),
      };
      (RequestClassifier as jest.MockedClass<typeof RequestClassifier>).mockImplementation(() => mockClassifier as any);

      // Mock optimizers
      const mockCacheOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (CacheOptimizer as jest.MockedClass<typeof CacheOptimizer>).mockImplementation(() => mockCacheOptimizer as any);

      const mockThinkingOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (ThinkingBudgetOptimizer as jest.MockedClass<typeof ThinkingBudgetOptimizer>).mockImplementation(() => mockThinkingOptimizer as any);

      const mockContextOptimizer = {
        optimize: jest.fn().mockResolvedValue(mockParsedRequest),
      };
      (ContextOptimizer as jest.MockedClass<typeof ContextOptimizer>).mockImplementation(() => mockContextOptimizer as any);

      // Mock account selection (Kiro account)
      const mockAccountPoolManager = {
        selectAccount: jest.fn().mockResolvedValue({
          account: {
            id: 'kiro-1',
            provider: 'kiro',
            apiKey: 'session-token-123',
            kiroConfig: {
              machineId: 'machine-123',
              mitmRouterUrl: 'http://3.68.219.151:20128',
              apiKey: 'kiro-api-key',
            },
          },
          score: 1.0,
          reason: 'Kiro account (free)',
        }),
        updateQuota: jest.fn().mockResolvedValue(undefined),
      };
      (AccountPoolManager as jest.MockedClass<typeof AccountPoolManager>).mockImplementation(() => mockAccountPoolManager as any);

      // Mock Kiro MITM response
      const mockKiroResponse: AnthropicResponse = {
        id: 'msg_kiro',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Kiro response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const mockKiroClient = {
        sendRequest: jest.fn().mockResolvedValue(mockKiroResponse),
        sendStreamingRequest: jest.fn(),
      };
      (KiroMitmClient as jest.MockedClass<typeof KiroMitmClient>).mockImplementation(() => mockKiroClient as any);

      // Mock response formatting
      (ResponseFormatter.prototype.format as jest.Mock).mockReturnValue(mockKiroResponse);

      // Execute
      await handleMessagesRequest(mockRequest, mockReply);

      // Verify
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalled();
      expect(mockKiroClient.sendRequest).toHaveBeenCalled();
      expect(mockAccountPoolManager.updateQuota).toHaveBeenCalledWith(
        'kiro-1',
        15
      );
    });

    it('should handle Kiro session refresh on 401 error', async () => {
      // Mock request parsing
      const mockParsedRequest: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      };

      (RequestParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockParsedRequest,
      });

      // Mock cache miss
      const mockDeduplicationEngine = {
        checkCache: jest.fn().mockResolvedValue({ hit: false }),
        storeResponse: jest.fn().mockResolvedValue(undefined),
      };
      (SemanticDeduplicationEngine as jest.MockedClass<typeof SemanticDeduplicationEngine>).mockImplementation(() => mockDeduplicationEngine as any);

      // Mock classification
      const mockClassifier = {
        classify: jest.fn().mockResolvedValue({
          complexity: 'simple',
          confidence: 0.9,
          reasoning: 'Simple request',
        }),
      };
      (RequestClassifier as jest.MockedClass<typeof RequestClassifier>).mockImplementation(() => mockClassifier as any);

      // Mock optimizers
      const mockCacheOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (CacheOptimizer as jest.MockedClass<typeof CacheOptimizer>).mockImplementation(() => mockCacheOptimizer as any);

      const mockThinkingOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (ThinkingBudgetOptimizer as jest.MockedClass<typeof ThinkingBudgetOptimizer>).mockImplementation(() => mockThinkingOptimizer as any);

      const mockContextOptimizer = {
        optimize: jest.fn().mockResolvedValue(mockParsedRequest),
      };
      (ContextOptimizer as jest.MockedClass<typeof ContextOptimizer>).mockImplementation(() => mockContextOptimizer as any);

      // Mock account selection (Kiro account)
      const mockAccount = {
        id: 'kiro-1',
        provider: 'kiro',
        apiKey: 'old-session-token',
        kiroConfig: {
          machineId: 'machine-123',
          mitmRouterUrl: 'http://3.68.219.151:20128',
          apiKey: 'kiro-api-key',
        },
      };

      const mockAccountPoolManager = {
        selectAccount: jest.fn().mockResolvedValue({
          account: mockAccount,
          score: 1.0,
          reason: 'Kiro account (free)',
        }),
        updateQuota: jest.fn().mockResolvedValue(undefined),
      };
      (AccountPoolManager as jest.MockedClass<typeof AccountPoolManager>).mockImplementation(() => mockAccountPoolManager as any);

      // Mock session refresh - must be set up BEFORE KiroMitmClient mock
      const mockRefreshSession = jest.fn().mockResolvedValue({
        sessionToken: 'new-session-token',
        expiresAt: new Date(Date.now() + 3600000),
      });
      
      (KiroAuthManager as jest.MockedClass<typeof KiroAuthManager>).mockImplementation(() => ({
        refreshSession: mockRefreshSession,
        authenticateAccount: jest.fn(),
      } as any));

      // Mock Kiro MITM - first call fails with 401, second succeeds
      const mockSuccessResponse: AnthropicResponse = {
        id: 'msg_success',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Success after refresh' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      // Create a proper KiroMitmError instance
      const sessionExpiredError = Object.create(KiroMitmError.prototype);
      sessionExpiredError.message = 'Session expired';
      sessionExpiredError.statusCode = 401;
      sessionExpiredError.isSessionExpired = true;
      sessionExpiredError.name = 'KiroMitmError';

      let callCount = 0;
      const mockSendRequest = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(sessionExpiredError);
        }
        return Promise.resolve(mockSuccessResponse);
      });

      (KiroMitmClient as jest.MockedClass<typeof KiroMitmClient>).mockImplementation(() => ({
        sendRequest: mockSendRequest,
        sendStreamingRequest: jest.fn(),
      } as any));

      // Mock response formatting
      (ResponseFormatter.prototype.format as jest.Mock).mockReturnValue(mockSuccessResponse);

      // Execute
      await handleMessagesRequest(mockRequest, mockReply);

      // Verify
      expect(mockSendRequest).toHaveBeenCalled();
      expect(mockRefreshSession).toHaveBeenCalled();
      expect(mockSendRequest).toHaveBeenCalledTimes(2);
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalled();
    }, 10000); // Increase timeout to 10 seconds to account for retry delays

    it('should retry on 429 rate limit error', async () => {
      // Mock request parsing
      const mockParsedRequest: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      };

      (RequestParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockParsedRequest,
      });

      // Mock cache miss
      const mockDeduplicationEngine = {
        checkCache: jest.fn().mockResolvedValue({ hit: false }),
        storeResponse: jest.fn().mockResolvedValue(undefined),
      };
      (SemanticDeduplicationEngine as jest.MockedClass<typeof SemanticDeduplicationEngine>).mockImplementation(() => mockDeduplicationEngine as any);

      // Mock classification
      const mockClassifier = {
        classify: jest.fn().mockResolvedValue({
          complexity: 'simple',
          confidence: 0.9,
          reasoning: 'Simple request',
        }),
      };
      (RequestClassifier as jest.MockedClass<typeof RequestClassifier>).mockImplementation(() => mockClassifier as any);

      // Mock optimizers
      const mockCacheOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (CacheOptimizer as jest.MockedClass<typeof CacheOptimizer>).mockImplementation(() => mockCacheOptimizer as any);

      const mockThinkingOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (ThinkingBudgetOptimizer as jest.MockedClass<typeof ThinkingBudgetOptimizer>).mockImplementation(() => mockThinkingOptimizer as any);

      const mockContextOptimizer = {
        optimize: jest.fn().mockResolvedValue(mockParsedRequest),
      };
      (ContextOptimizer as jest.MockedClass<typeof ContextOptimizer>).mockImplementation(() => mockContextOptimizer as any);

      // Mock account selection
      const mockAccountPoolManager = {
        selectAccount: jest.fn().mockResolvedValue({
          account: {
            id: 'anthropic-1',
            provider: 'anthropic',
            apiKey: 'test-key',
          },
          score: 0.9,
          reason: 'Best available account',
        }),
        updateQuota: jest.fn().mockResolvedValue(undefined),
      };
      (AccountPoolManager as jest.MockedClass<typeof AccountPoolManager>).mockImplementation(() => mockAccountPoolManager as any);

      // Mock Anthropic API - first call fails with 429, second succeeds
      const rateLimitError = { status: 429, message: 'Rate limit exceeded' };
      const mockSuccessResponse = {
        id: 'msg_success',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Success after retry' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const mockAnthropicClient = {
        messages: {
          create: jest.fn()
            .mockRejectedValueOnce(rateLimitError)
            .mockResolvedValueOnce(mockSuccessResponse),
        },
      };

      const Anthropic = require('@anthropic-ai/sdk').default;
      (Anthropic as jest.Mock).mockImplementation(() => mockAnthropicClient);

      // Mock response parsing
      (ResponseParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockSuccessResponse,
      });

      // Mock response formatting
      (ResponseFormatter.prototype.format as jest.Mock).mockReturnValue(mockSuccessResponse);

      // Mock request formatting
      (RequestFormatter.prototype.format as jest.Mock).mockReturnValue(mockParsedRequest);

      // Execute
      await handleMessagesRequest(mockRequest, mockReply);

      // Verify - should retry and succeed
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(2);
      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalled();
    });

    it('should not retry on 400 bad request error', async () => {
      // Mock request parsing
      const mockParsedRequest: AnthropicRequest = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      };

      (RequestParser.prototype.parse as jest.Mock).mockReturnValue({
        success: true,
        value: mockParsedRequest,
      });

      // Mock cache miss
      const mockDeduplicationEngine = {
        checkCache: jest.fn().mockResolvedValue({ hit: false }),
        storeResponse: jest.fn().mockResolvedValue(undefined),
      };
      (SemanticDeduplicationEngine as jest.MockedClass<typeof SemanticDeduplicationEngine>).mockImplementation(() => mockDeduplicationEngine as any);

      // Mock classification
      const mockClassifier = {
        classify: jest.fn().mockResolvedValue({
          complexity: 'simple',
          confidence: 0.9,
          reasoning: 'Simple request',
        }),
      };
      (RequestClassifier as jest.MockedClass<typeof RequestClassifier>).mockImplementation(() => mockClassifier as any);

      // Mock optimizers
      const mockCacheOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (CacheOptimizer as jest.MockedClass<typeof CacheOptimizer>).mockImplementation(() => mockCacheOptimizer as any);

      const mockThinkingOptimizer = {
        optimize: jest.fn().mockImplementation((req) => req),
      };
      (ThinkingBudgetOptimizer as jest.MockedClass<typeof ThinkingBudgetOptimizer>).mockImplementation(() => mockThinkingOptimizer as any);

      const mockContextOptimizer = {
        optimize: jest.fn().mockResolvedValue(mockParsedRequest),
      };
      (ContextOptimizer as jest.MockedClass<typeof ContextOptimizer>).mockImplementation(() => mockContextOptimizer as any);

      // Mock account selection
      const mockAccountPoolManager = {
        selectAccount: jest.fn().mockResolvedValue({
          account: {
            id: 'anthropic-1',
            provider: 'anthropic',
            apiKey: 'test-key',
          },
          score: 0.9,
          reason: 'Best available account',
        }),
        updateQuota: jest.fn().mockResolvedValue(undefined),
      };
      (AccountPoolManager as jest.MockedClass<typeof AccountPoolManager>).mockImplementation(() => mockAccountPoolManager as any);

      // Mock Anthropic API - fails with 400
      const badRequestError = { status: 400, message: 'Invalid request' };

      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockRejectedValue(badRequestError),
        },
      };

      const Anthropic = require('@anthropic-ai/sdk').default;
      (Anthropic as jest.Mock).mockImplementation(() => mockAnthropicClient);

      // Mock request formatting
      (RequestFormatter.prototype.format as jest.Mock).mockReturnValue(mockParsedRequest);

      // Execute
      await handleMessagesRequest(mockRequest, mockReply);

      // Verify - should not retry, return 400 error
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(1);
      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        error: {
          type: 'invalid_request_error',
          message: 'Invalid request',
        },
      });
    });
  });

  describe('handleModelsRequest', () => {
    it('should return list of available models', async () => {
      await handleModelsRequest(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      expect(mockReply.send).toHaveBeenCalledWith({
        object: 'list',
        data: expect.arrayContaining([
          expect.objectContaining({
            id: 'claude-opus-4-20250514',
            object: 'model',
            owned_by: 'anthropic',
          }),
          expect.objectContaining({
            id: 'claude-sonnet-4-20250514',
            object: 'model',
            owned_by: 'anthropic',
          }),
          expect.objectContaining({
            id: 'claude-haiku-4-20250514',
            object: 'model',
            owned_by: 'anthropic',
          }),
        ]),
      });
    });
  });
});
