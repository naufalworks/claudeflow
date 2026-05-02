import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Config } from '../config/index.js';
import { InfrastructureClients, healthCheckAll } from '../infrastructure/index.js';

export interface ServerContext {
  config: Config;
  infrastructure: InfrastructureClients;
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
    credentials: true,
  });

  // Add context to server
  server.decorate('context', context);

  // Request logging middleware
  server.addHook('onRequest', (request, _reply, done) => {
    request.log.info(
      {
        method: request.method,
        url: request.url,
        headers: request.headers,
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
        responseTime: reply.getResponseTime(),
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
  const { handleMessagesRequest, handleModelsRequest, handleAnalyticsRequest, handleMetricsRequest } = await import('./routes.js');
  
  // POST /v1/messages - Main request processing pipeline
  server.post('/v1/messages', handleMessagesRequest);
  
  // GET /v1/models - List available models
  server.get('/v1/models', handleModelsRequest);
  
  // GET /admin/analytics - Analytics and insights
  server.get('/admin/analytics', handleAnalyticsRequest);
  
  // GET /metrics - Prometheus metrics
  server.get('/metrics', handleMetricsRequest);

  return server;
}

export async function startServer(server: FastifyInstance, config: Config): Promise<void> {
  try {
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
