import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionExecutor,
  advanceProjectFlow,
  applyActionRun,
  findNodeByRun,
  resolvePendingRun,
  runActionNode
} from '../lib/flowOrchestrator';
import { NodeType } from '../types';
import { action, doneMilestone, openMilestone, project, resetSeq } from './helpers';

beforeEach(resetSeq);

/** An executor that records its calls and returns whatever it is told to. */
const stubExecutor = (outcomes: any[] | any) => {
  const calls: any[] = [];
  const queue = Array.isArray(outcomes) ? [...outcomes] : null;
  const fn: ActionExecutor = async (taskType, templateFile, projectData, ctx) => {
    calls.push({ taskType, templateFile, projectData, ctx });
    return queue ? queue.shift() ?? { status: 'success' } : outcomes;
  };
  return { fn, calls };
};

describe('applyActionRun', () => {
  test('merges output into projectData on success', () => {
    const p = project([action('A')], { existing: 1 });
    const next = applyActionRun(p, 'A', { id: 'r1', at: 1, status: 'success', output: { sms_sent: true } });
    assert.deepEqual(next.projectData, { existing: 1, sms_sent: true });
  });

  test('does NOT merge output for a pending run', () => {
    const p = project([action('A')], { existing: 1 });
    const next = applyActionRun(p, 'A', { id: 'r1', at: 1, status: 'pending', output: { call_id: 'c1' } });
    assert.deepEqual(next.projectData, { existing: 1 }, 'a dispatched-but-unfinished call must not write project data');
  });

  test('does NOT merge output for a failed run', () => {
    const p = project([action('A')], { existing: 1 });
    const next = applyActionRun(p, 'A', { id: 'r1', at: 1, status: 'error', output: { junk: true }, error: 'boom' });
    assert.deepEqual(next.projectData, { existing: 1 });
  });

  test('ignores non-object output rather than corrupting projectData', () => {
    const p = project([action('A')], { existing: 1 });
    const next = applyActionRun(p, 'A', { id: 'r1', at: 1, status: 'success', output: ['a', 'b'] });
    assert.deepEqual(next.projectData, { existing: 1 });
  });

  test('archives the previous run when a new one starts', () => {
    let p = project([action('A', NodeType.EMAIL, { actionConfig: { template: '', lastRun: { id: 'r1', at: 1, status: 'error' } } })]);
    p = applyActionRun(p, 'A', { id: 'r2', at: 2, status: 'success' });
    const cfg = p.milestones[0].actionConfig!;
    assert.equal(cfg.lastRun!.id, 'r2');
    assert.deepEqual(cfg.runHistory!.map(r => r.id), ['r1']);
  });

  test('resolving a pending run updates it in place instead of archiving a duplicate', () => {
    let p = project([action('A', NodeType.EMAIL, { actionConfig: { template: '', lastRun: { id: 'r1', at: 1, status: 'pending' } } })]);
    p = applyActionRun(p, 'A', { id: 'r1', at: 1, status: 'success', resolvedAt: 5 });
    const cfg = p.milestones[0].actionConfig!;
    assert.equal(cfg.lastRun!.status, 'success');
    assert.equal(cfg.runHistory, undefined, 'the same run resolving is not a second run');
  });
});

describe('runActionNode', () => {
  test('passes correlation ids to the executor so callbacks can find the run', async () => {
    const p = project([action('CALL', NodeType.PHONE_CALL, { actionConfig: { template: '{"to":"+61..."}' } })]);
    const { fn, calls } = stubExecutor({ status: 'pending', externalId: 'call_1' });

    const { project: next } = await runActionNode(p, 'CALL', fn, { orgId: 'org_1' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].taskType, 'outgoing_call');
    assert.equal(calls[0].ctx.orgId, 'org_1');
    assert.equal(calls[0].ctx.projectId, 'p1');
    assert.equal(calls[0].ctx.nodeId, 'CALL');
    assert.ok(calls[0].ctx.runId, 'a run id is generated');

    const run = next.milestones[0].actionConfig!.lastRun!;
    assert.equal(run.id, calls[0].ctx.runId, 'the recorded run id matches what the provider was given');
    assert.equal(run.status, 'pending');
    assert.equal(run.externalId, 'call_1');
  });

  test('a thrown executor becomes a failed run, not an exception', async () => {
    const p = project([action('A')]);
    const boom: ActionExecutor = async () => { throw new Error('network down'); };

    const { project: next } = await runActionNode(p, 'A', boom);
    const run = next.milestones[0].actionConfig!.lastRun!;
    assert.equal(run.status, 'error');
    assert.equal(run.error, 'network down');
  });

  test('a non-action node is rejected without calling the executor', async () => {
    const p = project([openMilestone('M')]);
    const { fn, calls } = stubExecutor({ status: 'success' });
    const { log } = await runActionNode(p, 'M', fn);
    assert.equal(calls.length, 0);
    assert.match(log.join(), /not an executable action node/);
  });
});

