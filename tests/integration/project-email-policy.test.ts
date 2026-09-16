import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, set } from 'firebase/database';

test('saved Firebase project switch gates real client dispatch and immediate disable', async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9010');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-hyperflow', client_email: 'fixture@demo-hyperflow.iam.gserviceaccount.com', private_key: privateKey });
  process.env.FIREBASE_DATABASE_URL = 'https://demo-hyperflow.firebaseio.com';
  delete process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE;
  delete process.env.EMAIL_SEND_POLICY_BY_TENANT;
  const env = await initializeTestEnvironment({ projectId: 'demo-hyperflow', database: { host: '127.0.0.1', port: 9010, rules: readFileSync('database.rules.json', 'utf8') } });
  const { HttpCommunicationsClient } = await import('../../lib/communications/client.js');
  const { getApps, deleteApp } = await import('firebase-admin/app');
  let sends = 0;
  const client = new HttpCommunicationsClient({ baseUrl: 'https://provider.invalid', apiKey: 'fixture', fetchImpl: async url => {
    if (String(url).endsWith('/tenant-policy/email')) return Response.json({ mode: 'allow_send', version: 'fixture' });
    sends++; return Response.json({ id: 'fixture-email' });
  } });
  const request: any = { to: ['fixture@example.invalid'], subject: 'Fixture', text: 'Fixture',
    correlation: { tenant_id: 'email_gate_fixture', external_project_id: 'project', run_id: 'run', task_id: 'task' } };
  const save = async (enabled?: boolean) => env.withSecurityRulesDisabled(async c => set(ref(c.database(), 'projects/email_gate_fixture/projects'),
    [{ id: 'project', name: 'Fixture', milestones: [], ...(enabled === undefined ? {} : { emailSendingEnabled: enabled }) }]));
  try {
    await save();
    await assert.rejects(client.sendEmail(request), (error: any) => error.status === 403);
    await save(true);
    await client.sendEmail(request);
    await save(false);
    await assert.rejects(client.sendEmail(request), (error: any) => error.status === 403);
    await assert.rejects(client.sendEmail({ ...request, correlation: { ...request.correlation, tenant_id: 'other_email_gate_fixture' } }), (error: any) => error.status === 403);
    assert.equal(sends, 1);
  } finally {
    await env.withSecurityRulesDisabled(async c => set(ref(c.database(), 'projects/email_gate_fixture'), null));
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
