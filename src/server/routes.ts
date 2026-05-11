/**
 * Request routing handlers for ClaudeFlow
 * 
 * Implements the main request processing pipeline:
 * 1. Parse incoming request
 * 2. Check semantic deduplication cache
 * 3. If cache miss: classify, optimize cache markers, optimize thinking budget, optimize context
 * 4. Select account (includes Kiro account selection)
 * 5. Route to MITM router for Kiro accounts, direct to Anthropic API for others
 * 6. Parse response
 * 7. Store in semantic deduplication cache
 * 8. Return response to client
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { RequestParser } from '../parsers/request-parser.js';
import { ResponseParser } from '../parsers/response-parser.js';
import { RequestFormatter } from '../parsers/request-formatter.js';
import { ResponseFormatter } from '../parsers/response-formatter.js';
import { SemanticDeduplicationEngine } from '../optimizers/semantic-deduplication.js';
import { RequestClassifier } from '../optimizers/request-classifier.js';
import { CacheOptimizer } from '../optimizers/cache-optimizer.js';
import { ThinkingBudgetOptimizer } from '../optimizers/thinking-budget-optimizer.js';
import { ContextOptimizer } from '../optimizers/context-optimizer.js';
import { AccountPoolManager } from '../accounts/account-pool-manager.js';
import { KiroMitmClient, KiroMitmError } from '../accounts/kiro-mitm-client.js';
import { KiroAuthManager } from '../accounts/kiro-auth-manager.js';
import { StreamingHandler } from '../streaming/streaming-handler.js';
import type { AnthropicRequest, AnthropicResponse, ServerSentEvent } from '../types/anthropic.types.js';
import type { ServerContext } from './index.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Check if error is retryable
 */
function isRetryableError(error: any): boolean {
  // Retryable errors: 429 (rate limit), 503 (service unavailable), network errors
  if (error.status === 429 || error.status === 503) {
    return true;
  }
  
  // Network errors (no status code)
  if (!error.status && error.code) {
    return true;
  }
  
  // Kiro MITM errors (except session expiration which needs refresh)
  if (error instanceof KiroMitmError) {
    return error.statusCode === 429 || error.statusCode === 503 || !error.statusCode;
  }
  
  return false;
}

/**
 * Check if error is permanent (should not retry)
 */
function isPermanentError(error: any): boolean {
  // Permanent errors: 400 (bad request), 401 (unauthorized), 404 (not found)
  return error.status === 400 || error.status === 401 || error.status === 404;
}

/**
 * POST /v1/messages handler
 * 
 * Main request processing pipeline for both streaming and non-streaming requests
 */
