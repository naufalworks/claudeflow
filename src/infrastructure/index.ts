import { QdrantClientWrapper, type QdrantConfig } from './qdrant.js';
import { RedisClientWrapper, type RedisConfig } from './redis.js';
import { VoyageClient, type VoyageConfig } from './voyage.js';
import { AnthropicClientWrapper, type AnthropicConfig } from './anthropic.js';
import { KeychainStore } from '../auth/KeychainStore.js';

export { QdrantClientWrapper, type QdrantConfig } from './qdrant.js';
export { RedisClientWrapper, type RedisConfig } from './redis.js';
export { VoyageClient, type VoyageConfig } from './voyage.js';
export { AnthropicClientWrapper, type AnthropicConfig } from './anthropic.js';

export interface InfrastructureClients {
  qdrant: QdrantClientWrapper;
  redis: RedisClientWrapper;
  voyage: VoyageClient;
  anthropic: AnthropicClientWrapper;
  keychain: KeychainStore;
}

export async function initializeInfrastructure(config: {
  qdrant: QdrantConfig;
  redis: RedisConfig;
  voyage: VoyageConfig;
  anthropic?: AnthropicConfig;
}): Promise<InfrastructureClients> {
  console.log('🚀 Initializing infrastructure...');

  const qdrant = new QdrantClientWrapper(config.qdrant);
  const redis = new RedisClientWrapper(config.redis);
  const voyage = new VoyageClient(config.voyage);
  const anthropic = new AnthropicClientWrapper(config.anthropic || { apiKey: 'not-configured' });
  const keychain = new KeychainStore();

  // Connect to services
  await Promise.all([qdrant.connect(), redis.connect()]);

  // Ensure Qdrant collection exists
  await qdrant.ensureCollection('claudeflow_prompts', 1024); // Voyage-2 embedding size

  console.log('✅ Infrastructure initialized successfully');

  return { qdrant, redis, voyage, anthropic, keychain };
}

export async function healthCheckAll(clients: InfrastructureClients): Promise<{
  qdrant: boolean;
  redis: boolean;
  voyage: boolean;
  anthropic: boolean;
  overall: boolean;
}> {
  const [qdrant, redis, voyage, anthropic] = await Promise.all([
    clients.qdrant.healthCheck(),
    clients.redis.healthCheck(),
    clients.voyage.healthCheck(),
    clients.anthropic.healthCheck(),
  ]);

  return {
    qdrant,
    redis,
    voyage,
    anthropic,
    overall: qdrant && redis && voyage && anthropic,
  };
}
