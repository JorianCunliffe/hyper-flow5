import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpointReviewedRun } from '../lib/asks/respondToAsk';
import { createFlowRun } from '../lib/flowRun';
import { continuationHold } from '../lib/flowHoldStore';
import { action, project } from './helpers';
import { NodeType } from '../types';

test('review is durable and a continuation is queued without executing downstream providers', async () => {
  const p = project([action('triage', NodeType.EMAIL_TRIAGE, { actionConfig: { template: '{}', autoExecute: true } })]);
  const run = createFlowRun({ orgId: 'org', project: p, occurrenceId: 'one', trigger: 'manual' });
  const order: string[] = [];
  const result = await checkpointReviewedRun({ orgId: 'org' } as any, { index: 0 } as any, run, p, {
    saveFlowRun: async value => { order.push('persist'); return value; },
    syncFlowHoldsFromRun: async (value, state) => { order.push('queue'); assert.equal(continuationHold(value, state)?.source, 'continuation'); },
    writeProject: async () => { order.push('project'); }
  });
  assert.deepEqual(order, ['persist', 'queue', 'project']);
  assert.deepEqual(result.pending, ['__continue__']);
  assert.equal(result.run.state.milestones[0].actionConfig?.lastRun, undefined);
});

test('failed decision persistence never queues work or updates the project', async () => {
  const p = project([]);
  const run = createFlowRun({ orgId: 'org', project: p, occurrenceId: 'one', trigger: 'manual' });
  await assert.rejects(checkpointReviewedRun({ orgId: 'org' } as any, { index: 0 } as any, run, p, {
    saveFlowRun: async () => { throw new Error('concurrent revision'); },
    syncFlowHoldsFromRun: async () => { assert.fail('must not queue'); },
    writeProject: async () => { assert.fail('must not project'); }
  }), /concurrent revision/);
});