export async function handleMessagesRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const startTime = Date.now();
  const requestId = request.id;
  
  try {
    // Get server context
    const context = (request.server as any).context as ServerContext;
    const { config, infrastructure } = context;
    
    request.log.info({ requestId }, 'Processing messages request');
    
    // 1. Parse incoming request
    const requestParser = new RequestParser();
    const parseResult = requestParser.parse(request.body);
    
    if (!parseResult.success) {
      request.log.error({ requestId, error: parseResult.error }, 'Request parsing failed');
      return reply.code(400).send({
        error: {
          type: 'invalid_request_error',
          message: parseResult.error,
        },
      });
    }
    
    const anthropicRequest = parseResult.value;
    request.log.info(
      {
        requestId,
        model: anthropicRequest.model,
        messageCount: anthropicRequest.messages.length,
        stream: anthropicRequest.stream,
      },
      'Request parsed successfully'
    );
    
    // Check if this is a streaming request
    if (anthropicRequest.stream) {
      return handleStreamingRequest(request, reply, anthropicRequest, requestId, startTime);
    }
    
    // 2. Check semantic deduplication cache
    const deduplicationEngine = new SemanticDeduplicationEngine(
      config.infrastructure?.qdrant?.url || 'http://localhost:6333',
      config.infrastructure?.redis?.url || 'redis://localhost:6379',
      config.infrastructure?.voyage?.apiKey || ''
    );
    
    const cacheResult = await deduplicationEngine.checkCache(anthropicRequest);
    
    if (cacheResult.hit && cacheResult.response) {
      const cacheLatency = Date.now() - startTime;
      request.log.info(
        {
          requestId,
          cacheHit: true,
          similarity: cacheResult.similarity,
          latency: cacheLatency,
        },
        'Cache hit - returning cached response'
      );
      
      // Format and return cached response
      const responseFormatter = new ResponseFormatter();
      const formattedResponse = responseFormatter.format(cacheResult.response);
      
      return reply.code(200).send(formattedResponse);
    }
    
    request.log.info({ requestId, cacheHit: false }, 'Cache miss - processing request');
    
    // 3. Classify request
    const classifier = new RequestClassifier('');
    const classification = await classifier.classify(anthropicRequest);
    
    request.log.info(
      {
        requestId,
        complexity: classification.complexity,
        confidence: classification.confidence,
      },
      'Request classified'
    );
    
    // 4. Optimize cache markers
    const cacheOptimizer = new CacheOptimizer();
    let optimizedRequest = cacheOptimizer.optimize(anthropicRequest);
    
    request.log.info({ requestId }, 'Cache markers optimized');
    
    // 5. Optimize thinking budget
    const thinkingOptimizer = new ThinkingBudgetOptimizer();
    optimizedRequest = thinkingOptimizer.optimize(optimizedRequest, classification);
    
    request.log.info(
      {
        requestId,
        thinkingBudget: optimizedRequest.thinking?.budget_tokens || 0,
      },
      'Thinking budget optimized'
    );
    
    // 6. Optimize context (if needed)
    const contextOptimizer = new ContextOptimizer('');
    optimizedRequest = await contextOptimizer.optimize(optimizedRequest);
    
    request.log.info({ requestId }, 'Context optimized');
    
    // 7. Select account
    const accountPoolManager = new AccountPoolManager(infrastructure.redis, config, infrastructure.keychain);
    const accountSelection = await accountPoolManager.selectAccount(optimizedRequest.model);
    
    request.log.info(
      {
        requestId,
        accountId: accountSelection.account.id,
        provider: accountSelection.account.provider,
        score: accountSelection.score,
        reason: accountSelection.reason,
      },
      'Account selected'
    );
    
    // 8. Route to appropriate endpoint based on account type
    let response: AnthropicResponse;
    
    // Retry logic with exponential backoff
    let lastError: any;
    for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
      try {
        if (accountSelection.account.provider === 'kiro') {
          // Route to Kiro MITM router
          request.log.info(
            { requestId, accountId: accountSelection.account.id, attempt },
            'Routing to Kiro MITM router'
          );
          
          const kiroClient = new KiroMitmClient();
          const kiroConfig = {
            machineId: accountSelection.account.kiroConfig!.machineId,
            sessionToken: accountSelection.account.apiKey, // Session token stored as apiKey
            apiKey: accountSelection.account.apiKey, // API key at account level
            mitmRouterUrl: accountSelection.account.kiroConfig!.mitmRouterUrl,
          };
          
          response = await kiroClient.sendRequest(optimizedRequest, kiroConfig);
          
          request.log.info({ requestId }, 'Received response from Kiro MITM router');
          break; // Success, exit retry loop
        } else if ('apiKey' in accountSelection.account) {
          // Route to Anthropic API directly (only for accounts with apiKey)
          request.log.info(
            { requestId, accountId: accountSelection.account.id, attempt },
            'Routing to Anthropic API'
          );
          
          const anthropicClient = new Anthropic({
            apiKey: accountSelection.account.apiKey,
          });
          
          // Format request for Anthropic API
          const requestFormatter = new RequestFormatter();
          const formattedRequest = requestFormatter.format(optimizedRequest);
          
          // Send request to Anthropic API
          const apiResponse = await anthropicClient.messages.create(formattedRequest as any);
          
          // Parse response
          const responseParser = new ResponseParser();
          const parseResult = responseParser.parse(apiResponse);
          
          if (!parseResult.success) {
            throw new Error(`Failed to parse Anthropic API response: ${parseResult.error}`);
          }
          
          response = parseResult.value;
          
          request.log.info({ requestId }, 'Received response from Anthropic API');
          break; // Success, exit retry loop
        }
      } catch (error: any) {
        lastError = error;
        
        // Handle Kiro session expiration (401)
        if (error instanceof KiroMitmError && error.isSessionExpired) {
          request.log.warn(
            { requestId, accountId: accountSelection.account.id },
            'Kiro session expired, attempting refresh'
          );
          
          try {
            // Refresh Kiro session
            const kiroAuthManager = new KiroAuthManager(infrastructure.redis);
            
            const refreshedSession = await kiroAuthManager.refreshSession(
              accountSelection.account.id
            );
            
            // Update account with new session token (only for legacy kiro accounts with apiKey)
            if ('apiKey' in accountSelection.account) {
              accountSelection.account.apiKey = refreshedSession.sessionToken;
            }
            
            request.log.info(
              { requestId, accountId: accountSelection.account.id },
              'Kiro session refreshed successfully'
            );
            
            // Retry with refreshed session (don't count as retry attempt)
            continue;
          } catch (refreshError: any) {
            request.log.error(
              {
                requestId,
                accountId: accountSelection.account.id,
                error: refreshError.message,
              },
              'Failed to refresh Kiro session, rotating to next account'
            );
            
            // Try to rotate to next Kiro account in combo
            // For now, fall through to fallback logic
          }
        }
        
        // Check if error is permanent (don't retry)
        if (isPermanentError(error)) {
          request.log.error(
            {
              requestId,
              error: error.message,
              status: error.status,
            },
            'Permanent error, not retrying'
          );
          throw error;
        }
        
        // Check if error is retryable
        if (isRetryableError(error) && attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const delay = calculateBackoffDelay(attempt, DEFAULT_RETRY_CONFIG);
          
          request.log.warn(
            {
              requestId,
              attempt,
              error: error.message,
              status: error.status,
              retryAfterMs: delay,
            },
            'Retryable error, backing off'
          );
          
          await sleep(delay);
          continue; // Retry
        }
        
        // Max retries reached or non-retryable error
        if (attempt >= DEFAULT_RETRY_CONFIG.maxRetries) {
          request.log.error(
            {
              requestId,
              attempt,
              error: error.message,
            },
            'Max retries reached'
          );
        }
        
        throw error;
      }
    }
    
    // If we get here without a response, throw the last error
    if (!response!) {
      throw lastError || new Error('Request failed without response');
    }
    
    // 9. Update account quota
    const totalTokens = response.usage.input_tokens + response.usage.output_tokens;
    await accountPoolManager.updateQuota(accountSelection.account.id, totalTokens);
    
    request.log.info(
      {
        requestId,
        accountId: accountSelection.account.id,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      'Account quota updated'
    );
    
    // 10. Store in semantic deduplication cache
    await deduplicationEngine.storeResponse(anthropicRequest, response);
    
    request.log.info({ requestId }, 'Response stored in cache');
    
    // 11. Format and return response
    const responseFormatter = new ResponseFormatter();
    const formattedResponse = responseFormatter.format(response);
    
    const totalLatency = Date.now() - startTime;
    request.log.info(
      {
        requestId,
        totalLatency,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheTokensSaved: response.usage.cache_read_input_tokens || 0,
      },
      'Request completed successfully'
    );
    
    return reply.code(200).send(formattedResponse);
  } catch (error: any) {
    const errorLatency = Date.now() - startTime;
    request.log.error(
      {
        requestId,
        error: error.message,
        stack: error.stack,
        latency: errorLatency,
        status: error.status,
      },
      'Request processing failed'
    );
    
    // Handle Kiro MITM errors
    if (error instanceof KiroMitmError) {
      if (error.isSessionExpired) {
        return reply.code(401).send({
          error: {
            type: 'authentication_error',
            message: 'Kiro session expired',
          },
        });
      } else if (error.statusCode === 429) {
        return reply.code(429).send({
          error: {
            type: 'rate_limit_error',
            message: 'Rate limit exceeded',
          },
        });
      } else if (error.statusCode === 503) {
        return reply.code(503).send({
          error: {
            type: 'service_unavailable_error',
            message: 'MITM router unavailable',
          },
        });
      } else if (error.statusCode === 400) {
        return reply.code(400).send({
          error: {
            type: 'invalid_request_error',
            message: error.message,
          },
        });
      }
    }
    
    // Determine error type and status code
    if (error.status === 401) {
      return reply.code(401).send({
        error: {
          type: 'authentication_error',
          message: 'Invalid API key',
        },
      });
    } else if (error.status === 429) {
      return reply.code(429).send({
        error: {
          type: 'rate_limit_error',
          message: 'Rate limit exceeded',
        },
      });
    } else if (error.status === 503) {
      return reply.code(503).send({
        error: {
          type: 'service_unavailable_error',
          message: 'Service temporarily unavailable',
        },
      });
    } else if (error.status === 400) {
      return reply.code(400).send({
        error: {
          type: 'invalid_request_error',
          message: error.message,
        },
      });
    } else if (error.status === 404) {
      return reply.code(404).send({
        error: {
          type: 'not_found_error',
          message: 'Resource not found',
        },
      });
    } else {
      // Generic server error
      return reply.code(500).send({
        error: {
          type: 'api_error',
          message: 'Internal server error',
        },
      });
    }
  }
}

