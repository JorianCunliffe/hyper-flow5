import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerActionExecutor } from '../lib/serverExecutor.js';

const context = { orgId: 'org', projectId: 'project', nodeId: 'sms', runId: 'same-operation' };
const fixture = (deny = false) => {
  const targets: any[] = [], claims: any[] = [], sends: any[] = [];
  const execute = createServerActionExecutor({
    readTenantCommunicationsSettings: async () => null,
    readTenantAgentProfile: async () => ({ agentId: 'agent', displayName: 'Agent', automaticActions: ['sms', 'call', 'send'] }),
    readTenantCapabilityPolicy: async () => ({}),
    readFlowRun: async () => null,
    resolveGrantedPersonTarget: async input => {
      targets.push(input);
      if (deny) throw new Error('target is not granted');
      return '+61400000000';
    },
    claimContactDispatch: async (_org, input) => { claims.push(input); return { allowed: true }; },
    executeTask: async (type, template) => {
      sends.push({ type, template: JSON.parse(template || '{}') });
      return { httpStatus: 202, body: { status: 'success', pending: true } };
    }
  } as any);
  return { execute, targets, claims, sends };
};

test('manual and scheduled person-target SMS resolves the grant before dispatch', async () => {
  const f = fixture();
  const result = await f.execute('send_sms', JSON.stringify({ person_id: 'jorian', body: 'TEST ONLY', to: '+61499999999' }), {}, context);
  assert.equal(result.status, 'pending');
  assert.equal(f.targets[0].personId, 'jorian');
  assert.equal(f.targets[0].channel, 'sms');
  assert.equal(f.claims[0].operationId, context.runId);
  assert.equal(f.sends[0].template.to, '+61400000000');
  assert.equal(f.sends[0].template.body, 'TEST ONLY');
});

test('missing person grant prevents manual dispatch', async () => {
  const f = fixture(true);
  await assert.rejects(f.execute('send_sms', '{"person_id":"ungranted"}', {}, context), /not granted/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.claims.length, 0);
});

test('manual explicit destination stays compatible; event actions still require a granted person', async () => {
  const f = fixture();
  await f.execute('send_sms', '{"to":"+61400000000","body":"test"}', {}, context);
  assert.equal(f.targets.length, 0);
  assert.equal(f.sends.length, 1);
  await f.execute('send_sms', '{"person_id":"jorian","body":"test"}', { flow_trigger_event_id: 'event' }, context);
  assert.equal(f.targets.length, 1);
});

test('event-person targeting cannot invent an inbound run on manual execution', async () => {
  const f = fixture();
  await assert.rejects(f.execute('send_sms', '{"target_source":"event_person"}', {}, context), /Event sender targeting/);
  assert.equal(f.sends.length, 0);
});
