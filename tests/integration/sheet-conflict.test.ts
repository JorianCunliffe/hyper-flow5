import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

test('Sheet planning snapshots hold changed, deleted and newly inserted rows with durable receipts', async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9010');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-hyperflow', client_email: 'fixture@demo-hyperflow.iam.gserviceaccount.com', private_key: privateKey });
  process.env.FIREBASE_DATABASE_URL = 'https://demo-hyperflow.firebaseio.com';
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
  const env = await initializeTestEnvironment({ projectId: 'demo-hyperflow', database: { host: '127.0.0.1', port: 9010, rules: readFileSync('database.rules.json', 'utf8') } });
  const { getApps, deleteApp } = await import('firebase-admin/app');
  const store = await import('../../lib/serverStore.js');
  const google = await import('../../lib/integrations/googleWorkspace.js');
  const originalFetch = globalThis.fetch;
  const tenant = 'sheet_conflict_fixture';
  let rows: unknown[][] = [];
  const writes: Array<{ method: string; body: any }> = [];
  let loseWriteResponse = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://sheets.googleapis.com/')) return originalFetch(input, init);
    if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ values: rows }));
    writes.push({ method: init.method, body: JSON.parse(String(init.body)) });
    if (loseWriteResponse) throw new Error('Provider accepted write but response was lost');
    return new Response(JSON.stringify({ updatedRows: 1 }));
  };
  const update = (key: string, expected: unknown[] | null) => google.upsertGrantedGoogleSheet(
    tenant, 'morning', key, 0, 'enquirer@example.test', ['enquirer@example.test', 'booked', 'false'], expected);
  try {
    await env.clearDatabase();
    const connectionId = await google.storeGoogleWorkspaceCredential(tenant, {
      tokens: { access_token: 'fixture-only', expires_at: Date.now() + 3_600_000 }, accountEmail: 'fixture@example.test', scopes: []
    });
    await store.saveWorkspaceResourceGrant(tenant, 'morning', { connectionId, spreadsheetId: 'fixture_sheet_12345', sheetRange: 'Enquiries!A2:C' });
    const baseline = ['enquirer@example.test', 'pending', 'false'];
    rows = [['enquirer@example.test', 'attended', 'true']];
    await assert.rejects(update('changed', baseline), /row changed since planning/);
    await Promise.all(getApps().map(deleteApp));
    await assert.rejects(update('changed', baseline), /row changed since planning/);
    assert.equal(writes.length, 0, 'cold retry must not overwrite attended state');
    await assert.rejects(update('changed', rows[0]), /different action content/);
    rows = [];
    await assert.rejects(update('deleted', baseline), /row changed since planning/);
    rows = [baseline];
    await assert.rejects(update('inserted', null), /row changed since planning/);
    rows = [baseline, baseline];
    await assert.rejects(update('duplicate', baseline), /ambiguous/);
    assert.equal(writes.length, 0);
    rows = [baseline];
    await update('unchanged', [...baseline, '', null]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'PUT');
    await Promise.all(getApps().map(deleteApp));
    rows = [['enquirer@example.test', 'new human edit', 'true']];
    await update('unchanged', [...baseline, '', null]);
    assert.equal(writes.length, 1, 'completed operation returns receipt without replaying its write');
    rows = [];
    await update('new', null);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].method, 'POST');
    await assert.rejects(update('invalid', {} as any), /expected_row must/);
    loseWriteResponse = true;
    await assert.rejects(google.appendGrantedGoogleSheet(tenant, 'morning', 'lost-response', [['one slot']]), /response was lost/);
    const acceptedWrites = writes.length;
    await Promise.all(getApps().map(deleteApp));
    await assert.rejects(google.appendGrantedGoogleSheet(tenant, 'morning', 'lost-response', [['one slot']]), /review the saved Sheet operation/);
    assert.equal(writes.length, acceptedWrites, 'ambiguous failure must not duplicate an accepted append');
    const abandoned = { id: 'old-worker', orgId: tenant, projectId: 'morning', kind: 'google_sheet_append',
      idempotencyKey: 'expired', requestHash: 'same', status: 'running' as const, startedAt: 1 };
    await store.claimExternalActionReceipt(abandoned);
    const { getDatabase } = await import('firebase-admin/database');
    const runtimeApp = getApps().find(app => app.name === 'hyperflow-server');
    assert.ok(runtimeApp);
    await getDatabase(runtimeApp).ref(`external_action_receipts/${tenant}/expired/startedAt`).set(1);
    await Promise.all(getApps().map(deleteApp));
    const expired = await store.claimExternalActionReceipt({ ...abandoned, id: 'new-worker' });
    assert.equal(expired.duplicate, true);
    assert.equal(expired.receipt.id, 'old-worker', 'lease expiry cannot authorize another provider write');
  } finally {
    globalThis.fetch = originalFetch;
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