/**
 * Handle streaming request
 * 
 * @param request - Fastify request
 * @param reply - Fastify reply
 * @param anthropicRequest - Parsed Anthropic request
 * @param requestId - Request ID
 * @param startTime - Request start time
 */
async function handleStreamingRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  anthropicRequest: AnthropicRequest,
  requestId: string,
  startTime: number
): Promise<void> {
  try {
    // Get server context
    const context = (request.server as any).context as ServerContext;
    const { config, infrastructure } = context;
    
    request.log.info({ requestId }, 'Processing streaming request');
    
    // For streaming requests, we skip semantic deduplication cache
    // (streaming responses are not cached)
    
    // 1. Classify request
    const classifier = new RequestClassifier('');
    const classification = await classifier.classify(anthropicRequest);
    
    request.log.info(
      {
        requestId,
        complexity: classification.complexity,
        confidence: classification.confidence,
      },
      'Request classified'
    );
    
    // 2. Optimize cache markers
    const cacheOptimizer = new CacheOptimizer();
    let optimizedRequest = cacheOptimizer.optimize(anthropicRequest);
    
    request.log.info({ requestId }, 'Cache markers optimized');
    
    // 3. Optimize thinking budget
    const thinkingOptimizer = new ThinkingBudgetOptimizer();
    optimizedRequest = thinkingOptimizer.optimize(optimizedRequest, classification);
    
    request.log.info(
      {
        requestId,
        thinkingBudget: optimizedRequest.thinking?.budget_tokens || 0,
      },
      'Thinking budget optimized'
    );
    
    // 4. Optimize context (if needed)
    const contextOptimizer = new ContextOptimizer('');
    optimizedRequest = await contextOptimizer.optimize(optimizedRequest);
    
    request.log.info({ requestId }, 'Context optimized');
    
    // 5. Select account
    const accountPoolManager = new AccountPoolManager(infrastructure.redis, config, infrastructure.keychain);
    const accountSelection = await accountPoolManager.selectAccount(optimizedRequest.model);
    
    request.log.info(
      {
        requestId,
        accountId: accountSelection.account.id,
        provider: accountSelection.account.provider,
        score: accountSelection.score,
        reason: accountSelection.reason,
      },
      'Account selected'
    );
    
    // 6. Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    
    // 7. Route to appropriate endpoint based on account type
    for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
      try {
        if (accountSelection.account.provider === 'kiro') {
          // Route to Kiro MITM router
          request.log.info(
            { requestId, accountId: accountSelection.account.id, attempt },
            'Routing streaming request to Kiro MITM router'
          );
          
          const kiroClient = new KiroMitmClient();
          const kiroConfig = {
            machineId: accountSelection.account.kiroConfig!.machineId,
            sessionToken: 'apiKey' in accountSelection.account ? accountSelection.account.apiKey : '', // Session token stored as apiKey
            apiKey: 'apiKey' in accountSelection.account ? accountSelection.account.apiKey : '', // API key at account level
            mitmRouterUrl: accountSelection.account.kiroConfig!.mitmRouterUrl,
          };
          
          // Stream from Kiro MITM router
          const stream = kiroClient.sendStreamingRequest(optimizedRequest, kiroConfig);
          
          // Forward SSE events to client (preserve native Anthropic format)
          for await (const chunk of stream) {
            reply.raw.write(chunk);
          }
          
          request.log.info({ requestId }, 'Streaming completed from Kiro MITM router');
          break; // Success, exit retry loop
        } else {
          // Route to Anthropic API directly
          request.log.info(
            { requestId, accountId: accountSelection.account.id, attempt },
            'Routing streaming request to Anthropic API'
          );
          
          const anthropicClient = new Anthropic({
            apiKey: 'apiKey' in accountSelection.account ? accountSelection.account.apiKey : '',
          });
          
          // Format request for Anthropic API
          const requestFormatter = new RequestFormatter();
          const formattedRequest = requestFormatter.format(optimizedRequest);
          
          // Send streaming request to Anthropic API
          const stream = await anthropicClient.messages.stream(formattedRequest as any);
          
          // Use StreamingHandler to process events
          const streamingHandler = new StreamingHandler(
            { mode: 'standard' },
            infrastructure.anthropic
          );
          
          // Convert Anthropic SDK stream to ServerSentEvent format
          const sseStream = convertAnthropicStreamToSSE(stream);
          
          // Process and forward events
          for await (const chunk of streamingHandler.handleStream(sseStream)) {
            // Format chunk as SSE
            const sseData = `event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`;
            reply.raw.write(sseData);
          }
          
          request.log.info({ requestId }, 'Streaming completed from Anthropic API');
          break; // Success, exit retry loop
        }
      } catch (error: any) {
        // Handle Kiro session expiration (401)
        if (error instanceof KiroMitmError && error.isSessionExpired) {
          request.log.warn(
            { requestId, accountId: accountSelection.account.id },
            'Kiro session expired during streaming, attempting refresh'
          );
          
          try {
            // Refresh Kiro session
            const kiroAuthManager = new KiroAuthManager(infrastructure.redis);
            
            const refreshedSession = await kiroAuthManager.refreshSession(
              accountSelection.account.id
            );
            
            // Update account with new session token (only for legacy kiro accounts with apiKey)
            if ('apiKey' in accountSelection.account) {
              accountSelection.account.apiKey = refreshedSession.sessionToken;
            }
            
            request.log.info(
              { requestId, accountId: accountSelection.account.id },
              'Kiro session refreshed successfully, retrying stream'
            );
            
            // Retry with refreshed session (don't count as retry attempt)
            continue;
          } catch (refreshError: any) {
            request.log.error(
              {
                requestId,
                accountId: accountSelection.account.id,
                error: refreshError.message,
              },
              'Failed to refresh Kiro session during streaming'
            );
            
            // Send error event and exit
            const errorEvent = `event: error\ndata: ${JSON.stringify({
              error: {
                type: 'authentication_error',
                message: 'Kiro session expired and refresh failed',
              },
            })}\n\n`;
            
            reply.raw.write(errorEvent);
            reply.raw.end();
            return;
          }
        }
        
        // Check if error is permanent (don't retry)
        if (isPermanentError(error)) {
          request.log.error(
            {
              requestId,
              error: error.message,
              status: error.status,
            },
            'Permanent error during streaming, not retrying'
          );
          throw error;
        }
        
        // Check if error is retryable
        if (isRetryableError(error) && attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const delay = calculateBackoffDelay(attempt, DEFAULT_RETRY_CONFIG);
          
          request.log.warn(
            {
              requestId,
              attempt,
              error: error.message,
              status: error.status,
              retryAfterMs: delay,
            },
            'Retryable error during streaming, backing off'
          );
          
          await sleep(delay);
          continue; // Retry
        }
        
        // Max retries reached or non-retryable error
        if (attempt >= DEFAULT_RETRY_CONFIG.maxRetries) {
          request.log.error(
            {
              requestId,
              attempt,
              error: error.message,
            },
            'Max retries reached during streaming'
          );
        }
        
        throw error;
      }
    }
    
    // End the stream
    reply.raw.end();
    
    const totalLatency = Date.now() - startTime;
    request.log.info(
      {
        requestId,
        totalLatency,
      },
      'Streaming request completed successfully'
    );
  } catch (error: any) {
    const errorLatency = Date.now() - startTime;
    request.log.error(
      {
        requestId,
        error: error.message,
        stack: error.stack,
        latency: errorLatency,
        status: error.status,
      },
      'Streaming request processing failed'
    );
    
    // Determine error type and send as SSE event
    let errorType = 'api_error';
    let errorMessage = error.message || 'Internal server error';
    
    // Handle Kiro MITM errors
    if (error instanceof KiroMitmError) {
      if (error.isSessionExpired) {
        errorType = 'authentication_error';
        errorMessage = 'Kiro session expired';
      } else if (error.statusCode === 429) {
        errorType = 'rate_limit_error';
        errorMessage = 'Rate limit exceeded';
      } else if (error.statusCode === 503) {
        errorType = 'service_unavailable_error';
        errorMessage = 'MITM router unavailable';
      } else if (error.statusCode === 400) {
        errorType = 'invalid_request_error';
        errorMessage = error.message;
      }
    } else if (error.status === 401) {
      errorType = 'authentication_error';
      errorMessage = 'Invalid API key';
    } else if (error.status === 429) {
      errorType = 'rate_limit_error';
      errorMessage = 'Rate limit exceeded';
    } else if (error.status === 503) {
      errorType = 'service_unavailable_error';
      errorMessage = 'Service temporarily unavailable';
    } else if (error.status === 400) {
      errorType = 'invalid_request_error';
      errorMessage = error.message;
    } else if (error.status === 404) {
      errorType = 'not_found_error';
      errorMessage = 'Resource not found';
    }
    
    // Send error as SSE event
    const errorEvent = `event: error\ndata: ${JSON.stringify({
      error: {
        type: errorType,
        message: errorMessage,
      },
    })}\n\n`;
    
    reply.raw.write(errorEvent);
    reply.raw.end();
  }
}

