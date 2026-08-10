import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceFlow,
  getLoopBody,
  isNodeComplete,
  isNodeReady,
  resolveNodeStates
} from '../lib/flowEngine';
import { NodeType } from '../types';
import {
  action,
  decision,
  doneMilestone,
  loop,
  node,
  openMilestone,
  project,
  resetSeq,
  subtask
} from './helpers';

beforeEach(resetSeq);

describe('isNodeComplete', () => {
  test('milestone with all subtasks complete is complete', () => {
    assert.equal(isNodeComplete(doneMilestone('A')), true);
  });

  test('milestone accepts the legacy "Complete" status alongside "Completed"', () => {
    const legacy = node('A', { subtasks: [subtask({ status: 'Complete' })] });
    assert.equal(isNodeComplete(legacy), true);
  });

  test('milestone with no subtasks is NOT complete', () => {
    assert.equal(isNodeComplete(node('A')), false);
  });

  test('milestone with one incomplete subtask is not complete', () => {
    const m = node('A', { subtasks: [subtask({ status: 'Completed' }), subtask({ status: 'Started' })] });
    assert.equal(isNodeComplete(m), false);
  });

  test('decision is complete once a branch is selected', () => {
    const d = decision('D', [{ targetId: 'X', label: 'Yes' }]);
    assert.equal(isNodeComplete(d), false);
    d.decisionConfig!.selectedTargetId = 'X';
    assert.equal(isNodeComplete(d), true);
  });

  test('loop is complete only once exited', () => {
    const l = loop('L');
    assert.equal(isNodeComplete(l), false);
    l.loopConfig!.exited = true;
    assert.equal(isNodeComplete(l), true);
  });

  test('action node is complete only when its last run succeeded', () => {
    const a = action('A');
    assert.equal(isNodeComplete(a), false);

    a.actionConfig!.lastRun = { at: 1, status: 'error', error: 'boom' };
    assert.equal(isNodeComplete(a), false, 'a failed run must not complete the node');

    a.actionConfig!.lastRun = { at: 2, status: 'success' };
    assert.equal(isNodeComplete(a), true);
  });
});

describe('resolveNodeStates / isNodeReady', () => {
  test('a root node with no parents is ready', () => {
    const p = project([openMilestone('A')]);
    const states = resolveNodeStates(p);
    assert.equal(states.get('A'), 'pending');
    assert.equal(isNodeReady(p.milestones[0], states), true);
  });

  test('a child is not ready while its parent is pending', () => {
    const p = project([openMilestone('A'), openMilestone('B', { dependsOn: ['A'] })]);
    const states = resolveNodeStates(p);
    assert.equal(isNodeReady(p.milestones[1], states), false);
  });

  test('a child becomes ready once its parent completes', () => {
    const p = project([doneMilestone('A'), openMilestone('B', { dependsOn: ['A'] })]);
    const states = resolveNodeStates(p);
    assert.equal(states.get('A'), 'complete');
    assert.equal(isNodeReady(p.milestones[1], states), true);
  });

  test('a completed node is not itself "ready"', () => {
    const p = project([doneMilestone('A')]);
    const states = resolveNodeStates(p);
    assert.equal(isNodeReady(p.milestones[0], states), false);
  });

  test('a decided decision skips the branches it did not choose', () => {
    const p = project([
      decision('D', [{ targetId: 'YES', label: 'Yes' }, { targetId: 'NO', label: 'No' }], {
        decisionConfig: {
          branches: [{ targetId: 'YES', label: 'Yes' }, { targetId: 'NO', label: 'No' }],
          selectedTargetId: 'YES'
        }
      }),
      openMilestone('YES', { dependsOn: ['D'] }),
      openMilestone('NO', { dependsOn: ['D'] })
    ]);
    const states = resolveNodeStates(p);
    assert.equal(states.get('YES'), 'pending');
    assert.equal(states.get('NO'), 'skipped');
  });

  test('skip propagates transitively down an abandoned branch', () => {
    const p = project([
      decision('D', [], {
        decisionConfig: { branches: [{ targetId: 'YES', label: 'Y' }, { targetId: 'NO', label: 'N' }], selectedTargetId: 'YES' }
      }),
      openMilestone('YES', { dependsOn: ['D'] }),
      openMilestone('NO', { dependsOn: ['D'] }),
      openMilestone('NO_CHILD', { dependsOn: ['NO'] })
    ]);
    const states = resolveNodeStates(p);
    assert.equal(states.get('NO_CHILD'), 'skipped');
  });

  test('a join proceeds when one parent completed and the other was skipped', () => {
    const p = project([
      decision('D', [], {
        decisionConfig: { branches: [{ targetId: 'YES', label: 'Y' }, { targetId: 'NO', label: 'N' }], selectedTargetId: 'YES' }
      }),
      doneMilestone('YES', { dependsOn: ['D'] }),
      openMilestone('NO', { dependsOn: ['D'] }),
      openMilestone('JOIN', { dependsOn: ['YES', 'NO'] })
    ]);
    const states = resolveNodeStates(p);
    assert.equal(states.get('NO'), 'skipped');
    const join = p.milestones.find(m => m.id === 'JOIN')!;
    assert.equal(isNodeReady(join, states), true, 'a skipped parent must not block the join');
  });

  test('a join stays blocked while a parent is still pending', () => {
    const p = project([
      doneMilestone('A'),
      openMilestone('B'),
      openMilestone('JOIN', { dependsOn: ['A', 'B'] })
    ]);
    const states = resolveNodeStates(p);
    assert.equal(isNodeReady(p.milestones[2], states), false);
  });

  test('a node whose every parent is skipped is itself skipped', () => {
    const p = project([
      decision('D', [], {
        decisionConfig: { branches: [{ targetId: 'YES', label: 'Y' }, { targetId: 'NO', label: 'N' }], selectedTargetId: 'YES' }
      }),
      openMilestone('YES', { dependsOn: ['D'] }),
      openMilestone('NO', { dependsOn: ['D'] }),
      openMilestone('ONLY_NO_CHILD', { dependsOn: ['NO'] })
    ]);
    const states = resolveNodeStates(p);
    assert.equal(states.get('ONLY_NO_CHILD'), 'skipped');
  });

  test('a dependency cycle resolves without hanging', () => {
    const p = project([
      openMilestone('A', { dependsOn: ['B'] }),
      openMilestone('B', { dependsOn: ['A'] })
    ]);
    const states = resolveNodeStates(p);
    assert.equal(states.get('A'), 'pending');
    assert.equal(states.get('B'), 'pending');
  });
});

