import { DualAuthModeHandler } from '../DualAuthModeHandler';

describe('DualAuthModeHandler', () => {
  it('uses Kiro refreshToken endpoint for desktop/social credentials', () => {
    const handler = new DualAuthModeHandler();
    const mode = handler.detectMode({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    expect(mode.mode).toBe('kiro-desktop');
    expect(handler.getTokenEndpoint(mode.mode, 'us-east-1')).toBe(
      'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken'
    );
  });

  it('uses AWS OIDC token endpoint when client credentials are present', () => {
    const handler = new DualAuthModeHandler();
    const mode = handler.detectMode({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    expect(mode.mode).toBe('aws-sso');
    expect(handler.getTokenEndpoint(mode.mode, 'ap-southeast-1')).toBe(
      'https://oidc.ap-southeast-1.amazonaws.com/token'
    );
  });
});
