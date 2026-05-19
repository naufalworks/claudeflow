import { z } from 'zod';

/**
 * CRITICAL REQUIREMENT: Anthropic client contract
 *
 * ClaudeFlow exposes Anthropic-compatible requests and responses to clients.
 * Providers may use native adapters internally.
 *
 * Supported account types:
 * - Direct Anthropic: Raw Anthropic format from api.anthropic.com
 * - Proxy: Anthropic-compatible proxies that forward raw Anthropic format unchanged (NOT 9router)
 * - Kiro OAuth: Native Kiro API adapted to Anthropic format
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

// OAuth account schema (backward compatibility - LEGACY 9router-based)
// DEPRECATED: This is the old format using 9router which converts Anthropic to OpenAI format
// New implementations should use KiroOAuthAccountSchema instead
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

// Kiro OAuth account schema (NEW - direct Kiro OAuth, no 9router)
// This replaces the legacy OAuthAccountSchema with direct OAuth 2.0 + PKCE authentication
// Sensitive credentials (tokens, secrets) are stored in OS keychain, NOT in this schema
const KiroOAuthAccountSchema = z
  .object({
    id: z.string().regex(/^kiro-[a-f0-9]+$/, 'Must be format: kiro-{hash}'),
    provider: z.literal('kiro-oauth'),
    region: z.enum(['us-east-1', 'us-west-2', 'eu-central-1', 'ap-southeast-1']),
    profileArn: z
      .string()
      .regex(
        /^arn:aws:codewhisperer:[a-z0-9-]+:[0-9]+:profile\/[a-zA-Z0-9-]+$/,
        'Must be valid AWS ARN for CodeWhisperer profile'
      ),
    expiresAt: z.string().datetime(),
    lastUsed: z.number().optional().default(0),
    requestCount: z.number().int().nonnegative().optional().default(0),
    errorCount: z.number().int().nonnegative().optional().default(0),
    priority: z.number().int().min(0).max(100).optional().default(0),
  })
  .strict();

// Discriminated union for type-safe account configuration
const AccountSchema = z.discriminatedUnion('provider', [
  AnthropicAccountSchema,
  ProxyAccountSchema,
  OAuthAccountSchema,
  KiroOAuthAccountSchema,
]);

// Export individual account types
export type AnthropicAccount = z.infer<typeof AnthropicAccountSchema>;
export type ProxyAccount = z.infer<typeof ProxyAccountSchema>;
export type OAuthAccount = z.infer<typeof OAuthAccountSchema>;
export type KiroOAuthAccount = z.infer<typeof KiroOAuthAccountSchema>;
export type Account = z.infer<typeof AccountSchema>;

// Case-insensitive log level enum
const LogLevelSchema = z
  .enum(['debug', 'info', 'warn', 'error'])
  .transform((val) => val.toLowerCase());

export const ConfigSchema = z.object({
  server: z.object({
    port: z.number().int().positive().default(20129),
    host: z.string().default('0.0.0.0'),
    logLevel: LogLevelSchema.default('info'),
  }),
  infrastructure: z.object({
    qdrant: z.object({
      url: z.string().url(),
    }),
    redis: z.object({
      url: z.string(),
    }),
    voyage: z.object({
      apiKey: z.string().optional().default(''),
    }),
  }),
  accounts: z.array(AccountSchema).default([]),
  routing: z
    .object({
      strategy: z
        .enum(['weighted-score', 'round-robin', 'sticky-round-robin'])
        .default('weighted-score'),
      stickyLimit: z.number().int().positive().default(3), // requests per account before switching
    })
    .default({
      strategy: 'weighted-score',
      stickyLimit: 3,
    }),
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

export {
  AnthropicAccountSchema,
  ProxyAccountSchema,
  OAuthAccountSchema,
  KiroOAuthAccountSchema,
  AccountSchema,
};

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
  routing: {
    strategy: 'weighted-score',
    stickyLimit: 3,
  },
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