describe('advanceFlow — decisions', () => {
  test('selects the first branch whose conditions all pass', () => {
    const p = project(
      [
        decision('D', [
          { targetId: 'YES', label: 'Yes', conditions: [{ variable: 'interested', equals: true }] },
          { targetId: 'NO', label: 'No' }
        ]),
        openMilestone('YES', { dependsOn: ['D'] }),
        openMilestone('NO', { dependsOn: ['D'] })
      ],
      { interested: true }
    );
    const { project: next, log } = advanceFlow(p);
    const d = next.milestones.find(m => m.id === 'D')!;
    assert.equal(d.decisionConfig!.selectedTargetId, 'YES');
    assert.match(log.join('\n'), /selected branch "Yes"/);
  });

  test('falls back to the condition-less default branch', () => {
    const p = project(
      [
        decision('D', [
          { targetId: 'YES', label: 'Yes', conditions: [{ variable: 'interested', equals: true }] },
          { targetId: 'NO', label: 'No' }
        ]),
        openMilestone('YES', { dependsOn: ['D'] }),
        openMilestone('NO', { dependsOn: ['D'] })
      ],
      { interested: false }
    );
    const { project: next } = advanceFlow(p);
    assert.equal(next.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId, 'NO');
  });

  test('leaves a decision undecided when nothing matches and there is no default', () => {
    const p = project(
      [
        decision('D', [{ targetId: 'YES', label: 'Yes', conditions: [{ variable: 'interested', equals: true }] }]),
        openMilestone('YES', { dependsOn: ['D'] })
      ],
      { interested: false }
    );
    const { project: next } = advanceFlow(p);
    assert.equal(next.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId, undefined);
  });

  test('does not decide a decision whose dependencies are unresolved', () => {
    const p = project(
      [
        openMilestone('A'),
        decision('D', [{ targetId: 'YES', label: 'Yes' }], { dependsOn: ['A'] }),
        openMilestone('YES', { dependsOn: ['D'] })
      ],
      {}
    );
    const { project: next } = advanceFlow(p);
    assert.equal(next.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId, undefined);
  });

  test('an "exists" condition matches any non-null value', () => {
    const p = project(
      [
        decision('D', [
          { targetId: 'YES', label: 'Yes', conditions: [{ variable: 'answer', exists: true }] },
          { targetId: 'NO', label: 'No' }
        ]),
        openMilestone('YES', { dependsOn: ['D'] }),
        openMilestone('NO', { dependsOn: ['D'] })
      ],
      { answer: 'anything' }
    );
    const { project: next } = advanceFlow(p);
    assert.equal(next.milestones.find(m => m.id === 'D')!.decisionConfig!.selectedTargetId, 'YES');
  });
});

