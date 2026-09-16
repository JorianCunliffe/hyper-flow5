import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, remove } from 'firebase/database';
import type { Project } from '../../types.js';

test('scheduler and durable holds work with runtime rules while browsers and suspended tenants remain denied', async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9010');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-hyperflow', client_email: 'fixture@demo-hyperflow.iam.gserviceaccount.com', private_key: privateKey });
  process.env.FIREBASE_DATABASE_URL = 'https://demo-hyperflow.firebaseio.com';
  process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE = 'true';
  const env = await initializeTestEnvironment({ projectId: 'demo-hyperflow', database: { host: '127.0.0.1', port: 9010, rules: readFileSync('database.rules.json', 'utf8') } });
  const { getApps, deleteApp } = await import('firebase-admin/app');
  const { recordSchedulerTick, readSchedulerHealth } = await import('../../lib/serverStore.js');
  const { tickSchedules } = await import('../../lib/scheduler.js');
  const { createFlowRunIfAbsent, saveFlowRun, readFlowRun } = await import('../../lib/flowRunStore.js');
  const { claimDueFlowHolds, finishFlowHold, syncFlowHoldsFromRun } = await import('../../lib/flowHoldStore.js');
  const runtime = env.authenticatedContext('hyperflow-runtime-v1', { hyperflow_runtime: true }).database();
  const browsers = [env.unauthenticatedContext().database(), env.authenticatedContext('scheduler_member').database(), env.authenticatedContext('hyperflow-runtime-v1').database()];
  const roots = ['flow_runs', 'flow_holds', 'flow_hold_open', 'capability_policy', 'workspace_resource_catalog'];
  const now = Date.now();
  try {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async c => {
      await set(ref(c.database(), 'tenant_lifecycle/scheduler_paused'), { state: 'suspended' });
      await set(ref(c.database(), 'organizations/scheduler_active/members/scheduler_member'), { role: 'owner' });
    });
    for (const root of roots) {
      const path = `${root}/scheduler_active/project/fixture`;
      await assertSucceeds(set(ref(runtime, path), { test: true }));
      await assertSucceeds(get(ref(runtime, path)));
      for (const browser of browsers) {
        await assertFails(get(ref(browser, path)));
        await assertFails(set(ref(browser, path), { forged: true }));
      }
      await assertFails(get(ref(runtime, `${root}/scheduler_paused/project/fixture`)));
      await assertFails(set(ref(runtime, `${root}/scheduler_paused/project/fixture`), { test: true }));
      await remove(ref(runtime, path));
    }
    for (const browser of browsers) {
      await assertFails(get(ref(browser, 'flow_hold_pending')));
      await assertFails(set(ref(browser, 'flow_hold_pending/forged'), { orgId: 'scheduler_active', availableAt: now }));
    }
    await assertFails(set(ref(runtime, 'flow_hold_pending/paused'), { orgId: 'scheduler_paused', availableAt: now }));
    await assertFails(set(ref(runtime, 'flow_hold_pending/missing-owner'), { availableAt: now }));
    // Run the complete tick with the production auth override, not an admin bypass.
    await recordSchedulerTick('started');
    await tickSchedules(now);
    await recordSchedulerTick('success');
    assert.ok((await readSchedulerHealth()).lastSuccessfulTickAt);

    const run = await createFlowRunIfAbsent({
      id: 'serialization', orgId: 'scheduler_active', projectId: 'project',
      occurrenceId: 'fixture', trigger: 'schedule', status: 'running',
      state: { milestones: [], projectData: {} }, nodeRuns: {}, revision: 0,
      startedAt: now, updatedAt: now
    });
    const saved = await saveFlowRun({ ...run, completedAt: undefined, error: undefined,
      state: { ...run.state, projectData: { nested: { optional: undefined, kept: 'yes' } } } });
    assert.equal(saved.revision, 1);
    assert.equal(saved.completedAt, undefined);
    assert.deepEqual(saved.state.projectData.nested, { kept: 'yes' });
    assert.equal((await readFlowRun(run.orgId, run.projectId, run.id))?.revision, 1);
    await assert.rejects(saveFlowRun(run), /changed concurrently/);
    await syncFlowHoldsFromRun(saved, { milestones: [{ id: 'wait', waitConfig: {
      holdId: 'optional-hold', armedAt: now, resumeAt: now + 60_000
    } }] } as Project);
    const persistedHold = await get(ref(runtime, 'flow_holds/scheduler_active/project/serialization/optional-hold'));
    assert.equal(persistedHold.val().status, 'waiting');
    assert.equal(persistedHold.val().availableAt, now + 60_000);
    await syncFlowHoldsFromRun(saved, { milestones: [{ id: 'wait', waitConfig: {
      holdId: 'resolved-hold', armedAt: now, resolvedAt: now
    } }] } as Project);
    assert.equal((await get(ref(runtime, 'flow_holds/scheduler_active/project/serialization/resolved-hold'))).val().status, 'resolved');

    const hold = { id: 'hold', orgId: 'scheduler_active', projectId: 'project', flowRunId: 'run', nodeId: 'wait', source: 'wait', kind: 'timer', status: 'waiting', availableAt: now - 1, createdAt: now - 100, updatedAt: now };
    const key = (org: string) => encodeURIComponent(`${org}:project:run:hold`);
    await env.withSecurityRulesDisabled(async c => {
      for (const orgId of ['scheduler_active', 'scheduler_paused']) {
        await set(ref(c.database(), `flow_holds/${orgId}/project/run/hold`), { ...hold, orgId });
        await set(ref(c.database(), `flow_hold_pending/${key(orgId)}`), { orgId, projectId: 'project', flowRunId: 'run', holdId: 'hold', availableAt: now - 1 });
      }
    });
    const claimed = await claimDueFlowHolds(now);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].orgId, 'scheduler_active');
    assert.equal((await claimDueFlowHolds(now)).length, 0);
    await finishFlowHold(claimed[0], 'resolved');
    assert.equal((await get(ref(runtime, `flow_hold_pending/${key('scheduler_active')}`))).exists(), false);
    await tickSchedules(now); // A suspended tenant's pending hold cannot poison the tick.
  } finally {
    await env.clearDatabase();
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
