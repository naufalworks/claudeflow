import { ConfigurationManager } from './config/index.js';
import { initializeInfrastructure } from './infrastructure/index.js';
import { createServer, startServer } from './server/index.js';
import { AuthService } from './cli/services/auth-service.js';

async function main() {
  try {
    console.log('🚀 Starting ClaudeFlow...');

    // Load configuration
    const configManager = new ConfigurationManager();
    const config = await configManager.loadConfig();

    // Initialize infrastructure. Kiro-only setups do not need an Anthropic API key.
    const accountWithApiKey = config.accounts.find(a => a.provider !== 'kiro-oauth' && 'apiKey' in a);
    const anthropicConfig = accountWithApiKey && 'apiKey' in accountWithApiKey
      ? {
          apiKey: accountWithApiKey.apiKey,
          baseURL: accountWithApiKey.provider === 'proxy' ? accountWithApiKey.baseURL : undefined,
        }
      : {
          apiKey: process.env.ANTHROPIC_API_KEY || 'not-configured',
        };
    
    const infrastructure = await initializeInfrastructure({
      qdrant: config.infrastructure.qdrant,
      redis: config.infrastructure.redis,
      voyage: config.infrastructure.voyage,
      anthropic: anthropicConfig,
    });

    // Initialize CLI AuthService for session refresh worker
    let authService: AuthService | undefined;
    try {
      const authConfigManager = new ConfigurationManager();
      authConfigManager.updateConfig(config);
      const configPath = process.env.CLAUDEFLOW_CONFIG || process.env.CONFIG_PATH || `${process.env.HOME}/.claudeflow/config.json`;

      authService = new AuthService(authConfigManager, infrastructure.redis, configPath);
      await authService.initialize();

      // Start session refresh worker
      await authService.startSessionRefreshWorker();
      console.log('✅ Session refresh worker started');
    } catch (error) {
      console.warn('⚠️  Failed to start session refresh worker:', error);
      // Continue without session refresh worker - not critical for daemon operation
    }

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
      
      // Stop session refresh worker
      if (authService) {
        try {
          await authService.stopSessionRefreshWorker();
          console.log('✅ Session refresh worker stopped');
        } catch (error) {
          console.warn('⚠️  Failed to stop session refresh worker:', error);
        }
      }
      
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
