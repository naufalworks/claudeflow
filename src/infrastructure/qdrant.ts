import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantConfig {
  url: string;
}

export class QdrantClientWrapper {
  private client: QdrantClient;
  private connected: boolean = false;

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({ url: config.url });
  }

  async connect(): Promise<void> {
    try {
      // Test connection by getting cluster info
      await this.client.getCollections();
      this.connected = true;
      console.log('✅ Qdrant connected successfully');
    } catch (error) {
      this.connected = false;
      console.warn('⚠️ Qdrant unavailable; semantic cache disabled until Qdrant starts.');
      return;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  getClient(): QdrantClient {
    return this.client;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async ensureCollection(collectionName: string, vectorSize: number): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === collectionName);

      if (!exists) {
        await this.client.createCollection(collectionName, {
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
        });
        console.log(`✅ Created Qdrant collection: ${collectionName}`);
      }
    } catch (error) {
      this.connected = false;
      console.warn(`⚠️ Qdrant collection ${collectionName} not ready; semantic cache disabled until Qdrant starts.`);
      return;
    }
  }
}
