import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFlowRunAsk } from '../lib/flowRunStore';
import type { FlowRun } from '../lib/flowRuntimeTypes';
import type { HumanAsk } from '../types';

const ask = { id: 'ask_sms', token: 'original-token', runId: 'fr_sms', status: 'open',
  deliveries: [{ deliveryAskId: 'delivery_sms', deliveryToken: 'delivery-token' }] } as HumanAsk;
const run = (id: string, value: HumanAsk): FlowRun => ({ id, state: { milestones: [{ id: 'wait', asks: [value] }] } } as FlowRun);

test('SMS form and reply find original open Ask rather than newer cancelled copies', async () => {
  const owner = run('fr_sms', ask);
  const copy = run('fr_next_call', { ...ask, status: 'cancelled' });
  for (const [id, token] of [[undefined, 'original-token'], [undefined, 'delivery-token'], ['delivery_sms', undefined], ['ask_sms', undefined]]) {
    const found = await resolveFlowRunAsk([copy, owner], async id => id === owner.id ? owner : null, id, token);
    assert.equal(found?.run.id, owner.id);
    assert.equal(found?.ask.status, 'open');
  }
});

test('owner outside history window is read; real cancellation remains authoritative', async () => {
  const owner = run('fr_sms', { ...ask, status: 'cancelled' });
  const found = await resolveFlowRunAsk([run('fr_later', ask)], async () => owner, undefined, 'delivery-token');
  assert.equal(found?.ask.status, 'cancelled');
});

test('missing or mismatched owner cannot revive a copied Ask', async () => {
  for (const owner of [null, run('fr_sms', { ...ask, token: 'different', deliveries: [] })]) {
    assert.equal(await resolveFlowRunAsk([run('fr_later', ask)], async () => owner, undefined, 'original-token'), null);
  }
});

test('absent lookup identifiers do not match absent delivery fields', async () => {
  const partial = run('fr_sms', { ...ask, deliveries: [{ channel: 'sms', personId: 'person', status: 'accepted', at: 1 }] });
  assert.equal(await resolveFlowRunAsk([partial], async () => null, 'unrelated'), null);
  assert.equal(await resolveFlowRunAsk([partial], async () => null, undefined, 'unrelated'), null);
  assert.equal(await resolveFlowRunAsk([partial], async () => null), null);
});
