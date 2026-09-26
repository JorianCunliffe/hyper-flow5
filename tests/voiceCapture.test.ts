import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { captureVoiceWork, voiceCaptureDependencies } from '../lib/capturedWork/voice.js';
import { POST } from '../api/events.js';

const request = () => ({ tenant_id: 'org', person_id: 'person', communication_id: 'comm', thread_id: 'thread', service_identity: '+61400000000',
  capture: { rawText: 'Meet the buyer at one', idempotencyKey: 'turn-1', kind: 'meeting' } });
function harness() {
  const writes: any[] = [];
  const deps: typeof voiceCaptureDependencies = {
    ...voiceCaptureDependencies,
    readTenantAgentProfile: async () => ({ primaryUserId: 'owner', primaryPersonId: 'person', serviceIdentities: { phone: '+61400000000' } } as any),
    requireOrganizationMember: async (uid, orgId) => { assert.equal(uid, 'owner'); assert.equal(orgId, 'org'); return { uid, orgId, role: 'owner' } as any; },
    getCommunication: async (org, id) => ({ id, status: 'running', tenantId: org, personId: 'person', threadId: 'thread', channel: 'voice', correlation: { tenant_id: org, external_project_id: 'source-project', run_id: 'action-run', task_id: 'call-node' } }),
    findFlowRunByAction: async (_org, project, match) => { assert.equal(project, 'source-project'); assert.deepEqual(match, { runId: 'action-run', nodeId: 'call-node' }); return { id: 'flow-run' } as any; },
    handleCapturedWork: async (req, member) => { writes.push({ body: req.body, member }); return { item: { id: 'saved-item' } as any }; }
  };
  return { deps, writes };
}
test('phone capture derives owner and source from trusted records, ignoring model injection', async () => {
  const { deps, writes } = harness();
  const body = request(); Object.assign(body.capture, { capturedForUserId: 'victim', sourceRunId: 'fake', sourceProjectId: 'other', operation: 'resolve', confirmed: true });
  assert.deepEqual(await captureVoiceWork(body, deps), { saved: true, id: 'saved-item', acknowledgement: 'Captured. We can review that later.' });
  assert.deepEqual(writes[0].member, { orgId: 'org', uid: 'owner' });
  assert.equal(writes[0].body.sourceRunId, 'flow-run');
  assert.equal(writes[0].body.sourceNodeId, 'call-node');
  assert.equal(writes[0].body.sourceCommunicationId, 'comm');
  assert.equal(writes[0].body.sourceProjectId, 'source-project');
  assert.equal(writes[0].body.operation, undefined);
  assert.equal(writes[0].body.capturedForUserId, undefined);
  await captureVoiceWork(body, deps);
  assert.equal(writes[0].body.idempotencyKey, writes[1].body.idempotencyKey);
  await captureVoiceWork({ ...body, communication_id: 'comm-2' }, deps);
  assert.notEqual(writes[0].body.idempotencyKey, writes[2].body.idempotencyKey);
});
test('foreign callers, lines, communications, threads and revoked membership cannot capture', async () => {
  for (const patch of [{ person_id: 'visitor' }, { service_identity: '+61499999999' }, { thread_id: 'foreign-thread' }]) {
    const { deps, writes } = harness();
    await assert.rejects(captureVoiceWork({ ...request(), ...patch }, deps), /not authorized/);
    assert.equal(writes.length, 0);
  }
  for (const patch of [{ tenantId: 'other' }, { personId: 'other' }, { channel: 'email' }]) {
    const { deps, writes } = harness(); const get = deps.getCommunication;
    deps.getCommunication = async (org, id) => ({ ...await get(org, id), ...patch } as any);
    await assert.rejects(captureVoiceWork(request(), deps), /not authorized/); assert.equal(writes.length, 0);
  }
  const { deps, writes } = harness(); deps.requireOrganizationMember = async () => { throw new Error('Membership revoked'); };
  await assert.rejects(captureVoiceWork(request(), deps), /Membership/); assert.equal(writes.length, 0);
});
test('capture endpoint rejects unsigned, legacy-signed, stale and oversized requests before storage', async () => {
  const previous = process.env.COMMUNICATIONS_WEBHOOK_SECRET; process.env.COMMUNICATIONS_WEBHOOK_SECRET = 'test-secret';
  try {
    const body = JSON.stringify(request());
    for (const headers of [{}, { 'x-communications-signature': `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}` },
      { 'x-communications-timestamp': '1', 'x-communications-signature-v2': `sha256=${createHmac('sha256', 'test-secret').update(`1.${body}`).digest('hex')}` }]) {
      const response = await POST(new Request('http://localhost/api/events?action=capture_work', { method: 'POST', body, headers }));
      assert.equal(response.status, 401);
    }
    assert.equal((await POST(new Request('http://localhost/api/events?action=capture_work', { method: 'POST', body: 'x'.repeat(65537) }))).status, 413);
  } finally { if (previous === undefined) delete process.env.COMMUNICATIONS_WEBHOOK_SECRET; else process.env.COMMUNICATIONS_WEBHOOK_SECRET = previous; }
});
