import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeType } from '../types';
import { advanceFlow, getHoldConfig } from '../lib/flowEngine';
import { advanceProjectFlow } from '../lib/flowOrchestrator';
import { createFlowRun, materializeFlowRunProject, updateFlowRunFromProject } from '../lib/flowRun';
import { holdMatchesSignal } from '../lib/flowHoldStore';
import type { FlowHold, RuntimeMilestone } from '../lib/flowRuntimeTypes';
import { action, node, project } from './helpers';

describe('FlowRun execution isolation', () => {
  test('two occurrences of one Project have independent mutable state', () => {
    const definition = project([
      action('ACT', NodeType.EMAIL, { actionConfig: { template: '{}', autoExecute: true } })
    ], { persistent: 'yes' });
    const runA = createFlowRun({ orgId: 'org', project: definition, occurrenceId: 'event:a', trigger: 'event' });
    const runB = createFlowRun({ orgId: 'org', project: definition, occurrenceId: 'event:b', trigger: 'event' });
    assert.notEqual(runA.id, runB.id);

    const projectA = materializeFlowRunProject(definition, runA);
    projectA.projectData!.only_a = true;
    projectA.milestones[0].actionConfig!.lastRun = { id: 'a1', at: 1, status: 'success' };
    const updatedA = updateFlowRunFromProject(runA, projectA, 10);

    const projectB = materializeFlowRunProject(definition, runB);
    assert.equal(projectB.projectData?.only_a, undefined);
    assert.equal(projectB.milestones[0].actionConfig?.lastRun, undefined);
    assert.equal(updatedA.state.projectData.only_a, true);
  });

  test('NodeRun records action attempts without mutating the Project definition', () => {
    const definition = project([
      action('ACT', NodeType.EMAIL, { actionConfig: { template: '{}', autoExecute: true } })
    ]);
    const run = createFlowRun({ orgId: 'org', project: definition, occurrenceId: 'manual:1', trigger: 'manual', now: 1 });
    const runtime = materializeFlowRunProject(definition, run);
    runtime.milestones[0].actionConfig!.lastRun = { id: 'action_1', at: 2, status: 'success' };
    const updated = updateFlowRunFromProject(run, runtime, 3);
    assert.equal(updated.nodeRuns.ACT.at(-1)?.actionRunId, 'action_1');
    assert.equal(updated.nodeRuns.ACT.at(-1)?.status, 'completed');
    assert.equal(definition.milestones[0].actionConfig?.lastRun, undefined);
  });
});

describe('generic WAIT holds', () => {
  test('event WAIT arms without completing and keeps a matching contract', () => {
    const wait = node('WAIT', { nodeType: NodeType.WAIT }) as RuntimeMilestone;
    wait.holdConfig = {
      kind: 'event',
      match: { eventTypes: ['communication.received'], channels: ['sms'], directions: ['inbound'] },
      resultVariable: 'reply_wait'
    };
    const advanced = advanceFlow(project([wait], { flow_occurrence_id: 'run:1', flow_run_id: 'fr_1' })).project;
    const cfg = getHoldConfig(advanced.milestones[0])!;
    assert.equal(cfg.kind, 'event');
    assert.ok(cfg.holdId);
    assert.ok(cfg.armedAt);
    assert.equal(cfg.resolvedAt, undefined);
  });

  test('signal WAIT can time out and expose a Decision-friendly result variable', () => {
    const wait = node('WAIT', { nodeType: NodeType.WAIT }) as RuntimeMilestone;
    wait.holdConfig = {
      kind: 'event',
      timeoutMinutes: 5,
      resultVariable: 'reply_wait',
      holdId: 'hold_1',
      armedAt: 1,
      availableAt: Date.now() - 1,
      occurrenceId: 'run:1'
    };
    const advanced = advanceFlow(project([wait], { flow_occurrence_id: 'run:1', flow_run_id: 'fr_1' })).project;
    assert.equal(getHoldConfig(advanced.milestones[0])?.resolution, 'timeout');
    assert.equal(advanced.projectData?.reply_wait, 'timeout');
    assert.equal(advanced.projectData?.reply_wait_resolved, true);
  });

  test('human WAIT raises an ordinary channel-independent Ask', async () => {
    const wait = node('WAIT', { nodeType: NodeType.WAIT }) as RuntimeMilestone;
    wait.holdConfig = {
      kind: 'human',
      human: { kind: 'question', prompt: 'Which supplier?', fields: [{ name: 'supplier', type: 'string', required: true }], channels: ['web'] }
    };
    const result = await advanceProjectFlow(project([wait], { flow_occurrence_id: 'run:1', flow_run_id: 'fr_1' }), async () => ({ status: 'success' }));
    const ask = result.project.milestones[0].asks?.[0];
    assert.equal(ask?.kind, 'question');
    assert.equal(ask?.prompt, 'Which supplier?');
    assert.equal(ask?.runId, 'fr_1');
    assert.equal(getHoldConfig(result.project.milestones[0])?.resolvedAt, undefined);
  });
});

describe('hold signal matching', () => {
  const base: FlowHold = {
    id: 'h1', orgId: 'org', projectId: 'p', flowRunId: 'fr', nodeId: 'w', source: 'wait',
    kind: 'event', status: 'waiting', occurrenceId: 'event:1', createdAt: 1, updatedAt: 1,
    match: { eventTypes: ['communication.received'], channels: ['sms'], directions: ['inbound'], personIds: ['person_1'] }
  };

  test('matches configured event metadata and rejects unrelated events', () => {
    assert.equal(holdMatchesSignal(base, {
      id: 'e1', kind: 'event', occurredAt: 2, eventType: 'communication.received', channel: 'sms', direction: 'inbound', personId: 'person_1'
    }), true);
    assert.equal(holdMatchesSignal(base, {
      id: 'e2', kind: 'event', occurredAt: 2, eventType: 'communication.received', channel: 'email', direction: 'inbound', personId: 'person_1'
    }), false);
  });

  test('provider and human holds match stable ids, not message text', () => {
    const provider: FlowHold = { ...base, id: 'hp', kind: 'provider', source: 'action', match: { actionRunIds: ['run_1'], externalIds: ['comm_1'] } };
    assert.equal(holdMatchesSignal(provider, { id: 's1', kind: 'provider', occurredAt: 2, actionRunId: 'run_1', externalId: 'comm_1' }), true);
    const human: FlowHold = { ...base, id: 'hh', kind: 'human', askId: 'ask_1', askToken: 'tok_1', match: { askIds: ['ask_1'] } };
    assert.equal(holdMatchesSignal(human, { id: 's2', kind: 'human', occurredAt: 2, askId: 'ask_1', askToken: 'tok_1' }), true);
  });
});
