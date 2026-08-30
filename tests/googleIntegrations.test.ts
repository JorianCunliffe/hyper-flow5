import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openCredential, sealCredential } from '../lib/integrations/credentialCrypto';
import {
  createGoogleOAuthState,
  googleAuthorizationUrl,
  verifyGoogleOAuthState
} from '../lib/integrations/googleOAuth';
import { GOOGLE_SHEET_VALUE_INPUT_OPTION, googleWorkspaceConnectionId } from '../lib/integrations/googleWorkspace';
import { consumeOAuthStateNonceAtRef, normalizeWorkspaceResourceGrant } from '../lib/serverStore';

const envBefore = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
  Object.assign(process.env, envBefore);
});

describe('encrypted integration credentials', () => {
  test('round-trips with authenticated encryption and rejects tampering', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const sealed = sealCredential({ refreshToken: 'secret', account: 'coach@example.com' });
    assert.notEqual(sealed.ciphertext.includes('secret'), true);
    assert.deepEqual(openCredential(sealed), { refreshToken: 'secret', account: 'coach@example.com' });
    const tampered = `${sealed.ciphertext[0] === 'A' ? 'B' : 'A'}${sealed.ciphertext.slice(1)}`;
    assert.throws(() => openCredential({ ...sealed, ciphertext: tampered }), /authenticate|Unsupported|bad decrypt/i);
  });

  test('fails closed on a human password or truncated deployment value', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'password';
    assert.throws(() => sealCredential({ token: 'x' }), /32 random bytes/);
  });
});

describe('Google OAuth state and authorization', () => {
  test('binds a short-lived state to tenant and user and rejects tampering', () => {
    process.env.GOOGLE_OAUTH_STATE_SECRET = '0123456789abcdef0123456789abcdef';
    const state = createGoogleOAuthState('org_1', 'user_1', '/?settings=1');
    const verified = verifyGoogleOAuthState(state);
    assert.equal(verified.tenantId, 'org_1');
    assert.equal(verified.uid, 'user_1');
    assert.equal(verified.returnTo, '/?settings=1');
    assert.throws(() => verifyGoogleOAuthState(`${state.slice(0, -1)}x`), /Invalid OAuth state/);
  });

  test('builds an offline Google consent request for Docs, Sheets, and Drive metadata', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://hyperflow.example/api/integrations/google/callback';
    const url = new URL(googleAuthorizationUrl('signed-state'));
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    const scope = url.searchParams.get('scope') || '';
    assert.match(scope, /documents\.readonly/);
    assert.match(scope, /spreadsheets/);
    assert.match(scope, /drive\.metadata\.readonly/);
  });

  test('checks callback membership with user ID before tenant ID in both runtimes', () => {
    for (const path of ['../api/communications/status.ts', '../server.ts']) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      assert.match(source, /requireOrganizationMember\(state\.uid, state\.tenantId\)/);
      assert.doesNotMatch(source, /requireOrganizationMember\(state\.tenantId, state\.uid\)/);
    }
  });

  test('claims an unconsumed server nonce even when the transaction cache starts empty', async () => {
    const now = 1_788_000_000_000;
    let consumedAt: number | null = null;
    const ref = {
      get: async () => ({
        exists: () => true,
        val: () => ({ uid: 'user_1', expiresAt: now + 60_000 })
      }),
      child: (path: string) => {
        assert.equal(path, 'consumedAt');
        return {
          transaction: async (update: (current: any) => any) => {
            consumedAt = update(consumedAt);
            return { committed: consumedAt !== undefined };
          }
        };
      }
    };

    assert.equal(await consumeOAuthStateNonceAtRef(ref, 'user_1', now), true);
    assert.equal(consumedAt, now);
  });

  test('rejects replay, expiry, and the wrong user before claiming a nonce', async () => {
    const now = 1_788_000_000_000;
    let transactionCalls = 0;
    const refFor = (state: Record<string, unknown>) => ({
      get: async () => ({ exists: () => true, val: () => state }),
      child: () => ({
        transaction: async () => {
          transactionCalls += 1;
          return { committed: true };
        }
      })
    });

    assert.equal(await consumeOAuthStateNonceAtRef(refFor({
      uid: 'user_1', expiresAt: now + 60_000, consumedAt: now - 1
    }), 'user_1', now), false);
    assert.equal(await consumeOAuthStateNonceAtRef(refFor({
      uid: 'user_1', expiresAt: now
    }), 'user_1', now), false);
    assert.equal(await consumeOAuthStateNonceAtRef(refFor({
      uid: 'user_2', expiresAt: now + 60_000
    }), 'user_1', now), false);
    assert.equal(transactionCalls, 0);
  });
});

describe('Google Workspace tenant grants', () => {
  test('writes imported and model-produced values as data, never formulas', () => {
    assert.equal(GOOGLE_SHEET_VALUE_INPUT_OPTION, 'RAW');
  });

  test('uses stable opaque connection IDs and validates allowlisted resources', () => {
    assert.equal(googleWorkspaceConnectionId('Coach@Example.com'), googleWorkspaceConnectionId('coach@example.com'));
    const grant = normalizeWorkspaceResourceGrant('project_1', {
      connectionId: 'google_123', documentId: 'doc_1234567890',
      spreadsheetId: 'sheet_1234567890', sheetRange: 'Coaching!A:G'
    });
    assert.equal(grant.projectId, 'project_1');
    assert.equal(grant.sheetRange, 'Coaching!A:G');
    assert.throws(() => normalizeWorkspaceResourceGrant('project_1', {
      connectionId: 'google_123', documentId: '../bad'
    }), /Invalid Google resource/);
  });
});

describe('integration connection identity separation', () => {
  test('selecting a mailbox cannot overwrite the Communications provider connection', () => {
    const source = readFileSync(new URL('../components/modals/SettingsModal.tsx', import.meta.url), 'utf8');
    const mailboxHandler = source.match(/<select id="mailbox-connection"[^>]+>/)?.[0] || '';
    assert.match(mailboxHandler, /mailboxConnectionId/);
    assert.doesNotMatch(mailboxHandler, /\bconnectionId\s*:/);
  });
});