describe('advanceFlow — loops', () => {
  test('exits when the exit conditions are met', () => {
    const p = project(
      [
        doneMilestone('BODY'),
        loop('L', { loopStartId: 'BODY', exitConditions: [{ variable: 'approved', equals: true }] }, { dependsOn: ['BODY'] })
      ],
      { approved: true }
    );
    const { project: next, log } = advanceFlow(p);
    assert.equal(next.milestones.find(m => m.id === 'L')!.loopConfig!.exited, true);
    assert.match(log.join('\n'), /condition met/);
  });

  test('iterates and resets the body when exit conditions are unmet', () => {
    const p = project(
      [
        doneMilestone('BODY'),
        loop('L', { loopStartId: 'BODY', exitConditions: [{ variable: 'approved', equals: true }] }, { dependsOn: ['BODY'] })
      ],
      { approved: false }
    );
    const { project: next } = advanceFlow(p);
    const l = next.milestones.find(m => m.id === 'L')!;
    assert.equal(l.loopConfig!.exited, undefined);
    assert.equal(l.loopConfig!.currentIteration, 1);

    const body = next.milestones.find(m => m.id === 'BODY')!;
    assert.equal(body.subtasks[0].status, 'Not started', 'body subtasks reset for the next iteration');
    assert.equal(body.completedAt, undefined);
  });

  test('exits once max iterations are reached', () => {
    const p = project(
      [
        doneMilestone('BODY'),
        loop(
          'L',
          { loopStartId: 'BODY', exitConditions: [{ variable: 'approved', equals: true }], maxIterations: 2, currentIteration: 2 },
          { dependsOn: ['BODY'] }
        )
      ],
      { approved: false }
    );
    const { project: next, log } = advanceFlow(p);
    assert.equal(next.milestones.find(m => m.id === 'L')!.loopConfig!.exited, true);
    assert.match(log.join('\n'), /max iterations reached/);
  });

  test('a loop with no exit conditions iterates rather than exiting immediately', () => {
    const p = project([
      doneMilestone('BODY'),
      loop('L', { loopStartId: 'BODY', exitConditions: [] }, { dependsOn: ['BODY'] })
    ]);
    const { project: next } = advanceFlow(p);
    const l = next.milestones.find(m => m.id === 'L')!;
    assert.equal(l.loopConfig!.exited, undefined);
    assert.equal(l.loopConfig!.currentIteration, 1);
  });

  test('resetting the body re-arms actions and archives the prior run', () => {
    const p = project(
      [
        action('ACT', NodeType.EMAIL, {
          actionConfig: { template: 'x', lastRun: { at: 9, status: 'success', output: { ok: true } } }
        }),
        loop('L', { loopStartId: 'ACT', exitConditions: [{ variable: 'done', equals: true }] }, { dependsOn: ['ACT'] })
      ],
      { done: false }
    );
    const { project: next } = advanceFlow(p);

    const act = next.milestones.find(m => m.id === 'ACT')!;
    assert.equal(act.actionConfig!.lastRun, undefined, 'action is re-armed for the next iteration');
    assert.deepEqual(act.actionConfig!.runHistory?.map(r => r.at), [9], 'prior run is archived, not lost');
  });

  test('resetting the body re-opens decisions, which are then re-evaluated against current data', () => {
    // The reset clears selectedTargetId; a later pass in the same advanceFlow call
    // re-decides. With `go` now false, the second evaluation must pick the other branch.
    const p = project(
      [
        decision(
          'D',
          [
            { targetId: 'YES', label: 'Yes', conditions: [{ variable: 'go', equals: true }] },
            { targetId: 'NO', label: 'No' }
          ],
          {
            decisionConfig: {
              branches: [
                { targetId: 'YES', label: 'Yes', conditions: [{ variable: 'go', equals: true }] },
                { targetId: 'NO', label: 'No' }
              ],
              selectedTargetId: 'YES',
              decidedAt: 5
            }
          }
        ),
        doneMilestone('YES', { dependsOn: ['D'] }),
        openMilestone('NO', { dependsOn: ['D'] }),
        loop('L', { loopStartId: 'D', exitConditions: [{ variable: 'done', equals: true }] }, { dependsOn: ['YES'] })
      ],
      { done: false, go: false }
    );
    const { project: next } = advanceFlow(p);

    const d = next.milestones.find(m => m.id === 'D')!;
    assert.equal(
      d.decisionConfig!.selectedTargetId,
      'NO',
      'the decision was reset and re-decided against the updated project data'
    );
    assert.notEqual(d.decisionConfig!.decidedAt, 5, 'decidedAt is stamped fresh');
  });
});

