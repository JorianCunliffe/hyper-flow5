import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface GoogleOAuthState {
  tenantId: string;
  uid: string;
  nonce: string;
  exp: number;
  returnTo: string;
}

export interface GoogleTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  token_type?: string;
}

export const googleRedirectUri = (): string => {
  const configured = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('GOOGLE_OAUTH_REDIRECT_URI or PUBLIC_BASE_URL is required');
  return `${base}/api/integrations/google/callback`;
};

const stateSecret = (): string => {
  const value = String(process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.INTEGRATION_ENCRYPTION_KEY || '').trim();
  if (value.length < 32) throw new Error('GOOGLE_OAUTH_STATE_SECRET must contain at least 32 characters');
  return value;
};

const signStatePayload = (payload: string): string =>
  createHmac('sha256', stateSecret()).update(payload).digest('base64url');

export const createGoogleOAuthState = (
  tenantId: string,
  uid: string,
  returnTo = '/'
): string => {
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  const value: GoogleOAuthState = {
    tenantId, uid, nonce: randomUUID(), exp: Date.now() + 10 * 60_000, returnTo: safeReturnTo
  };
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${signStatePayload(payload)}`;
};

export const verifyGoogleOAuthState = (state: string): GoogleOAuthState => {
  const [payload, signature, extra] = String(state || '').split('.');
  if (!payload || !signature || extra) throw new Error('Invalid OAuth state');
  const expected = Buffer.from(signStatePayload(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid OAuth state');
  let value: GoogleOAuthState;
  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid OAuth state');
  }
  if (!value.tenantId || !value.uid || !value.nonce || Number(value.exp) <= Date.now()) throw new Error('Expired OAuth state');
  return value;
};

const googleClient = (): { clientId: string; clientSecret: string } => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Google OAuth client is not configured');
  return { clientId, clientSecret };
};

export const googleWorkspaceScopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly'
];

export const googleAuthorizationUrl = (state: string): string => {
  const { clientId } = googleClient();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: googleWorkspaceScopes.join(' '),
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
};

export const exchangeGoogleCode = async (code: string): Promise<GoogleTokenSet> => {
  const { clientId, clientSecret } = googleClient();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code'
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || !body.access_token) throw new Error(`Google OAuth token exchange failed (${response.status})`);
  return { ...body, expires_at: Date.now() + Number(body.expires_in || 3600) * 1000 };
};

export const refreshGoogleToken = async (refreshToken: string): Promise<GoogleTokenSet> => {
  const { clientId, clientSecret } = googleClient();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || !body.access_token) throw new Error(`Google OAuth token refresh failed (${response.status})`);
  return { ...body, refresh_token: refreshToken, expires_at: Date.now() + Number(body.expires_in || 3600) * 1000 };
};

export const googleAccountEmail = async (accessToken: string): Promise<string> => {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || !body.email || body.email_verified === false) throw new Error('Google account identity could not be verified');
  return String(body.email).trim().toLowerCase();
};