describe('resolvePendingRun', () => {
  const pendingProject = () =>
    project([
      action('CALL', NodeType.PHONE_CALL, {
        actionConfig: { template: '', lastRun: { id: 'r1', at: 1, status: 'pending', externalId: 'call_1', logs: ['dialing'] } }
      })
    ]);

  test('resolves by external id and merges the callback output', () => {
    const res = resolvePendingRun(pendingProject(), { externalId: 'call_1' }, {
      status: 'success',
      output: { proposal_interest: true },
      logs: ['callback'],
      resolvedBy: 'webhook:bland'
    });

    assert.ok(res);
    assert.equal(res!.nodeId, 'CALL');
    assert.equal(res!.project.projectData!.proposal_interest, true, 'output reaches projectData once the run succeeds');
    const run = res!.project.milestones[0].actionConfig!.lastRun!;
    assert.equal(run.status, 'success');
    assert.equal(run.resolvedBy, 'webhook:bland');
    assert.deepEqual(run.logs, ['dialing', 'callback'], 'dispatch logs are preserved');
  });

  test('resolves by run id', () => {
    const res = resolvePendingRun(pendingProject(), { runId: 'r1' }, { status: 'success', resolvedBy: 'webhook:bland' });
    assert.ok(res);
    assert.equal(res!.nodeId, 'CALL');
  });

  test('returns null when the run is already resolved — a duplicate callback is a no-op', () => {
    const p = pendingProject();
    p.milestones[0].actionConfig!.lastRun!.status = 'success';
    const res = resolvePendingRun(p, { externalId: 'call_1' }, { status: 'success', resolvedBy: 'webhook:bland' });
    assert.equal(res, null);
  });

  test('returns null for an unknown external id', () => {
    const res = resolvePendingRun(pendingProject(), { externalId: 'nope' }, { status: 'success', resolvedBy: 'webhook:bland' });
    assert.equal(res, null);
  });

  test('a failed callback does not write project data', () => {
    const res = resolvePendingRun(pendingProject(), { externalId: 'call_1' }, {
      status: 'error',
      output: { proposal_interest: true },
      error: 'no answer',
      resolvedBy: 'webhook:bland'
    });
    assert.ok(res);
    assert.deepEqual(res!.project.projectData, {});
    assert.equal(res!.project.milestones[0].actionConfig!.lastRun!.status, 'error');
  });

  test('findNodeByRun does not match a node with no run at all', () => {
    const p = project([action('A')]);
    assert.equal(findNodeByRun(p, { externalId: 'x' }), undefined);
  });
});