describe('getLoopBody', () => {
  test('returns the nodes between the loop start and the loop node', () => {
    const p = project([
      openMilestone('OUTSIDE'),
      openMilestone('START', { dependsOn: ['OUTSIDE'] }),
      openMilestone('MID', { dependsOn: ['START'] }),
      loop('L', { loopStartId: 'START' }, { dependsOn: ['MID'] }),
      openMilestone('AFTER', { dependsOn: ['L'] })
    ]);
    const body = getLoopBody(p, p.milestones.find(m => m.id === 'L')!).sort();
    assert.deepEqual(body, ['MID', 'START']);
  });

  test('returns nothing when no loop start is configured', () => {
    const p = project([loop('L')]);
    assert.deepEqual(getLoopBody(p, p.milestones[0]), []);
  });
});

describe('advanceFlow — action scheduling', () => {
  test('collects ready auto-execute actions', () => {
    const p = project([
      doneMilestone('A'),
      action('SEND', NodeType.EMAIL, { dependsOn: ['A'], actionConfig: { template: '', autoExecute: true } })
    ]);
    const { actionsToRun } = advanceFlow(p);
    assert.deepEqual(actionsToRun, ['SEND']);
  });

  test('ignores actions that are not marked auto-execute', () => {
    const p = project([
      doneMilestone('A'),
      action('SEND', NodeType.EMAIL, { dependsOn: ['A'], actionConfig: { template: '', autoExecute: false } })
    ]);
    assert.deepEqual(advanceFlow(p).actionsToRun, []);
  });

  test('ignores auto-execute actions whose dependencies are unresolved', () => {
    const p = project([
      openMilestone('A'),
      action('SEND', NodeType.EMAIL, { dependsOn: ['A'], actionConfig: { template: '', autoExecute: true } })
    ]);
    assert.deepEqual(advanceFlow(p).actionsToRun, []);
  });

  test('does not re-run an action that already succeeded', () => {
    const p = project([
      doneMilestone('A'),
      action('SEND', NodeType.EMAIL, {
        dependsOn: ['A'],
        actionConfig: { template: '', autoExecute: true, lastRun: { at: 1, status: 'success' } }
      })
    ]);
    assert.deepEqual(advanceFlow(p).actionsToRun, []);
  });

  test('re-runs an action whose last attempt failed', () => {
    const p = project([
      doneMilestone('A'),
      action('SEND', NodeType.EMAIL, {
        dependsOn: ['A'],
        actionConfig: { template: '', autoExecute: true, lastRun: { at: 1, status: 'error', error: 'boom' } }
      })
    ]);
    assert.deepEqual(advanceFlow(p).actionsToRun, ['SEND']);
  });

  test('skipped action nodes are never scheduled', () => {
    const p = project([
      decision('D', [], {
        decisionConfig: { branches: [{ targetId: 'YES', label: 'Y' }, { targetId: 'NO', label: 'N' }], selectedTargetId: 'YES' }
      }),
      openMilestone('YES', { dependsOn: ['D'] }),
      action('NO', NodeType.SMS, { dependsOn: ['D'], actionConfig: { template: '', autoExecute: true } })
    ]);
    assert.deepEqual(advanceFlow(p).actionsToRun, []);
  });

  test('a decision made this pass unblocks an action in the same call', () => {
    const p = project(
      [
        doneMilestone('A'),
        decision('D', [{ targetId: 'SEND', label: 'Yes', conditions: [{ variable: 'go', equals: true }] }], { dependsOn: ['A'] }),
        action('SEND', NodeType.EMAIL, { dependsOn: ['D'], actionConfig: { template: '', autoExecute: true } })
      ],
      { go: true }
    );
    const { actionsToRun } = advanceFlow(p);
    assert.deepEqual(actionsToRun, ['SEND'], 'decision and downstream action settle in one advance');
  });

  test('advancing a settled flow reports no work and mutates nothing', () => {
    const p = project([doneMilestone('A')]);
    const { project: next, actionsToRun, log } = advanceFlow(p);
    assert.deepEqual(actionsToRun, []);
    assert.deepEqual(log, []);
    assert.deepEqual(next.milestones, p.milestones);
  });

  test('advanceFlow does not mutate the project it is given', () => {
    const p = project(
      [
        decision('D', [{ targetId: 'YES', label: 'Yes' }]),
        openMilestone('YES', { dependsOn: ['D'] })
      ],
      {}
    );
    const before = JSON.stringify(p);
    advanceFlow(p);
    assert.equal(JSON.stringify(p), before);
  });
});
