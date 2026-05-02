import { z } from 'zod';

export const ConfigSchema = z.object({
  server: z.object({
    port: z.number().int().positive().default(20129),
    host: z.string().default('0.0.0.0'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
  infrastructure: z.object({
    qdrant: z.object({
      url: z.string().url(),
    }),
    redis: z.object({
      url: z.string(),
    }),
    voyage: z.object({
      apiKey: z.string().min(1),
    }),
  }),
  accounts: z
    .array(
      z.object({
        id: z.string(),
        apiKey: z.string().min(1),
        provider: z.enum(['anthropic', 'bedrock', 'kiro']).default('anthropic'),
        baseURL: z.string().url().optional(),
        kiroConfig: z
          .object({
            machineId: z.string().min(1),
            mitmRouterUrl: z.string().url(),
            combo: z
              .object({
                accounts: z.array(z.string()).min(1),
                strategy: z.enum(['round-robin', 'sticky-round-robin']).default('round-robin'),
              })
              .optional(),
          })
          .optional(),
      })
    )
    .min(1),
  optimization: z.object({
    semanticDeduplication: z.object({
      enabled: z.boolean().default(true),
      similarityThreshold: z.number().min(0).max(1).default(0.95),
      cacheTTL: z.number().int().positive().default(86400), // 24 hours
    }),
    promptCaching: z.object({
      enabled: z.boolean().default(true),
      minTokens: z.number().int().positive().default(1024),
    }),
    thinkingBudget: z.object({
      enabled: z.boolean().default(true),
      simple: z.number().int().nonnegative().default(0),
      moderate: z.number().int().nonnegative().default(2000),
      complex: z.number().int().nonnegative().default(10000),
    }),
    contextCompression: z.object({
      enabled: z.boolean().default(true),
      minTokens: z.number().int().positive().default(8000),
      recentMessagesToKeep: z.number().int().positive().default(3),
    }),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export const defaultConfig: Config = {
  server: {
    port: 20129,
    host: '0.0.0.0',
    logLevel: 'info',
  },
  infrastructure: {
    qdrant: {
      url: 'http://localhost:6333',
    },
    redis: {
      url: 'redis://localhost:6379',
    },
    voyage: {
      apiKey: '',
    },
  },
  accounts: [],
  optimization: {
    semanticDeduplication: {
      enabled: true,
      similarityThreshold: 0.95,
      cacheTTL: 86400,
    },
    promptCaching: {
      enabled: true,
      minTokens: 1024,
    },
    thinkingBudget: {
      enabled: true,
      simple: 0,
      moderate: 2000,
      complex: 10000,
    },
    contextCompression: {
      enabled: true,
      minTokens: 8000,
      recentMessagesToKeep: 3,
    },
  },
};
