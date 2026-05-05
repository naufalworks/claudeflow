import { readFile, watch } from 'fs/promises';
import { existsSync } from 'fs';
import { Config, ConfigSchema, defaultConfig } from './schema.js';
import { config as dotenvConfig } from 'dotenv';
import { normalizeKeys } from './field-mapper.js';

export class ConfigurationManager {
  private config: Config;
  private configPath?: string;
  private watchers: Array<() => void> = [];

  constructor() {
    this.config = defaultConfig;
  }

  async loadConfig(configPath?: string): Promise<Config> {
    // Load environment variables
    dotenvConfig();

    this.configPath = configPath || process.env.CONFIG_PATH;

    // Start with default config
    let config = { ...defaultConfig };

    // Load from file if provided
    if (this.configPath && existsSync(this.configPath)) {
      try {
        const fileContent = await readFile(this.configPath, 'utf-8');
        const rawConfig = JSON.parse(fileContent) as Partial<Config>;
        // Normalize snake_case keys to camelCase for backward compatibility
        const fileConfig = normalizeKeys<Partial<Config>>(rawConfig);
        config = this.mergeConfig(config, fileConfig);
        console.log(`✅ Loaded configuration from ${this.configPath}`);
      } catch (error) {
        console.error(`❌ Failed to load config from ${this.configPath}:`, error);
        throw error;
      }
    }

    // Override with environment variables
    config = this.loadFromEnvironment(config);

    // Validate configuration
    const validationResult = ConfigSchema.safeParse(config);
    if (!validationResult.success) {
      console.error('❌ Configuration validation failed:', validationResult.error);
      throw new Error(`Invalid configuration: ${validationResult.error.message}`);
    }

    this.config = validationResult.data;
    console.log('✅ Configuration loaded and validated successfully');

    return this.config;
  }

  private loadFromEnvironment(config: Config): Config {
    const envConfig = { ...config };

    // Server configuration
    if (process.env.PORT) {
      envConfig.server.port = parseInt(process.env.PORT, 10);
    }
    if (process.env.HOST) {
      envConfig.server.host = process.env.HOST;
    }
    if (process.env.LOG_LEVEL) {
      envConfig.server.logLevel = process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
    }

    // Infrastructure
    if (process.env.QDRANT_URL) {
      envConfig.infrastructure.qdrant.url = process.env.QDRANT_URL;
    }
    if (process.env.REDIS_URL) {
      envConfig.infrastructure.redis.url = process.env.REDIS_URL;
    }
    if (process.env.VOYAGE_API_KEY) {
      envConfig.infrastructure.voyage.apiKey = process.env.VOYAGE_API_KEY;
    }

    // Accounts from environment variables
    const accounts = [];
    
    // Load Anthropic accounts
    let accountIndex = 1;
    while (process.env[`ANTHROPIC_API_KEY_${accountIndex}`]) {
      accounts.push({
        id: `anthropic-account-${accountIndex}`,
        apiKey: process.env[`ANTHROPIC_API_KEY_${accountIndex}`]!,
        provider: 'anthropic' as const,
      });
      accountIndex++;
    }
    
    // Load Proxy accounts (for Anthropic-compatible proxies)
    // IMPORTANT: Proxy MUST forward raw Anthropic format unchanged (NOT 9router)
    let proxyIndex = 1;
    while (process.env[`PROXY_API_KEY_${proxyIndex}`]) {
      const apiKey = process.env[`PROXY_API_KEY_${proxyIndex}`];
      const baseURL = process.env[`PROXY_BASE_URL_${proxyIndex}`];
      
      if (apiKey && baseURL) {
        accounts.push({
          id: `proxy-account-${proxyIndex}`,
          apiKey: apiKey,
          provider: 'proxy' as const,
          baseURL: baseURL,
        });
      }
      
      proxyIndex++;
    }
    
    // Load Kiro accounts (OAuth-based, backward compatibility)
    let kiroIndex = 1;
    while (process.env[`KIRO_MACHINE_ID_${kiroIndex}`]) {
      const machineId = process.env[`KIRO_MACHINE_ID_${kiroIndex}`];
      const apiKey = process.env[`KIRO_API_KEY_${kiroIndex}`];
      const mitmRouterUrl = process.env[`KIRO_MITM_ROUTER_URL_${kiroIndex}`] || 'http://3.68.219.151:20128';
      
      if (machineId && apiKey) {
        accounts.push({
          id: `kiro-account-${kiroIndex}`,
          apiKey: apiKey, // This will be replaced with session token after authentication
          provider: 'kiro' as const,
          kiroConfig: {
            machineId: machineId,
            mitmRouterUrl: mitmRouterUrl,
          },
        });
      }
      
      kiroIndex++;
    }

    if (accounts.length > 0) {
      // Append environment accounts to existing accounts instead of replacing
      envConfig.accounts = [...envConfig.accounts, ...accounts];
    }

    return envConfig;
  }

