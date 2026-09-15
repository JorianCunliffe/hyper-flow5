import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAskFields } from '../lib/asks/askFieldSource';
import { askFieldPrompt, askSchemaSummary, nextAskField, pendingAskFields, smsStepValues } from '../lib/asks/askSteps';
import { createHumanHoldAsk } from '../lib/flowHoldAsk';
import type { HumanAsk, Project } from '../types';

describe('dynamic Human Ask fields', () => {
  test('materialises and normalises a schema from project data', () => {
    const fields = resolveAskFields({
      plan: {
        questions: [
          'inspection_time',
          { name: 'approved', label: 'Approve booking', type: 'boolean', required: true },
          { name: 'room', type: 'string', required: false, options: ['A', 'B'] }
        ]
      }
    }, undefined, 'plan.questions');

    assert.deepEqual(fields, [
      { name: 'inspection_time', label: 'Inspection Time', type: 'string', required: true },
      { name: 'approved', label: 'Approve booking', type: 'boolean', required: true },
      { name: 'room', label: 'Room', type: 'string', required: false, options: ['A', 'B'] }
    ]);
  });

  test('rejects invalid and duplicate field contracts', () => {
    assert.throws(() => resolveAskFields({ questions: [{ name: 'bad field' }] }, undefined, 'questions'), /invalid name/);
    assert.throws(() => resolveAskFields({ questions: ['answer', 'answer'] }, undefined, 'questions'), /duplicate field/);
    assert.throws(() => resolveAskFields({ questions: 'not-an-array' }, undefined, 'questions'), /must resolve to an array/);
  });

  test('freezes the resolved schema into a raised human hold ask', () => {
    const project = {
      id: 'p1', name: 'Sharehouse', company: 'Landmarx', type: 'Other', startDate: 1,
      createdAt: 1, updatedAt: 1,
      projectData: {
        flow_run_id: 'flow_1',
        daily_plan: { open_questions: ['inspection_time', { name: 'room', required: true }] }
      },
      milestones: [{
        id: 'ask_team', name: 'Ask team', subtasks: [], dependsOn: [], estimatedDuration: 0,
        nodeType: 'wait',
        holdConfig: {
          kind: 'human',
          human: { kind: 'question', fieldsSource: 'daily_plan.open_questions', channels: ['sms'] }
        }
      }]
    } as unknown as Project;

    const ask = createHumanHoldAsk(project, project.milestones[0]);
    assert.equal(ask.runId, 'flow_1');
    assert.deepEqual(ask.fields?.map(field => field.name), ['inspection_time', 'room']);

    (project.projectData!.daily_plan.open_questions as unknown[]) = ['changed_after_raise'];
    assert.deepEqual(ask.fields?.map(field => field.name), ['inspection_time', 'room']);
  });
});

describe('schema-driven Ask steps', () => {
  const ask = (responses: HumanAsk['responses'] = []): HumanAsk => ({
    id: 'a1', token: 'token', kind: 'question', status: 'open', prompt: 'Please confirm the inspection details.',
    nodeId: 'n1', runId: 'r1', assignees: ['person_1'], channels: ['sms'], createdAt: 1,
    fields: [
      { name: 'inspection_time', label: 'Inspection time', type: 'string', required: true },
      { name: 'party_size', label: 'Party size', type: 'number', required: true },
      { name: 'notes', label: 'Notes', type: 'string', required: false }
    ],
    responses
  });

  test('asks one unanswered field at a time', () => {
    const first = ask();
    assert.equal(nextAskField(first)?.name, 'inspection_time');
    assert.equal(askFieldPrompt(nextAskField(first)!), 'Inspection time?');
    assert.match(askSchemaSummary(first), /1\. Inspection time\?/);
    assert.deepEqual(smsStepValues(first, '10:30am'), { inspection_time: '10:30am' });

    const second = ask([{ id: 'resp1', at: 2, via: 'sms', actor: 'person_1', values: { inspection_time: '10:30am' } }]);
    assert.equal(nextAskField(second)?.name, 'party_size');
    assert.deepEqual(pendingAskFields(second).map(field => field.name), ['party_size', 'notes']);
    assert.deepEqual(smsStepValues(second, '3'), { party_size: '3' });
  });
});
