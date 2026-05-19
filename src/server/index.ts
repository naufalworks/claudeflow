import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Config } from '../config/index.js';
import { InfrastructureClients, healthCheckAll } from '../infrastructure/index.js';
import { TokenManager } from '../auth/TokenManager.js';
import { KeychainStore } from '../auth/KeychainStore.js';
import { DualAuthModeHandler } from '../auth/DualAuthModeHandler.js';
import { ConfigurationManager } from '../config/manager.js';
import { RealTimeUpdateService } from '../tracking/RealTimeUpdateService.js';

export interface ServerContext {
  config: Config;
  infrastructure: InfrastructureClients;
  tokenManager?: TokenManager;
}

// Extend FastifyRequest to include user info
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      apiKey: string;
      userId: string;
    };
  }
}

export async function createServer(context: ServerContext): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: context.config.server.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
  });

  // Register CORS
  await server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  });

  // Register rate limiting
  await server.register(rateLimit, {
    max: 100, // 100 requests
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', 'localhost'],
    errorResponseBuilder: () => ({
      error: {
        type: 'rate_limit_error',
        message: 'Too many requests, please try again later',
      },
    }),
  });

  // Add context to server
  server.decorate('context', context);

  // Authentication middleware - skip for health/ready endpoints
  server.addHook('onRequest', async (request, reply) => {
    // Skip auth for health and ready endpoints
    if (request.url === '/health' || request.url === '/ready') {
      return;
    }

    // Get API key from Authorization header
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: {
          type: 'authentication_error',
          message: 'Missing or invalid Authorization header',
        },
      });
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate API key against environment variable or config
    const validApiKeys = process.env.CLAUDEFLOW_API_KEYS?.split(',') || [];

    if (validApiKeys.length === 0) {
      // If no API keys configured, allow all requests (development mode)
      request.log.warn('No API keys configured - running in open mode');
      request.user = {
        apiKey,
        userId: 'anonymous',
      };
      return;
    }

    if (!validApiKeys.includes(apiKey)) {
      return reply.code(401).send({
        error: {
          type: 'authentication_error',
          message: 'Invalid API key',
        },
      });
    }

    // Attach user info to request
    request.user = {
      apiKey,
      userId: `user-${apiKey.substring(0, 8)}`, // Use first 8 chars as user ID
    };
  });

  // Request logging middleware
  server.addHook('onRequest', (request, _reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        headers: request.headers,
        userId: request.user?.userId,
      },
      'Incoming request'
    );
    done();
  });

  server.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed'
    );
    done();
  });

  // Health check endpoint
  server.get('/health', (_request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check endpoint
  server.get('/ready', async (_request, reply) => {
    const health = await healthCheckAll(context.infrastructure);

    if (health.overall) {
      return reply.code(200).send({
        status: 'ready',
        services: health,
        timestamp: new Date().toISOString(),
      });
    } else {
      return reply.code(503).send({
        status: 'not ready',
        services: health,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Root endpoint
  server.get('/', async (_request, reply) => {
    return reply.send({
      name: 'ClaudeFlow',
      version: '0.1.0',
      description: "Intelligent API router optimized for Anthropic's Claude models",
      endpoints: {
        health: '/health',
        ready: '/ready',
        messages: '/v1/messages',
        models: '/v1/models',
        metrics: '/metrics',
        analytics: '/admin/analytics',
      },
    });
  });

  // Import and register routes
  const {
    handleMessagesRequest,
    handleModelsRequest,
    handleAnalyticsRequest,
    handleMetricsRequest,
    handleDashboardStartKiroLoginRequest,
    handleDashboardPollKiroLoginRequest,
    handleDashboardAccountsRequest,
    handleDashboardAccountDetailRequest,
    handleDashboardActivityRequest,
    handleDashboardStatsRequest,
    handleDashboardRefreshAccountRequest,
    handleDashboardDeleteAccountRequest,
  } = await import('./routes.js');

  // POST /v1/messages - Main request processing pipeline
  server.post('/v1/messages', handleMessagesRequest);

  // GET /v1/models - List available models
  server.get('/v1/models', handleModelsRequest);

  // GET /admin/analytics - Analytics and insights
  server.get('/admin/analytics', handleAnalyticsRequest);

  // GET /metrics - Prometheus metrics
  server.get('/metrics', handleMetricsRequest);

  // Dashboard API endpoints
  server.post('/api/dashboard/accounts/kiro/start-login', handleDashboardStartKiroLoginRequest);
  server.post('/api/dashboard/accounts/kiro/poll-login', handleDashboardPollKiroLoginRequest);
  server.get('/api/dashboard/accounts', handleDashboardAccountsRequest);
  server.get('/api/dashboard/accounts/:id', handleDashboardAccountDetailRequest);
  server.get('/api/dashboard/activity', handleDashboardActivityRequest);
  server.get('/api/dashboard/stats', handleDashboardStatsRequest);
  server.post('/api/dashboard/accounts/:id/refresh', handleDashboardRefreshAccountRequest);
  server.delete('/api/dashboard/accounts/:id', handleDashboardDeleteAccountRequest);

  return server;
}

export async function startServer(server: FastifyInstance, config: Config): Promise<void> {
  try {
    // Initialize TokenManager for automatic token refresh
    const keychainStore = new KeychainStore();
    const dualAuthModeHandler = new DualAuthModeHandler();
    const configManager = new ConfigurationManager();
    configManager.updateConfig(config);
    const tokenManager = new TokenManager(keychainStore, dualAuthModeHandler, configManager);

    // Start background token refresh worker
    tokenManager.startRefreshWorker();
    console.log('✅ Token refresh worker started (checks every 60 seconds)');

    // Initialize and start WebSocket server for real-time updates
    const realtimeService = new RealTimeUpdateService({
      port: Number(process.env.WS_PORT || 3130),
    });

    await realtimeService.start();
    console.log(`✅ WebSocket server started on port ${Number(process.env.WS_PORT || 3130)}`);

    // Store services in server context for cleanup
    (server as any).tokenManager = tokenManager;
    (server as any).realtimeService = realtimeService;

    // Handle graceful shutdown
    const cleanup = async () => {
      console.log('\n🛑 Shutting down server...');
      tokenManager.stopRefreshWorker();
      console.log('✅ Token refresh worker stopped');
      await realtimeService.stop();
      console.log('✅ WebSocket server stopped');
    };

    process.on('SIGTERM', () => void cleanup());
    process.on('SIGINT', () => void cleanup());

    await server.listen({
      port: config.server.port,
      host: config.server.host,
    });
    console.log(`🚀 ClaudeFlow server listening on ${config.server.host}:${config.server.port}`);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    throw error;
  }
}
