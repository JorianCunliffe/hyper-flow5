import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeType } from '../types';
import { advanceFlow, getHoldConfig } from '../lib/flowEngine';
import type { RuntimeMilestone } from '../lib/flowRuntimeTypes';
import { node, project } from './helpers';

const timerWait = (minutes: number): RuntimeMilestone => ({
  ...node('WAIT', { nodeType: NodeType.WAIT }),
  holdConfig: { kind: 'timer', durationMinutes: minutes }
});

describe('durable hold duration bounds', () => {
  test('honors a configured two-day timer instead of silently clamping it to one day', () => {
    const result = advanceFlow(project([timerWait(2 * 24 * 60)], { flow_occurrence_id: 'manual:two-day' }));
    const hold = getHoldConfig(result.project.milestones[0]);
    assert.equal(hold?.durationMinutes, 2 * 24 * 60);
    assert.equal(Number(hold?.availableAt) - Number(hold?.armedAt), 2 * 24 * 60 * 60_000);
  });

  test('caps human-configurable timer waits at seven days', () => {
    const result = advanceFlow(project([timerWait(30 * 24 * 60)], { flow_occurrence_id: 'manual:bounded' }));
    const hold = getHoldConfig(result.project.milestones[0]);
    assert.equal(hold?.durationMinutes, 7 * 24 * 60);
    assert.equal(Number(hold?.availableAt) - Number(hold?.armedAt), 7 * 24 * 60 * 60_000);
  });
});
