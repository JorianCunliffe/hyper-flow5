import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { ref, set, get, remove } from 'firebase/database';

test('draft linkage survives real cold transactions, concurrent recovery and browser isolation', async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9010');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-hyperflow', client_email: 'fixture@demo-hyperflow.iam.gserviceaccount.com', private_key: privateKey });
  process.env.FIREBASE_DATABASE_URL = 'https://demo-hyperflow.firebaseio.com';
  const env = await initializeTestEnvironment({ projectId: 'demo-hyperflow', database: { host: '127.0.0.1', port: 9010, rules: readFileSync('database.rules.json', 'utf8') } });
  const { getApps, deleteApp } = await import('firebase-admin/app');
  const store = await import('../../lib/serverStore.js');
  const tenant = 'draft_recovery_fixture';
  const path = `triage_items/${tenant}/email`;
  const seed = { id: 'email', communicationId: 'email', orgId: tenant, channel: 'email', disposition: 'needs_review', audit: [{ at: 1, actor: 'fixture', action: 'received' }] };
  const inspect = async () => {
    let value: any;
    await env.withSecurityRulesDisabled(async c => { value = (await get(ref(c.database(), path))).val(); });
    return value;
  };
  try {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async c => {
      await set(ref(c.database(), path), seed);
      await set(ref(c.database(), `organizations/${tenant}/members/member`), { role: 'owner' });
    });
    // No prior server-store read: this exercises the initial null cache.
    const recovered = await Promise.all(Array.from({ length: 4 }, () => store.recoverTriageDraftLink(tenant, 'email', 'email', 'gmail', 'r-123', 'fixture')));
    assert.ok(recovered.every(item => item?.providerDraftId === 'r-123'));
    let saved = await inspect();
    assert.equal(saved.connectionId, 'gmail');
    assert.equal(saved.disposition, 'needs_review');
    assert.equal(Object.values<any>(saved.audit).filter(e => e.action === 'draft:link_recovered').length, 1);
    assert.equal(await store.recoverTriageDraftLink(tenant, 'email', 'email', 'outlook', 'other', 'fixture'), null);
    assert.equal((await inspect()).providerDraftId, 'r-123');
    await Promise.all(getApps().map(deleteApp));
    await store.patchTenantTriageItem(tenant, 'email', { proposedAction: 'Review existing draft' }, 'fixture', 'review');
    await Promise.all(getApps().map(deleteApp));
    await store.setTenantTriageDisposition(tenant, 'email', 'draft_prepared', 'fixture');
    saved = await inspect();
    assert.equal(saved.proposedAction, 'Review existing draft');
    assert.equal(saved.disposition, 'draft_prepared');
    for (const browser of [env.unauthenticatedContext().database(), env.authenticatedContext('member').database()]) {
      await assertFails(set(ref(browser, path), { ...seed, providerDraftId: 'forged' }));
    }
    await env.withSecurityRulesDisabled(c => remove(ref(c.database(), path)));
    await Promise.all(getApps().map(deleteApp));
    assert.equal(await store.recoverTriageDraftLink(tenant, 'email', 'email', 'gmail', 'r-123', 'fixture'), null);
    assert.equal(await inspect(), null);
  } finally {
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
