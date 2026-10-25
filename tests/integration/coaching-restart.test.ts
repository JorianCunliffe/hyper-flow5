import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, set } from 'firebase/database';
import { NodeType } from '../../types.js';
import { action, project } from '../helpers.js';

test('real restart persistence: Resume rebases safely, concurrent Start now places one fixture call, and timer cannot overlap it', async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9010');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-hyperflow', client_email: 'fixture@demo-hyperflow.iam.gserviceaccount.com', private_key: privateKey });
  process.env.FIREBASE_DATABASE_URL = 'https://demo-hyperflow.firebaseio.com';
  process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE = 'true';
  const env = await initializeTestEnvironment({ projectId: 'demo-hyperflow', database: {
    host: '127.0.0.1', port: 9010, rules: readFileSync('database.rules.json', 'utf8') } });
  const { getApps, deleteApp } = await import('firebase-admin/app');
  const store = await import('../../lib/serverStore.js');
  const { startScheduleNow } = await import('../../lib/manualScheduleStart.js');
  const { runTenantSchedule } = await import('../../lib/scheduler.js');
  const org = 'restart_fixture'; let calls = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/calls') { response.writeHead(404).end(); return; }
    for await (const _chunk of request) { /* fixture call body */ }
    calls++;
    response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ communication_id: 'comm-restart-one', status: 'accepted' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.COMMUNICATIONS_API_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.COMMUNICATIONS_API_KEY = 'fixture';
  process.env.PUBLIC_BASE_URL = 'https://hyperflow-test.invalid';
  process.env.COMMUNICATIONS_FROM_NUMBER = '+15550000000';
  const definition = project([action('CALL', NodeType.PHONE_CALL, { actionConfig: {
    autoExecute: true, template: JSON.stringify({ to: '+15550000001', from: '+15550000000', prompt: 'Fixture only' })
  } })], { project_template: 'daily_coaching' });
  const stale = Date.now() - 3 * 86400000;
  const initial = store.normalizeTenantSchedule(org, 'schedule_restart', { name: 'Restart fixture', activity: 'flow_start',
    projectId: definition.id, enabled: false, nextRunAt: stale, timezone: 'Australia/Brisbane',
    recurrence: { kind: 'daily', localTime: '09:00' }, resetPolicy: 'flow' }, null, Date.now());
  try {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), `projects/${org}/projects`), [definition]);
      await set(ref(context.database(), `schedules/${org}/${initial.id}`), JSON.parse(JSON.stringify(initial)));
      await set(ref(context.database(), `organizations/${org}/members/member`), { role: 'owner' });
      await set(ref(context.database(), `agent_profiles/${org}`), {
        agentId: 'fixture', displayName: 'Fixture', timezone: 'Australia/Brisbane', automaticActions: ['call'],
        contactWindow: { startHour: 0, endHour: 24, maxPerDay: 20, maxPerContact: 2 }
      });
    });
    const resumed = await store.saveTenantSchedule(org, { id: initial.id, enabled: true });
    assert.ok(resumed.nextRunAt > Date.now());
    await store.saveTenantSchedule(org, { id: initial.id, enabled: false, nextRunAt: stale });
    await env.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), `schedule_runs/${org}/${initial.id}/${stale}`), {
        id: `${initial.id}:${stale}`, orgId: org, scheduleId: initial.id, scheduledFor: stale, status: 'blocked', manualReviewRequired: true
      });
    });
    const protectedResume = await store.saveTenantSchedule(org, { id: initial.id, enabled: true });
    assert.equal(protectedResume.nextRunAt, stale, 'Resume must preserve a held occurrence');
    await env.withSecurityRulesDisabled(async context => { await set(ref(context.database(), `schedule_runs/${org}/${initial.id}`), null); });
    await store.saveTenantSchedule(org, { id: initial.id, enabled: false });
    const saved = (await store.readTenantSchedule(org, initial.id))!;
    const at = Date.now();
    const results = await Promise.all([startScheduleNow(saved, at), startScheduleNow(saved, at + 1)]);
    assert.equal(calls, 1, JSON.stringify(results));
    assert.equal(results[0].scheduledFor, results[1].scheduledFor, 'Concurrent browsers must follow the same occurrence');
    const restarted = (await store.readTenantSchedule(org, initial.id))!;
    assert.equal(restarted.enabled, true); assert.ok(restarted.nextRunAt > Date.now());
    assert.equal(restarted.manualStartAt, results[0].scheduledFor);
    const timer = await runTenantSchedule(restarted, restarted.nextRunAt);
    assert.equal(timer.status, 'deferred'); assert.equal(calls, 1);
    const replay = await startScheduleNow(restarted, at);
    assert.equal(replay.scheduledFor, restarted.manualStartAt); assert.equal(calls, 1);
  } finally {
    await env.cleanup();
    for (const app of getApps()) await deleteApp(app);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
