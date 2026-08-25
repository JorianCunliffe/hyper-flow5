import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { prepareProjectNodeForRun } from '../lib/nodeRunPreparation.js';
import type { Project } from '../types.js';

const project = {
  id: 'project-1',
  name: 'Test',
  milestones: [
    {
      id: 'node-1',
      name: 'Call',
      subtasks: [],
      dependsOn: [],
      nodeType: 'Phone Call',
      actionConfig: {
        template: 'old',
        lastRun: { id: 'run-old', status: 'error', startedAt: 1 }
      }
    },
    { id: 'node-2', name: 'Other', subtasks: [], dependsOn: [] }
  ]
} as unknown as Project;

describe('node run preparation', () => {
  test('runs the modal configuration without mutating or separately saving the project', () => {
    const prepared = prepareProjectNodeForRun(project, 'node-1', {
      actionConfig: {
        ...project.milestones[0].actionConfig,
        template: 'new'
      }
    });

    assert.equal(project.milestones[0].actionConfig?.template, 'old');
    assert.equal(prepared.milestones[0].actionConfig?.template, 'new');
    assert.equal(prepared.milestones[0].actionConfig?.lastRun?.id, 'run-old');
    assert.equal(prepared.milestones[1], project.milestones[1]);
  });
});
