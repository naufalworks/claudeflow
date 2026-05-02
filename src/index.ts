import { ConfigurationManager } from './config/index.js';
import { initializeInfrastructure } from './infrastructure/index.js';
import { createServer, startServer } from './server/index.js';

async function main() {
  try {
    console.log('🚀 Starting ClaudeFlow...');

    // Load configuration
    const configManager = new ConfigurationManager();
    const config = await configManager.loadConfig();

    // Initialize infrastructure
    const infrastructure = await initializeInfrastructure({
      qdrant: config.infrastructure.qdrant,
      redis: config.infrastructure.redis,
      voyage: config.infrastructure.voyage,
      anthropic: {
        apiKey: config.accounts[0].apiKey,
        baseURL: config.accounts[0].baseURL,
      },
    });

    // Create and start server
    const server = await createServer({
      config,
      infrastructure,
    });

    await startServer(server, config);

    // Enable hot reload for configuration
    configManager.enableHotReload();

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await server.close();
      await infrastructure.redis.disconnect();
      console.log('✅ Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (error) {
    console.error('❌ Failed to start ClaudeFlow:', error);
    process.exit(1);
  }
}

void main();
