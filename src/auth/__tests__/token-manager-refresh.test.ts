import { TokenManager } from '../TokenManager';
import { KeychainStore } from '../KeychainStore';
import { DualAuthModeHandler } from '../DualAuthModeHandler';
import { ConfigurationManager } from '../../config/manager';

describe('TokenManager refresh requests', () => {
  let manager: TokenManager;
  let post: jest.Mock;

  beforeEach(() => {
    manager = new TokenManager(
      new KeychainStore(),
      new DualAuthModeHandler(),
      new ConfigurationManager()
    );
    post = jest.fn().mockResolvedValue({ data: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 } });
    (manager as any).httpClient.post = post;
  });

  it('sends Kiro desktop refresh as JSON refreshToken', async () => {
    await (manager as any).makeRefreshRequest(
      'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken',
      {
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh',
      }
    );

    expect(post).toHaveBeenCalledWith(
      'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken',
      { refreshToken: 'old-refresh' },
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'kiro-cli/1.0.0',
        }),
      })
    );
  });

  it('sends AWS OIDC refresh as camelCase JSON body', async () => {
    await (manager as any).makeRefreshRequest(
      'https://oidc.us-east-1.amazonaws.com/token',
      {
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh',
        client_id: 'client-id',
        client_secret: 'client-secret',
      }
    );

    expect(post).toHaveBeenCalledWith(
      'https://oidc.us-east-1.amazonaws.com/token',
      {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'old-refresh',
        grantType: 'refresh_token',
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });
});
