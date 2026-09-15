import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { presentFlowRun } from '../lib/flowRunPresentation';
import type { FlowRun } from '../lib/flowRuntimeTypes';

describe('FlowRun history presentation', () => {
  test('exposes execution metadata without leaking run state or Ask identities', () => {
    const run: FlowRun = {
      id: 'run_1', orgId: 'org_1', projectId: 'project_1', flowId: 'coaching', occurrenceId: 'occ_1',
      trigger: 'schedule', triggerId: 'schedule_1', status: 'waiting', revision: 3,
      startedAt: 10, updatedAt: 20,
      state: {
        projectData: { secret: 'do-not-return' },
        milestones: []
      },
      nodeRuns: {
        CALL: [{
          id: 'node_run_1', flowRunId: 'run_1', nodeId: 'CALL', nodeType: 'PHONE_CALL', attempt: 1,
          status: 'waiting', startedAt: 11, updatedAt: 19, actionRunId: 'action_1',
          holdIds: ['hold_1'], askIds: ['ask_secret']
        }]
      }
    };

    const presented = presentFlowRun(run) as any;
    assert.equal(presented.occurrenceId, 'occ_1');
    assert.equal(presented.nodes[0].attemptCount, 1);
    assert.equal(presented.nodes[0].attempts[0].askCount, 1);
    assert.equal('state' in presented, false);
    assert.equal('askIds' in presented.nodes[0].attempts[0], false);
    assert.equal(JSON.stringify(presented).includes('do-not-return'), false);
    assert.equal(JSON.stringify(presented).includes('ask_secret'), false);
  });
});