  private mergeConfig(base: Config, override: Partial<Config>): Config {
    return {
      server: { ...base.server, ...(override.server ?? {}) },
      infrastructure: {
        qdrant: { ...base.infrastructure.qdrant, ...(override.infrastructure?.qdrant ?? {}) },
        redis: { ...base.infrastructure.redis, ...(override.infrastructure?.redis ?? {}) },
        voyage: { ...base.infrastructure.voyage, ...(override.infrastructure?.voyage ?? {}) },
      },
      accounts: override.accounts ?? base.accounts,
      optimization: {
        semanticDeduplication: {
          ...base.optimization.semanticDeduplication,
          ...(override.optimization?.semanticDeduplication ?? {}),
        },
        promptCaching: {
          ...base.optimization.promptCaching,
          ...(override.optimization?.promptCaching ?? {}),
        },
        thinkingBudget: {
          ...base.optimization.thinkingBudget,
          ...(override.optimization?.thinkingBudget ?? {}),
        },
        contextCompression: {
          ...base.optimization.contextCompression,
          ...(override.optimization?.contextCompression ?? {}),
        },
      },
    };
  }

  getConfig(): Config {
    return this.config;
  }

  getConfigPath(): string {
    if (!this.configPath) {
      throw new Error('Config path not set. Call loadConfig() first.');
    }
    return this.configPath;
  }

  async saveConfig(config: Config): Promise<void> {
    // Validate configuration
    const validationResult = ConfigSchema.safeParse(config);
    if (!validationResult.success) {
      throw new Error(`Invalid configuration: ${validationResult.error.message}`);
    }

    this.config = validationResult.data;

    // Write to file if configPath is set
    if (this.configPath) {
      const { writeFile } = await import('fs/promises');
      await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`✅ Configuration saved to ${this.configPath}`);
    }

    // Notify watchers
    this.notifyWatchers();
  }

  updateConfig(updates: Partial<Config>): void {
    const newConfig = this.mergeConfig(this.config, updates);

    // Validate new configuration
    const validationResult = ConfigSchema.safeParse(newConfig);
    if (!validationResult.success) {
      throw new Error(`Invalid configuration update: ${validationResult.error.message}`);
    }

    this.config = validationResult.data;
    console.log('✅ Configuration updated successfully');

    // Notify watchers
    this.notifyWatchers();
  }

  onConfigChange(callback: () => void): void {
    this.watchers.push(callback);
  }

  private notifyWatchers(): void {
    this.watchers.forEach((callback) => callback());
  }

  enableHotReload(): void {
    if (!this.configPath || !existsSync(this.configPath)) {
      console.warn('⚠️ Hot reload not enabled: no config file path');
      return;
    }

    try {
      const watcher = watch(this.configPath);

      void (async () => {
        for await (const event of watcher) {
          if (event.eventType === 'change') {
            console.log('🔄 Configuration file changed, reloading...');
            try {
              await this.loadConfig(this.configPath);
              this.notifyWatchers();
            } catch (error) {
              console.error('❌ Failed to reload configuration:', error);
            }
          }
        }
      })();

      console.log('✅ Hot reload enabled for configuration');
    } catch (error) {
      console.error('❌ Failed to enable hot reload:', error);
    }
  }
}
