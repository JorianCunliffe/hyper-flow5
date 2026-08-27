import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { advanceProjectFlow, ActionExecutor, resolvePendingRun } from '../lib/flowOrchestrator';
import { normalizeExternalEvent } from '../lib/externalEvents';
import { NodeType, Project } from '../types';
import { action, doneMilestone, openMilestone, project } from './helpers';

const callThenDecide = (): Project =>
  project([
    doneMilestone('KICKOFF'),
    action('CALL', NodeType.PHONE_CALL, {
      dependsOn: ['KICKOFF'],
      actionConfig: { template: '{"to":"{{contact_phone}}","instruction":"Ask about the proposal"}', autoExecute: true }
    }),
    {
      id: 'D', name: 'Interested?', subtasks: [], dependsOn: ['CALL'], estimatedDuration: 1,
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
  externalId: 'comm_xyz',
  externalExecutionId: 'comm_xyz',
  externalService: 'communications'
});

const forbiddenExecutor: ActionExecutor = async () => { throw new Error('nothing else should be dispatched'); };

const completedEvent = (runId: string) => normalizeExternalEvent({
  event_id: 'evt_1',
  source: 'communications',
  type: 'call.completed',
  communication_id: 'comm_xyz',
  correlation: { tenant_id: 'org_1', project_id: 'p1', task_id: 'CALL', run_id: runId },
  payload: { proposal_interest: true, call_summary: 'Client is keen.' }
});

describe('external communication handover', () => {
  test('a waiting call completes by explicit task/run correlation and advances the decision', async () => {
    const dispatched = await advanceProjectFlow(callThenDecide(), dispatchingExecutor, { orgId: 'org_1' });
    const run = dispatched.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!;
    assert.equal(run.status, 'pending');
    assert.equal(run.executionState, 'waiting');
    assert.equal(run.externalExecutionId, 'comm_xyz');
    assert.equal(run.externalService, 'communications');

    const event = completedEvent(run.id!);
    const resolved = resolvePendingRun(
      dispatched.project,
      { nodeId: event.correlation.task_id, runId: event.correlation.run_id, externalId: event.communication_id },
      { status: 'success', output: event.payload, resolvedBy: 'event:communications' }
    );
    assert.ok(resolved);

    const advanced = await advanceProjectFlow(resolved!.project, forbiddenExecutor, { orgId: 'org_1' });
    assert.equal(advanced.project.projectData!.proposal_interest, true);
    assert.equal(advanced.project.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId, 'PROCEED');
  });

  test('mismatched task correlation cannot complete a different waiting task', async () => {
    const dispatched = await advanceProjectFlow(callThenDecide(), dispatchingExecutor, { orgId: 'org_1' });
    const run = dispatched.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!;
    const event = completedEvent(run.id!);
    assert.equal(resolvePendingRun(
      dispatched.project,
      { nodeId: 'OTHER', runId: event.correlation.run_id, externalId: event.communication_id },
      { status: 'success', output: event.payload, resolvedBy: 'event:communications' }
    ), null);
  });

  test('a replay is inert after the waiting run has completed', async () => {
    const dispatched = await advanceProjectFlow(callThenDecide(), dispatchingExecutor, { orgId: 'org_1' });
    const run = dispatched.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!;
    const event = completedEvent(run.id!);
    const match = { nodeId: event.correlation.task_id, runId: event.correlation.run_id, externalId: event.communication_id };
    const result = { status: 'success' as const, output: event.payload, resolvedBy: 'event:communications' };
    const first = resolvePendingRun(dispatched.project, match, result);
    assert.ok(first);
    assert.equal(resolvePendingRun(first!.project, match, result), null);
  });

  test('voicemail resolves the call as failed, records the disposition, and does not advance or merge output', async () => {
    const dispatched = await advanceProjectFlow(callThenDecide(), dispatchingExecutor, { orgId: 'org_1' });
    const pending = dispatched.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!;
    const event = normalizeExternalEvent({
      event_id: 'evt_voicemail', source: 'communications', type: 'call.failed', communication_id: 'comm_xyz',
      correlation: { tenant_id: 'org_1', project_id: 'p1', task_id: 'CALL', run_id: pending.id },
      payload: {
        proposal_interest: true, business_status: 'failed', disposition: 'voicemail',
        successful: false, memory_eligible: false, failure_reason: 'Answering machine detected'
      }
    });
    const resolved = resolvePendingRun(dispatched.project, {
      nodeId: event.correlation.task_id, runId: event.correlation.run_id, externalId: event.communication_id
    }, {
      status: 'error', output: event.payload, error: String(event.payload.failure_reason),
      resolvedBy: 'event:communications'
    });
    assert.ok(resolved);
    assert.deepEqual(resolved!.project.projectData, { contact_phone: '+61400000000' });
    assert.equal(resolved!.project.milestones.find(m => m.id === 'CALL')!.actionConfig!.lastRun!.communicationOutcome?.disposition, 'voicemail');

    const advanced = await advanceProjectFlow(resolved!.project, forbiddenExecutor, { orgId: 'org_1' });
    assert.equal(advanced.project.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId, undefined);
  });
});