describe('advanceProjectFlow', () => {
  test('runs a ready auto-execute action and folds its output into project data', async () => {
    const p = project([
      doneMilestone('A'),
      action('SEND', NodeType.EMAIL, { dependsOn: ['A'], actionConfig: { template: '', autoExecute: true } })
    ]);
    const { fn } = stubExecutor({ status: 'success', output: { email_sent: true } });

    const { project: next, log } = await advanceProjectFlow(p, fn);
    assert.equal(next.projectData!.email_sent, true);
    assert.match(log.join('\n'), /executed successfully/);
  });

  test('an action output satisfies a downstream decision in the same call', async () => {
    const p = project([
      doneMilestone('A'),
      action('ASK', NodeType.PHONE_CALL, { dependsOn: ['A'], actionConfig: { template: '', autoExecute: true } }),
      {
        id: 'D',
        name: 'D',
        subtasks: [],
        dependsOn: ['ASK'],
        estimatedDuration: 1,
        nodeType: NodeType.DECISION,
        decisionConfig: {
          branches: [
            { targetId: 'YES', label: 'Yes', conditions: [{ variable: 'proposal_interest', equals: true }] },
            { targetId: 'NO', label: 'No' }
          ]
        }
      },
      openMilestone('YES', { dependsOn: ['D'] }),
      openMilestone('NO', { dependsOn: ['D'] })
    ]);
    const { fn } = stubExecutor({ status: 'success', output: { proposal_interest: true } });

    const { project: next } = await advanceProjectFlow(p, fn);
    assert.equal(
      next.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId,
      'YES',
      'the decision saw the action output without a second advance'
    );
  });

  test('a pending action stops the flow there and is reported as pending', async () => {
    const p = project([
      doneMilestone('A'),
      action('CALL', NodeType.PHONE_CALL, { dependsOn: ['A'], actionConfig: { template: '', autoExecute: true } }),
      action('AFTER', NodeType.EMAIL, { dependsOn: ['CALL'], actionConfig: { template: '', autoExecute: true } })
    ]);
    const { fn, calls } = stubExecutor({ status: 'pending', externalId: 'call_1' });

    const { project: next, pending } = await advanceProjectFlow(p, fn);
    assert.deepEqual(pending, ['CALL']);
    assert.equal(calls.length, 1, 'the downstream action must not run while the call is outstanding');
    assert.equal(next.milestones.find(m => m.id === 'AFTER')!.actionConfig!.lastRun, undefined);
  });

  test('a pending action is never re-dispatched on a later advance', async () => {
    const p = project([
      doneMilestone('A'),
      action('CALL', NodeType.PHONE_CALL, {
        dependsOn: ['A'],
        actionConfig: { template: '', autoExecute: true, lastRun: { id: 'r1', at: 1, status: 'pending', externalId: 'c1' } }
      })
    ]);
    const { fn, calls } = stubExecutor({ status: 'pending' });

    await advanceProjectFlow(p, fn);
    assert.equal(calls.length, 0, 'advancing again must not place a second call');
  });

  test('a failed action does not block a later retry but stops this pass', async () => {
    const p = project([
      doneMilestone('A'),
      action('SEND', NodeType.EMAIL, { dependsOn: ['A'], actionConfig: { template: '', autoExecute: true } })
    ]);
    const { fn } = stubExecutor({ status: 'error', error: 'smtp down' });

    const { project: next, log } = await advanceProjectFlow(p, fn, { maxRounds: 3 });
    assert.equal(next.milestones.find(m => m.id === 'SEND')!.actionConfig!.lastRun!.status, 'error');
    assert.match(log.join('\n'), /smtp down/);
  });

  test('reports an idle flow rather than an empty log', async () => {
    const { fn } = stubExecutor({ status: 'success' });
    const { log } = await advanceProjectFlow(project([doneMilestone('A')]), fn);
    assert.deepEqual(log, ['Flow is up to date — nothing to advance.']);
  });

  test('respects maxRounds so a misconfigured flow cannot spin forever', async () => {
    // A loop with no exit condition re-arms its body every round.
    const p = project([
      action('ACT', NodeType.EMAIL, { actionConfig: { template: '', autoExecute: true } }),
      {
        id: 'L',
        name: 'L',
        subtasks: [],
        dependsOn: ['ACT'],
        estimatedDuration: 1,
        nodeType: NodeType.LOOP,
        loopConfig: { loopStartId: 'ACT', exitConditions: [], maxIterations: 999, currentIteration: 0 }
      }
    ]);
    const { fn, calls } = stubExecutor({ status: 'success', output: {} });

    await advanceProjectFlow(p, fn, { maxRounds: 3 });
    assert.ok(calls.length <= 3, `expected at most 3 dispatches, got ${calls.length}`);
  });
});
