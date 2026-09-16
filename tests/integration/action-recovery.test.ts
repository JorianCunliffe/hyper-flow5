import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';
import { NodeType, type TenantSchedule } from '../../types.js';
import { action, project } from '../helpers.js';

test('real runtime rules: concurrent schedule, stale projection, callback races and replay produce one call', async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9010');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-hyperflow', client_email: 'fixture@demo-hyperflow.iam.gserviceaccount.com', private_key: privateKey });
  process.env.FIREBASE_DATABASE_URL = 'https://demo-hyperflow.firebaseio.com';
  process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE = 'true';
  const env = await initializeTestEnvironment({ projectId: 'demo-hyperflow', database: {
    host: '127.0.0.1', port: 9010, rules: readFileSync('database.rules.json', 'utf8') } });
  const { getApps, deleteApp } = await import('firebase-admin/app');
  const { runTenantSchedule } = await import('../../lib/scheduler.js');
  const { listFlowRuns } = await import('../../lib/flowRunStore.js');
  const { receiveExternalEvent } = await import('../../lib/externalEvents.js');
  const { readScheduleRun } = await import('../../lib/serverStore.js');
  const org = 'recovery_fixture'; let calls = 0; let providerRequest: any; let operationKey = '';
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/calls') { response.writeHead(404).end(); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    providerRequest = JSON.parse(body); operationKey = String(request.headers['idempotency-key']);
    calls++;
    response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ communication_id: 'comm-one', status: 'accepted' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.COMMUNICATIONS_API_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.COMMUNICATIONS_API_KEY = 'test-key';
  process.env.PUBLIC_BASE_URL = 'https://hyperflow-test.invalid';
  process.env.COMMUNICATIONS_FROM_NUMBER = '+15550000000';
  const definition = project([action('CALL', NodeType.PHONE_CALL, { actionConfig: {
    autoExecute: true, template: JSON.stringify({ to: '+15550000001', from: '+15550000000', prompt: 'Test call' })
  } })]);
  const schedule = { id: 'schedule', orgId: org, projectId: definition.id, activity: 'flow_start',
    enabled: true, nextRunAt: Date.now(), intervalMinutes: 1440, timezone: 'Australia/Brisbane',
    resetPolicy: 'flow', misfirePolicy: 'run_once', createdAt: Date.now(), updatedAt: Date.now() } as TenantSchedule;
  try {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), `projects/${org}/projects`), [definition]);
      await set(ref(context.database(), `schedules/${org}/schedule`), schedule);
      await set(ref(context.database(), 'tenant_lifecycle/suspended'), { state: 'suspended' });
      await set(ref(context.database(), `organizations/${org}/members/member`), { role: 'owner' });
    });
    const runtime = env.authenticatedContext('hyperflow-runtime-v1', { hyperflow_runtime: true }).database();
    const path = `action_dispatches/${org}/probe`;
    await assertSucceeds(set(ref(runtime, path), { test: true }));
    for (const client of [env.unauthenticatedContext(), env.authenticatedContext('member'), env.authenticatedContext('outsider'), env.authenticatedContext('hyperflow-runtime-v1')]) {
      await assertFails(get(ref(client.database(), path)));
      await assertFails(set(ref(client.database(), path), { forged: true }));
    }
    await assertFails(set(ref(runtime, 'action_dispatches/suspended/probe'), { test: true }));
    const results = await Promise.all([runTenantSchedule(schedule), runTenantSchedule(schedule)]);
    assert.equal(calls, 1); assert.ok(results.some(result => result.status === 'deferred'));
    assert.equal((await listFlowRuns(org, definition.id)).length, 1);
    assert.equal((await readScheduleRun(schedule))?.status, 'waiting');
    assert.equal(operationKey, providerRequest.correlation.run_id);
    // Replace only the compatibility projection with the original definition.
    await env.withSecurityRulesDisabled(async context => { await set(ref(context.database(), `projects/${org}/projects`), [definition]); });
    const callback = (event_id: string, type: string) => ({ event_id, source: 'communications', type,
      communication_id: 'comm-one', correlation: providerRequest.correlation,
      payload: type === 'call.completed' ? { transcript_text: 'A valid conversation', conversation_completed: true, disposition: 'hangup' }
        : { disposition: 'provider_failed', successful: false } });
    const raced = await Promise.all([receiveExternalEvent(callback('failed', 'call.failed')), receiveExternalEvent(callback('completed', 'call.completed'))]);
    assert.ok(raced.every(result => result.ok), JSON.stringify(raced));
    for (let i = 0; i < 3; i++) assert.equal((await receiveExternalEvent(callback('completed', 'call.completed'))).ok, true);
    const run = (await listFlowRuns(org, definition.id))[0];
    assert.equal(run.state.milestones[0].actionConfig?.lastRun?.status, 'success');
    assert.equal(run.status, 'completed');
    await runTenantSchedule(schedule);
    await runTenantSchedule(schedule);
    assert.equal(calls, 1);
    assert.equal((await readScheduleRun(schedule))?.status, 'completed');
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await env.clearDatabase(); await env.cleanup(); await Promise.all(getApps().map(deleteApp));
  }
});
