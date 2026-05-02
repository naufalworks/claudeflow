import Redis from 'ioredis';

export interface RedisConfig {
  url: string;
}

export class RedisClientWrapper {
  private client: Redis;
  private connected: boolean = false;

  constructor(config: RedisConfig) {
    this.client = new Redis(config.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    });

    this.client.on('connect', () => {
      this.connected = true;
      console.log('✅ Redis connected successfully');
    });

    this.client.on('error', (error) => {
      this.connected = false;
      console.error('❌ Redis connection error:', error);
    });

    this.client.on('close', () => {
      this.connected = false;
      console.log('⚠️ Redis connection closed');
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.ping();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  getClient(): Redis {
    return this.client;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
