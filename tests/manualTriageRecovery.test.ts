import test from 'node:test';
import assert from 'node:assert/strict';
import { action, project } from './helpers.js';
import { NodeType } from '../types.js';
import { runActionNode, actionAttemptIdentity } from '../lib/flowOrchestrator.js';
import { manualActionOutcome } from '../lib/manualActionOutcome.js';
import { TRIAGE_BATCH_CHECKPOINT, unfinishedTriageRunIds } from '../lib/actionRecovery.js';
import { durableActionExecutor, ActionRecoveryRequired, type ActionDispatch } from '../lib/actionDispatch.js';
import { resolveNodeStates } from '../lib/flowEngine.js';

test('manual HTTP continuation survives reload, reuses one dispatch and exposes all batches only at completion', async () => {
  const rows = new Map<string, ActionDispatch>();
  const inputs: string[] = [];
  let batches = 0;
  const execute = durableActionExecutor(async (_type, _template, _data, ctx) => {
    inputs.push(ctx.runId);
    batches++;
    if (batches < 3) throw new ActionRecoveryRequired(TRIAGE_BATCH_CHECKPOINT);
    return { status: 'success', output: { triage_items: ['first', 'second', 'third'] } };
  }, { transact: async (_org, id, update) => {
    const row = update(rows.get(id) || null); rows.set(id, row); return row;
  } }, () => 1000);
  const browser = async (...args: Parameters<typeof execute>) => {
    try { const result = await execute(...args); return manualActionOutcome(true, 200, result); }
    catch (error: any) { return manualActionOutcome(false, 503, { error: error.message, recoverable: error.recoverable }); }
  };
  let p = project([
    action('TRIAGE', NodeType.EMAIL_TRIAGE, { actionConfig: { template: '{}', resultVariable: 'intake', failureMode: 'continue' } }),
    action('CALL', NodeType.PHONE_CALL, { dependsOn: ['TRIAGE'] })
  ]);
  for (let i = 0; i < 2; i++) {
    p = (await runActionNode(p, 'TRIAGE', browser, { orgId: 'fixture' })).project;
    assert.equal(p.milestones[0].actionConfig?.lastRun?.status, 'pending');
    assert.equal(p.projectData?.intake_output, undefined);
    assert.equal(resolveNodeStates(p).get('TRIAGE'), 'pending');
    p = JSON.parse(JSON.stringify(p));
  }
  p = (await runActionNode(p, 'TRIAGE', browser, { orgId: 'fixture' })).project;
  assert.deepEqual(p.projectData?.intake_output.triage_items, ['first', 'second', 'third']);
  assert.equal(rows.size, 1);
  assert.equal(new Set(inputs).size, 1);
  assert.equal(p.milestones[0].actionConfig?.runHistory?.length || 0, 0);
  assert.notEqual(actionAttemptIdentity(p, 'TRIAGE').runId, inputs[0], 'completed run is not reused');
});

test('legacy recovery only joins unfinished triage runs from the same occurrence', () => {
  const checkpoint = (id: string) => ({ id, at: 1, status: 'error' as const, error: TRIAGE_BATCH_CHECKPOINT });
  const node = action('T', NodeType.EMAIL_TRIAGE, { actionConfig: { template: '',
    runHistory: [checkpoint('old'), { id: 'finished', at: 1, status: 'success' }, checkpoint('first')],
    lastRun: checkpoint('second') } });
  assert.deepEqual(unfinishedTriageRunIds(node), ['second', 'first']);
  assert.deepEqual(unfinishedTriageRunIds(node, 'new-day'), []);
  assert.equal(actionAttemptIdentity(project([node]), 'T').runId, 'second');
  assert.deepEqual(unfinishedTriageRunIds({ ...node, nodeType: NodeType.SMS }), []);
});

test('unmarked HTTP failures stay failures and a new occurrence does not reuse a recovery ID', () => {
  assert.equal(manualActionOutcome(false, 503, { error: 'unavailable' }).status, 'error');
  const node = action('T', NodeType.EMAIL_TRIAGE, { actionConfig: { template: '', lastRun: {
    id: 'prior-day', at: 1, status: 'pending', recoveryRequired: true, scheduleOccurrenceId: 'old'
  } } });
  assert.notEqual(actionAttemptIdentity(project([node], { flow_occurrence_id: 'new' }), 'T').runId, 'prior-day');
});