/**
 * Convert Anthropic SDK stream to ServerSentEvent format
 * 
 * @param stream - Anthropic SDK stream
 * @returns AsyncIterable of ServerSentEvent objects
 */
async function* convertAnthropicStreamToSSE(
  stream: any
): AsyncIterable<ServerSentEvent> {
  for await (const event of stream) {
    // Anthropic SDK provides events in a specific format
    // We need to convert them to our ServerSentEvent format
    yield {
      event: event.type,
      data: JSON.stringify(event),
    };
  }
}

/**
 * GET /v1/models handler
 * 
 * Returns list of available models
 */
export async function handleModelsRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  request.log.info({ requestId: request.id }, 'Listing available models');
  
  return reply.code(200).send({
    object: 'list',
    data: [
      {
        id: 'claude-opus-4-20250514',
        object: 'model',
        created: 1715644800,
        owned_by: 'anthropic',
      },
      {
        id: 'claude-sonnet-4-20250514',
        object: 'model',
        created: 1715644800,
        owned_by: 'anthropic',
      },
      {
        id: 'claude-haiku-4-20250514',
        object: 'model',
        created: 1715644800,
        owned_by: 'anthropic',
      },
    ],
  });
}

/**
 * GET /admin/analytics handler
 * 
 * Returns aggregated metrics and insights for specified time range
 */
