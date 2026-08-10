import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { advanceProjectFlow, ActionExecutor, resolvePendingRun } from '../lib/flowOrchestrator';
import { normalizeBlandCallback } from '../lib/inboundVoice';
import { NodeType, Project } from '../types';
import { action, doneMilestone, openMilestone, project } from './helpers';

/**
 * End-to-end logic for the inbound handover path, minus the Firebase I/O:
 *
 *   call dispatched (pending) -> flow blocked -> Bland webhook -> run resolves
 *   -> analysis lands in projectData -> decision branches on what the human said
 *
 * This is the whole point of server-side orchestration: no browser is involved
 * at any step after the call is placed.
 */

const callThenDecide = (): Project =>
  project([
    doneMilestone('KICKOFF'),
    action('CALL', NodeType.PHONE_CALL, {
      dependsOn: ['KICKOFF'],
      actionConfig: { template: '{"to": "{{contact_phone}}", "prompt": "Ask about the proposal"}', autoExecute: true }
    }),
    {
      id: 'D',
      name: 'Interested?',
      subtasks: [],
      dependsOn: ['CALL'],
      estimatedDuration: 1,
      nodeType: NodeType.DECISION,
      decisionConfig: {
        branches: [
          { targetId: 'PROCEED', label: 'Yes', conditions: [{ variable: 'proposal_interest', equals: true }] },
          { targetId: 'NURTURE', label: 'No' }
        ]
      }
    },
    openMilestone('PROCEED', { dependsOn: ['D'] }),
    openMilestone('NURTURE', { dependsOn: ['D'] })
  ], { contact_phone: '+61400000000' });

const dispatchingExecutor: ActionExecutor = async () => ({
  status: 'pending',
  externalId: 'call_xyz',
  logs: ['Dialing +61400000000...']
});

/** Fails loudly if the flow tries to run anything after the call. */
const forbiddenExecutor: ActionExecutor = async () => {
  throw new Error('no further action should be dispatched');
};

describe('inbound voice handover', () => {
  test('the flow blocks on the call, then completes from the webhook alone', async () => {
    // 1. Advance: the call is placed and the flow stops there.
    const dispatched = await advanceProjectFlow(callThenDecide(), dispatchingExecutor, { orgId: 'org_1' });
    assert.deepEqual(dispatched.pending, ['CALL']);

    const callNode = dispatched.project.milestones.find(m => m.id === 'CALL')!;
    const run = callNode.actionConfig!.lastRun!;
    assert.equal(run.status, 'pending');
    assert.equal(run.externalId, 'call_xyz');
    assert.equal(
      dispatched.project.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId,
      undefined,
      'the decision must not resolve while the human has not answered'
    );

    // 2. Bland calls back. This is everything the handler receives.
    const event = normalizeBlandCallback({
      call_id: 'call_xyz',
      status: 'completed',
      completed: true,
      call_length: 2.1,
      summary: 'Client is keen, wants pricing.',
      analysis: { proposal_interest: 'true' },
      metadata: { orgId: 'org_1', projectId: 'p1', nodeId: 'CALL', runId: run.id }
    });
    assert.equal(event.status, 'success');

    const resolved = resolvePendingRun(
      dispatched.project,
      { runId: event.runId, externalId: event.eventId },
      { status: event.status, output: event.output, logs: event.logs, resolvedBy: 'webhook:bland' }
    );
    assert.ok(resolved, 'the webhook found the pending run');

    // 3. Advance again — nothing else needs executing, but the decision resolves.
    const advanced = await advanceProjectFlow(resolved!.project, forbiddenExecutor, { orgId: 'org_1' });

    assert.equal(advanced.project.projectData!.proposal_interest, true);
    assert.equal(advanced.project.projectData!.call_summary, 'Client is keen, wants pricing.');
    assert.equal(
      advanced.project.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId,
      'PROCEED',
      'the flow branched on what the human said, with no browser involved'
    );
  });

  test('a call nobody answered branches the other way instead of stalling', async () => {
    const dispatched = await advanceProjectFlow(callThenDecide(), dispatchingExecutor, { orgId: 'org_1' });
    const run = dispatched.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!;

    const event = normalizeBlandCallback({
      call_id: 'call_xyz',
      status: 'failed',
      completed: false,
      error_message: 'no answer',
      metadata: { orgId: 'org_1', projectId: 'p1', nodeId: 'CALL', runId: run.id }
    });

    const resolved = resolvePendingRun(
      dispatched.project,
      { runId: event.runId, externalId: event.eventId },
      { status: event.status, output: event.output, error: event.error, resolvedBy: 'webhook:bland' }
    );
    assert.ok(resolved);

    const failedRun = resolved!.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!;
    assert.equal(failedRun.status, 'error');
    assert.equal(
      resolved!.project.projectData!.proposal_interest,
      undefined,
      'a failed call must not write an answer the human never gave'
    );

    // The action node is incomplete, so the decision stays blocked and the node
    // is eligible for a retry rather than silently branching to the default.
    const advanced = await advanceProjectFlow(resolved!.project, dispatchingExecutor, { orgId: 'org_1' });
    assert.equal(
      advanced.project.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId,
      undefined,
      'a failed call must not be read as "not interested"'
    );
    assert.deepEqual(advanced.pending, ['CALL'], 'the call is retried instead');
  });

  test('a duplicate webhook delivery changes nothing', async () => {
    const dispatched = await advanceProjectFlow(callThenDecide(), dispatchingExecutor, { orgId: 'org_1' });
    const run = dispatched.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!;

    const payload = {
      call_id: 'call_xyz',
      status: 'completed',
      completed: true,
      analysis: { proposal_interest: 'true' },
      metadata: { orgId: 'org_1', projectId: 'p1', nodeId: 'CALL', runId: run.id }
    };

    const event = normalizeBlandCallback(payload);
    const first = resolvePendingRun(dispatched.project, { runId: event.runId }, {
      status: event.status, output: event.output, resolvedBy: 'webhook:bland'
    });
    assert.ok(first);

    // Even if the idempotency claim were bypassed, replaying is inert.
    const second = resolvePendingRun(first!.project, { runId: event.runId }, {
      status: event.status, output: event.output, resolvedBy: 'webhook:bland'
    });
    assert.equal(second, null, 'the run is no longer pending, so the replay is a no-op');
  });
});
