import { ConfigurationManager } from '../config/manager.js';
import { KeychainStore } from './KeychainStore.js';
import type { KiroOAuthAccount } from '../config/schema.js';
import type { OAuthTokens } from '../types/kiro-oauth.types.js';
import { generateAccountId } from '../cli/utils/security.js';

export function generateKiroAccountId(profileArn: string): string {
  return generateAccountId(profileArn);
}

export async function extractProfileArnFromToken(accessToken: string): Promise<string> {
  const parts = accessToken.split('.');

  if (parts.length !== 3) {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(accessToken).digest('hex').substring(0, 16);
    return `arn:aws:codewhisperer:us-east-1:000000000000:profile/${hash}`;
  }

  const payload = parts[1];
  let paddedPayload = payload;
  while (paddedPayload.length % 4) {
    paddedPayload += '=';
  }

  const decoded = Buffer.from(paddedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const claims = JSON.parse(decoded);

  const profileArn =
    claims.profile_arn ||
    claims.profileArn ||
    claims['custom:profile_arn'] ||
    claims.arn ||
    claims.sub;

  if (!profileArn) {
    const crypto = await import('crypto');
    const identifier = claims.sub || crypto.createHash('sha256').update(accessToken).digest('hex').substring(0, 16);
    return `arn:aws:codewhisperer:us-east-1:000000000000:profile/${identifier}`;
  }

  if (profileArn.startsWith('arn:')) {
    return profileArn;
  }

  return `arn:aws:codewhisperer:us-east-1:000000000000:profile/${profileArn}`;
}

export async function storeKiroOAuthAccount(data: {
  configManager: ConfigurationManager;
  keychainStore: KeychainStore;
  configPath: string;
  region: string;
  profileArn: string;
  tokens: OAuthTokens;
  clientId?: string;
  clientSecret?: string;
  accountId?: string;
}): Promise<KiroOAuthAccount> {
  const { configManager, keychainStore, configPath, region, profileArn, tokens, clientId, clientSecret } = data;
  const accountId = data.accountId || generateKiroAccountId(profileArn);

  await configManager.loadConfig(configPath);
  const config = configManager.getConfig();

  await keychainStore.store(accountId, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt.toISOString(),
    clientId,
    clientSecret,
  });

  const accountMetadata: KiroOAuthAccount = {
    id: accountId,
    provider: 'kiro-oauth',
    region: region as KiroOAuthAccount['region'],
    profileArn,
    expiresAt: tokens.expiresAt.toISOString(),
    lastUsed: Date.now(),
    requestCount: 0,
    errorCount: 0,
    priority: 0,
  };

  const accountIndex = config.accounts.findIndex((account) => account.id === accountId);
  if (accountIndex >= 0) {
    config.accounts[accountIndex] = accountMetadata;
  } else {
    config.accounts.push(accountMetadata);
  }

  await configManager.saveConfig(config);
  return accountMetadata;
}
