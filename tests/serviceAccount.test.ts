import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceAccountError, serverStoreStatus } from '../lib/serverStore.js';

/**
 * The service-account value arrives by copy-paste through a hosting UI, which is
 * exactly where values acquire wrapping quotes, get double-encoded, or get
 * truncated. The original parser decided "JSON or base64?" by checking for a
 * leading brace, so anything else was fed to Node's base64 decoder — which
 * discards characters outside its alphabet rather than failing, turning a
 * configuration mistake into `Unexpected token '~'` from deep inside a webhook.
 */

const KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEAtestkeymaterialonly',
  '-----END PRIVATE KEY-----',
  ''
].join('\n');

const account = () => ({
  type: 'service_account',
  project_id: 'hyper-flow-a459b',
  client_email: 'sa@hyper-flow-a459b.iam.gserviceaccount.com',
  private_key: KEY
});

const original = process.env.FIREBASE_SERVICE_ACCOUNT;
const setValue = (v: string | undefined) => {
  if (v === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = v;
};

// serverStoreStatus memoises, so each case runs in its own process-free check by
// clearing the cache through the module's own entry point.
const statusFor = async (value: string | undefined) => {
  setValue(value);
  const mod = await import(`../lib/serverStore.js?case=${Math.random()}`);
  return mod.serverStoreStatus();
};

afterEach(() => setValue(original));

describe('FIREBASE_SERVICE_ACCOUNT parsing', () => {
  test('accepts the JSON exactly as downloaded', async () => {
    const s = await statusFor(JSON.stringify(account()));
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts JSON with the newlines escaped, as single-line env vars store it', async () => {
    const raw = JSON.stringify({ ...account(), private_key: KEY.replace(/\n/g, '\\n') });
    const s = await statusFor(raw);
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts base64', async () => {
    const s = await statusFor(Buffer.from(JSON.stringify(account())).toString('base64'));
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts base64 that arrived wrapped across lines', async () => {
    const b64 = Buffer.from(JSON.stringify(account())).toString('base64');
    const wrapped = (b64.match(/.{1,76}/g) || []).join('\n');
    const s = await statusFor(wrapped);
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts base64url', async () => {
    const s = await statusFor(Buffer.from(JSON.stringify(account())).toString('base64url'));
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts a value that was JSON-encoded a second time', async () => {
    const s = await statusFor(JSON.stringify(JSON.stringify(account())));
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts a value a shell wrapped in single quotes', async () => {
    const s = await statusFor(`'${JSON.stringify(account())}'`);
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts a value wrapped in double quotes without escaping the inner ones', async () => {
    const s = await statusFor(`"${JSON.stringify(account())}"`);
    assert.equal(s.ok, true, s.reason);
  });

  test('accepts leading and trailing whitespace', async () => {
    const s = await statusFor(`\n  ${JSON.stringify(account())}  \n`);
    assert.equal(s.ok, true, s.reason);
  });
});

describe('FIREBASE_SERVICE_ACCOUNT failures explain themselves', () => {
  test('unset says so', async () => {
    const s = await statusFor(undefined);
    assert.equal(s.ok, false);
    assert.match(s.reason!, /is not set/);
  });

  test('arbitrary text is not silently base64-decoded into noise', async () => {
    const s = await statusFor('this is definitely not a service account key at all');
    assert.equal(s.ok, false);
    assert.doesNotMatch(s.reason!, /Unexpected token/, 'should not surface a raw JSON parse error');
    assert.match(s.reason!, /FIREBASE_SERVICE_ACCOUNT/);
  });

  test('a bare private key is identified as such', async () => {
    const s = await statusFor(KEY);
    assert.equal(s.ok, false);
    assert.match(s.reason!, /bare private key/i);
  });

  test('a file path is identified as such', async () => {
    const s = await statusFor('/Users/me/Downloads/hyper-flow-a459b-firebase-adminsdk.json');
    assert.equal(s.ok, false);
    assert.match(s.reason!, /file path/i);
  });

  test('the web app config is rejected for missing fields', async () => {
    const s = await statusFor(JSON.stringify({ apiKey: 'AIza...', projectId: 'hyper-flow-a459b', appId: '1:2:web:3' }));
    assert.equal(s.ok, false);
    assert.match(s.reason!, /client_email/);
    assert.match(s.reason!, /private_key/);
  });

  test('a truncated private key is called out', async () => {
    const s = await statusFor(JSON.stringify({ ...account(), private_key: 'MIIBVgIBADANBgkq' }));
    assert.equal(s.ok, false);
    assert.match(s.reason!, /PEM/);
  });

  test('the reason never contains key material', async () => {
    const s = await statusFor(JSON.stringify({ ...account(), private_key: 'SUPERSECRETKEYMATERIAL' }));
    assert.equal(s.ok, false);
    assert.doesNotMatch(s.reason!, /SUPERSECRETKEYMATERIAL/);
  });

  test('a malformed value reports its shape, not its contents', async () => {
    const s = await statusFor('{"project_id": "x", broken');
    assert.equal(s.ok, false);
    assert.match(s.reason!, /looks like JSON/);
    assert.doesNotMatch(s.reason!, /broken/);
  });

  test('ServiceAccountError is exported for callers that want to distinguish it', () => {
    assert.equal(typeof ServiceAccountError, 'function');
  });
});
