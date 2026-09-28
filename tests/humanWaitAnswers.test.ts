import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAskResponse, collectValues, collectAttachments } from '../lib/humanAsk.js';
import { resolveHumanWait } from '../lib/asks/respondToAsk.js';
import { NodeType, type HumanAsk, type HumanResponse, type Project } from '../types.js';
import type { RuntimeMilestone } from '../lib/flowRuntimeTypes.js';

const ask = (): HumanAsk => ({ id: 'ask', nodeId: 'wait', projectId: 'project', kind: 'question', status: 'open',
  fields: [{ name: 'time', type: 'text', required: true }, { name: 'capacity', type: 'number', required: true }],
  responses: [], assignees: ['team'], channels: ['voice', 'sms'] } as HumanAsk);
const response = (id: string, values: Record<string, unknown>, provisional = false): HumanResponse => ({
  id, at: 1, via: 'sms', actor: 'team', values, needsInterpretation: provisional
});
const project = (): Project => ({ id: 'project', name: 'Fixture', company: 'Test', type: 'Other', startDate: 0, createdAt: 0, updatedAt: 0,
  milestones: [{ id: 'wait', name: 'Wait', subtasks: [], nodeType: NodeType.WAIT,
  holdConfig: { kind: 'human', holdId: 'hold', payloadVariable: 'team_answers', resultVariable: 'team_result' }
} as RuntimeMilestone], projectData: {} });

test('provisional fields cannot satisfy remaining questions or replace accepted values', () => {
  let current = recordAskResponse(ask(), response('unreviewed', { time: 'invented' }, true));
  current = recordAskResponse(current, response('accepted', { capacity: 2 }));
  assert.equal(current.status, 'open');
  assert.deepEqual(collectValues(current), { capacity: 2 });
  current = recordAskResponse(current, response('confirmed', { time: '14:00' }));
  assert.equal(current.status, 'answered');
  current = recordAskResponse(current, response('later-unreviewed', { time: '15:00' }, true));
  assert.deepEqual(collectValues(current), { capacity: 2, time: '14:00' });
});

test('human hold finalisation retains accepted answers across voice and SMS replies', () => {
  const first = { ...response('voice', { time: '14:00' }), via: 'voice' as const };
  const last = response('sms', { capacity: 2 });
  const current = recordAskResponse(recordAskResponse(ask(), first), last);
  const resolved = resolveHumanWait(project(), 'wait', current, last, 10);
  assert.deepEqual(resolved.projectData?.team_answers.values, { time: '14:00', capacity: 2 });
  assert.deepEqual(resolved.projectData?.team_result_payload.values, { time: '14:00', capacity: 2 });
  assert.equal((resolved.milestones[0] as any).holdConfig.resolvedAt, 10);
  assert.equal(resolveHumanWait(resolved, 'wait', current, last, 20), resolved);
  const untouched = project();
  assert.equal(resolveHumanWait(untouched, 'wait', ask(), last, 10), untouched);
  assert.equal(resolveHumanWait(untouched, 'wait', { ...current, nodeId: 'other' }, last, 10), untouched);
});

test('provisional attachments are excluded from accepted response data', () => {
  const current = ask();
  current.responses = [{ ...response('pending', {}, true), attachments: [{ id: 'pending', url: 'https://example.invalid/pending' }] },
    { ...response('accepted', {}), attachments: [{ id: 'accepted', url: 'https://example.invalid/accepted' }] }] as HumanResponse[];
  assert.deepEqual(collectAttachments(current).map(a => a.id), ['accepted']);
});