export async function handleAnalyticsRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const requestId = request.id;
    request.log.info({ requestId }, 'Fetching analytics data');
    
    // Get server context
    const context = (request.server as any).context as ServerContext;
    const { infrastructure } = context;
    
    // Import AnalyticsEngine
    const { AnalyticsEngine } = await import('../analytics/analytics-engine.js');
    const analyticsEngine = new AnalyticsEngine(infrastructure.redis.getClient());
    
    // Parse query parameters
    const query = request.query as any;
    const filter: any = {};
    
    // Time range
    if (query.startTime) {
      filter.startTime = new Date(query.startTime);
    }
    if (query.endTime) {
      filter.endTime = new Date(query.endTime);
    }
    
    // Filters
    if (query.model) {
      filter.model = query.model;
    }
    if (query.complexity) {
      filter.complexity = query.complexity;
    }
    if (query.accountType) {
      filter.accountType = query.accountType;
    }
    
    // Get metrics and insights
    const [metrics, insights] = await Promise.all([
      analyticsEngine.getMetrics(filter),
      analyticsEngine.generateInsights(filter),
    ]);
    
    request.log.info(
      {
        requestId,
        totalRequests: metrics.totalRequests,
        insightCount: insights.length,
      },
      'Analytics data retrieved'
    );
    
    return reply.code(200).send({
      metrics,
      insights,
      filter: {
        startTime: metrics.startTime,
        endTime: metrics.endTime,
        model: filter.model,
        complexity: filter.complexity,
        accountType: filter.accountType,
      },
    });
  } catch (error: any) {
    request.log.error(
      {
        requestId: request.id,
        error: error.message,
        stack: error.stack,
      },
      'Failed to fetch analytics data'
    );
    
    return reply.code(500).send({
      error: {
        type: 'api_error',
        message: 'Failed to fetch analytics data',
      },
    });
  }
}

