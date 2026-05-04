import { z } from 'zod';

/**
 * CRITICAL REQUIREMENT: Raw Anthropic Format Only
 * 
 * ClaudeFlow ONLY supports sources that provide raw Anthropic API responses.
 * NO format conversion is supported anywhere in the system.
 * 
 * Supported account types:
 * - Direct Anthropic: Raw Anthropic format from api.anthropic.com
 * - Proxy: Anthropic-compatible proxies that forward raw Anthropic format unchanged (NOT 9router)
 * - OAuth: Raw Anthropic format with OAuth authentication (backward compatibility)
 */

// Direct Anthropic account schema
const AnthropicAccountSchema = z.object({
  id: z.string(),
  provider: z.literal('anthropic'),
  apiKey: z.string().min(1),
  lastUsed: z.number().optional(),
  requestCount: z.number().optional(),
});

// Proxy account schema (for Anthropic-compatible proxies ONLY)
// IMPORTANT: Proxy MUST forward raw Anthropic format unchanged
// NOT for 9router (it converts to OpenAI format)
const ProxyAccountSchema = z.object({
  id: z.string(),
  provider: z.literal('proxy'),
  apiKey: z.string().min(1),
  baseURL: z.string().url(),
  lastUsed: z.number().optional(),
  requestCount: z.number().optional(),
});

// OAuth account schema (backward compatibility)
const OAuthAccountSchema = z.object({
  id: z.string(),
  provider: z.literal('kiro'),
  apiKey: z.string().min(1),
  kiroConfig: z.object({
    machineId: z.string().min(1),
    mitmRouterUrl: z.string().url(),
    sessionToken: z.string().optional(),
    sessionExpiry: z.date().optional(),
    combo: z
      .object({
        accounts: z.array(z.string()).min(1),
        strategy: z.enum(['round-robin', 'sticky-round-robin']),
      })
      .optional(),
  }),
  lastUsed: z.number().optional(),
  requestCount: z.number().optional(),
});

// Discriminated union for type-safe account configuration
const AccountSchema = z.discriminatedUnion('provider', [
  AnthropicAccountSchema,
  ProxyAccountSchema,
  OAuthAccountSchema,
]);

// Export individual account types
export type AnthropicAccount = z.infer<typeof AnthropicAccountSchema>;
export type ProxyAccount = z.infer<typeof ProxyAccountSchema>;
export type OAuthAccount = z.infer<typeof OAuthAccountSchema>;
export type Account = z.infer<typeof AccountSchema>;

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
  accounts: z.array(AccountSchema).min(1),
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
