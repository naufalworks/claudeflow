import axios, { AxiosInstance } from 'axios';

export interface VoyageConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

export class VoyageClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(config: VoyageConfig) {
    this.apiKey = config.apiKey;
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.voyageai.com/v1',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 30000,
    });
  }

  async embed(texts: string | string[], model: string = 'voyage-2'): Promise<number[][]> {
    try {
      const input = Array.isArray(texts) ? texts : [texts];

      const response = await this.client.post<EmbeddingResponse>('/embeddings', {
        input,
        model,
      });

      return response.data.data.map((item) => item.embedding);
    } catch (error) {
      console.error('❌ Voyage AI embedding failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Test with a simple embedding
      await this.embed('test');
      return true;
    } catch {
      return false;
    }
  }
}