/**
 * GET /metrics handler
 * 
 * Returns Prometheus-compatible metrics
 */
export async function handleMetricsRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const requestId = request.id;
    request.log.info({ requestId }, 'Fetching Prometheus metrics');
    
    // Get server context
    const context = (request.server as any).context as ServerContext;
    const { infrastructure } = context;
    
    // Import AnalyticsEngine
    const { AnalyticsEngine } = await import('../analytics/analytics-engine.js');
    const analyticsEngine = new AnalyticsEngine(infrastructure.redis.getClient());
    
    // Get metrics for last 24 hours
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    
    const metrics = await analyticsEngine.getMetrics({ startTime, endTime });
    
    // Format as Prometheus metrics
    const prometheusMetrics: string[] = [];
    
    // Request counters
    prometheusMetrics.push('# HELP claudeflow_requests_total Total number of requests');
    prometheusMetrics.push('# TYPE claudeflow_requests_total counter');
    prometheusMetrics.push(`claudeflow_requests_total{status="success"} ${metrics.successfulRequests}`);
    prometheusMetrics.push(`claudeflow_requests_total{status="error"} ${metrics.failedRequests}`);
    prometheusMetrics.push(`claudeflow_requests_total{account_type="kiro"} ${metrics.kiroRequests}`);
    prometheusMetrics.push(`claudeflow_requests_total{account_type="anthropic"} ${metrics.anthropicRequests}`);
    
    // Request duration histogram
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_request_duration_seconds Request duration in seconds');
    prometheusMetrics.push('# TYPE claudeflow_request_duration_seconds histogram');
    prometheusMetrics.push(`claudeflow_request_duration_seconds{quantile="0.5"} ${metrics.p50ResponseTime / 1000}`);
    prometheusMetrics.push(`claudeflow_request_duration_seconds{quantile="0.95"} ${metrics.p95ResponseTime / 1000}`);
    prometheusMetrics.push(`claudeflow_request_duration_seconds{quantile="0.99"} ${metrics.p99ResponseTime / 1000}`);
    prometheusMetrics.push(`claudeflow_request_duration_seconds_sum ${(metrics.averageResponseTime * metrics.totalRequests) / 1000}`);
    prometheusMetrics.push(`claudeflow_request_duration_seconds_count ${metrics.totalRequests}`);
    
    // Cache hit rate gauge
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_cache_hit_rate Cache hit rate (0-1)');
    prometheusMetrics.push('# TYPE claudeflow_cache_hit_rate gauge');
    prometheusMetrics.push(`claudeflow_cache_hit_rate ${metrics.cacheHitRate}`);
    
    // Deduplication rate gauge
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_deduplication_rate Semantic deduplication rate (0-1)');
    prometheusMetrics.push('# TYPE claudeflow_deduplication_rate gauge');
    prometheusMetrics.push(`claudeflow_deduplication_rate ${metrics.deduplicationRate}`);
    
    // Cost savings gauge
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_optimization_savings_dollars Total cost savings in dollars');
    prometheusMetrics.push('# TYPE claudeflow_optimization_savings_dollars gauge');
    prometheusMetrics.push(`claudeflow_optimization_savings_dollars ${metrics.costSavings}`);
    
    // Total cost gauge
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_total_cost_dollars Total cost in dollars');
    prometheusMetrics.push('# TYPE claudeflow_total_cost_dollars gauge');
    prometheusMetrics.push(`claudeflow_total_cost_dollars ${metrics.totalCost}`);
    
    // Token usage counters
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_tokens_total Total tokens processed');
    prometheusMetrics.push('# TYPE claudeflow_tokens_total counter');
    prometheusMetrics.push(`claudeflow_tokens_total{type="input"} ${metrics.totalInputTokens}`);
    prometheusMetrics.push(`claudeflow_tokens_total{type="output"} ${metrics.totalOutputTokens}`);
    prometheusMetrics.push(`claudeflow_tokens_total{type="cache_creation"} ${metrics.totalCacheCreationTokens}`);
    prometheusMetrics.push(`claudeflow_tokens_total{type="cache_read"} ${metrics.totalCacheReadTokens}`);
    prometheusMetrics.push(`claudeflow_tokens_total{type="thinking"} ${metrics.totalThinkingTokens}`);
    
    // Error rate gauge
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_error_rate Error rate (0-1)');
    prometheusMetrics.push('# TYPE claudeflow_error_rate gauge');
    prometheusMetrics.push(`claudeflow_error_rate ${metrics.errorRate}`);
    
    // Kiro account usage percentage
    prometheusMetrics.push('');
    prometheusMetrics.push('# HELP claudeflow_kiro_account_usage_percent Percentage of requests using Kiro accounts');
    prometheusMetrics.push('# TYPE claudeflow_kiro_account_usage_percent gauge');
    prometheusMetrics.push(`claudeflow_kiro_account_usage_percent ${metrics.kiroPercentage}`);
    
    // Error counters by type
    if (Object.keys(metrics.errorsByType).length > 0) {
      prometheusMetrics.push('');
      prometheusMetrics.push('# HELP claudeflow_errors_by_type_total Errors by type');
      prometheusMetrics.push('# TYPE claudeflow_errors_by_type_total counter');
      for (const [errorType, count] of Object.entries(metrics.errorsByType)) {
        prometheusMetrics.push(`claudeflow_errors_by_type_total{error_type="${errorType}"} ${count}`);
      }
    }
    
    request.log.info({ requestId }, 'Prometheus metrics generated');
    
    // Return as plain text with Prometheus content type
    return reply
      .code(200)
      .header('Content-Type', 'text/plain; version=0.0.4')
      .send(prometheusMetrics.join('\n') + '\n');
  } catch (error: any) {
    request.log.error(
      {
        requestId: request.id,
        error: error.message,
        stack: error.stack,
      },
      'Failed to generate Prometheus metrics'
    );
    
    return reply.code(500).send({
      error: {
        type: 'api_error',
        message: 'Failed to generate metrics',
      },
    });
  }
}
