import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingSmsReply } from '../lib/asks/pendingSmsReply';
import type { FlowRun } from '../lib/flowRuntimeTypes';
import type { CommunicationResult } from '../lib/communications/types';

const now = Date.parse('2026-10-10T06:23:13Z');
const incoming: CommunicationResult = { id: 'reply', status: 'completed', tenantId: 'org', personId: 'person',
  channel: 'sms', direction: 'inbound', sender: '+61400000000', recipients: ['+61700000000'],
  content: 'No we have to go through the booking form', occurredAt: new Date(now).toISOString(), threadId: 'new-provider-thread' };
const sent: CommunicationResult = { ...incoming, id: 'notification', direction: 'outbound', sender: '+61700000000',
  recipients: ['+61400000000'], purpose: { type: 'human_ask', ask_id: 'delivery' },
  correlation: { tenant_id: 'org', external_project_id: 'project' }, threadId: 'old-provider-thread' };
const run = { id: 'fr_owner', orgId: 'org', projectId: 'project', status: 'waiting', state: { milestones: [{
  id: 'wait', asks: [{ id: 'ask', runId: 'fr_owner', status: 'open', responses: [], deliveries: [{
    channel: 'sms', personId: 'person', status: 'accepted', communicationId: 'notification', deliveryAskId: 'delivery', at: now - 600_000
  }] }]
}] } } as FlowRun;
const input = { orgId: 'org', personId: 'person', projectIds: ['project'], message: incoming, now };
const client = { getCommunication: async () => sent };

test('natural SMS answer matches its sole pending question despite provider thread split', async () => {
  assert.deepEqual(await pendingSmsReply(input, client, async () => [run]), [
    { projectId: 'project', runId: 'fr_owner', askId: 'ask', deliveryAskId: 'delivery' }
  ]);
});
test('unrelated line, sender, tenant, person, expired window and explicit project mismatch cannot answer', async () => {
  for (const change of [ { recipients: ['+61799999999'] }, { sender: '+61499999999' }, { tenantId: 'other' },
    { personId: 'other' }, { occurredAt: new Date(now - 25 * 3_600_000).toISOString() } ]) {
    assert.deepEqual(await pendingSmsReply({ ...input, message: { ...incoming, ...change } }, client, async () => [run]), []);
  }
  assert.deepEqual(await pendingSmsReply({ ...input, trustedProjectId: 'different' }, client, async () => [run]), []);
  assert.deepEqual(await pendingSmsReply({ ...input, projectIds: [] }, client, async () => [run]), []);
});
test('voice-only, failed delivery, cancelled and historical Ask copies do not compete', async () => {
  for (const kind of ['voice', 'failed', 'cancelled', 'copied']) {
    const changed = structuredClone(run);
    const ask = changed.state.milestones[0].asks![0];
    if (kind === 'voice') ask.deliveries![0].channel = 'voice';
    if (kind === 'failed') ask.deliveries![0].status = 'failed';
    if (kind === 'cancelled') ask.status = 'cancelled';
    if (kind === 'copied') changed.id = 'fr_new';
    assert.deepEqual(await pendingSmsReply(input, client, async () => [changed]), []);
  }
});
test('multiple live SMS questions remain ambiguous instead of choosing the most recent', async () => {
  const second = structuredClone(run);
  second.state.milestones[0].asks![0].id = 'ask_two';
  assert.equal((await pendingSmsReply(input, client, async () => [run, second])).length, 2);
});
test('missing provider receipt fails closed', async () => {
  await assert.rejects(pendingSmsReply(input, { getCommunication: async () => { throw Error('unavailable'); } }, async () => [run]), /unavailable/);
});

test('canonical HTTP receipt binds the next SMS to the owning question', async () => {
  const { HttpCommunicationsClient } = await import('../lib/communications/clientCore');
  const http = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'fixture',
    fetchImpl: async () => new Response(JSON.stringify({ contract_version: '2.0', communication_id: 'notification',
      tenant_id: 'org', person_id: 'person', channel: 'sms', direction: 'outbound',
      sender: '+61700000000', recipients: ['+61400000000'],
      purpose: { type: 'human_ask', ask_id: 'delivery' },
      correlation: { tenant_id: 'org', external_project_id: 'project' } }), { status: 200 }) });
  assert.deepEqual(await pendingSmsReply(input, http, async () => [run]), [
    { projectId: 'project', runId: 'fr_owner', askId: 'ask', deliveryAskId: 'delivery' }
  ]);
});

test('legacy project alias works but conflicting or foreign project receipts do not', async () => {
  for (const [correlation, count] of [
    [{ tenant_id: 'org', project_id: 'project' }, 1],
    [{ tenant_id: 'org', external_project_id: 'other', project_id: 'project' }, 0],
    [{ tenant_id: 'org', external_project_id: 'project', project_id: 'other' }, 0],
    [{ tenant_id: 'org', external_project_id: 'other' }, 0]
  ] as const) {
    const matches = await pendingSmsReply(input, { getCommunication: async () => ({ ...sent, correlation }) }, async () => [run]);
    assert.equal(matches.length, count);
  }
});
