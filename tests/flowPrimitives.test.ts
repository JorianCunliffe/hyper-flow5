import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeType, type Project } from '../types';
import { advanceFlow, isNodeComplete } from '../lib/flowEngine';
import { advanceProjectFlow, applyActionRun } from '../lib/flowOrchestrator';
import { applyFlowEvent, eventMatchesTrigger } from '../lib/flowEvents';
import { checkReadyCondition } from '../lib/taskReadinessUtils';
import { dailyCoachingTemplate } from '../lib/projectTemplates';
import { action, decision, node, project } from './helpers';

describe('generic decision conditions', () => {
  test('supports oneOf, notEquals and exists false', () => {
    const data = { disposition: 'busy', ok: false };
    assert.equal(checkReadyCondition({ variable: 'disposition', oneOf: ['busy', 'voicemail'] }, data), true);
    assert.equal(checkReadyCondition({ variable: 'disposition', notEquals: 'wrong_number' }, data), true);
    assert.equal(checkReadyCondition({ variable: 'missing', exists: false }, data), true);
  });
});

describe('action results are graph data', () => {
  test('continue-on-error completes the action and exposes standard result fields', () => {
    const a = action('CALL', NodeType.PHONE_CALL, {
      actionConfig: { template: '{}', failureMode: 'continue', resultVariable: 'call_result' }
    });
    const p = project([a]);
    const next = applyActionRun(p, 'CALL', {
      at: 1,
      status: 'error',
      error: 'no answer',
      output: { disposition: 'no_answer', successful: false, failure_code: 'NO_ANSWER' },
      communicationOutcome: { disposition: 'no_answer', successful: false, failureCode: 'NO_ANSWER' }
    });
    assert.equal(isNodeComplete(next.milestones[0], next.projectData), true);
    assert.equal(next.projectData?.call_result, 'error');
    assert.equal(next.projectData?.call_result_success, false);
    assert.equal(next.projectData?.call_result_disposition, 'no_answer');
    assert.equal(next.projectData?.call_result_failure_code, 'NO_ANSWER');
  });

  test('a failed action is never silently redispatched by another advance', async () => {
    const a = action('ACT', NodeType.EMAIL, {
      actionConfig: { template: '{}', autoExecute: true, lastRun: { at: 1, status: 'error', error: 'boom' } }
    });
    let executions = 0;
    const result = await advanceProjectFlow(project([a]), async () => {
      executions += 1;
      return { status: 'success' as const };
    });
    assert.equal(executions, 0);
    assert.equal(result.project.milestones[0].actionConfig?.lastRun?.status, 'error');
  });
});

describe('WAIT / END primitives', () => {
  test('WAIT arms a durable occurrence-scoped timer instead of completing immediately', () => {
    const wait = node('WAIT', {
      nodeType: NodeType.WAIT,
      waitConfig: { kind: 'timer', durationMinutes: 10 }
    });
    const p = project([wait], { flow_occurrence_id: 'event:e1' });
    const next = advanceFlow(p).project.milestones[0];
    assert.equal(next.waitConfig?.occurrenceId, 'event:e1');
    assert.ok(Number(next.waitConfig?.resumeAt) > Date.now());
    assert.equal(next.waitConfig?.resolvedAt, undefined);
  });

  test('END explicitly completes a ready branch', () => {
    const end = node('END', { nodeType: NodeType.END });
    const next = advanceFlow(project([end])).project.milestones[0];
    assert.ok(next.completedAt);
    assert.equal(isNodeComplete(next), true);
  });
});

describe('EVENT_TRIGGER primitive', () => {
  const trigger = node('EVENT', {
    nodeType: NodeType.EVENT_TRIGGER,
    eventTriggerConfig: {
      eventTypes: ['communication.received'],
      channels: ['sms'],
      directions: ['inbound'],
      payloadVariable: 'inbound_event'
    }
  });

  test('matches only configured trusted event metadata', () => {
    assert.equal(eventMatchesTrigger(trigger.eventTriggerConfig, {
      id: 'e1', type: 'communication.received', occurredAt: 1, channel: 'sms', direction: 'inbound'
    }), true);
    assert.equal(eventMatchesTrigger(trigger.eventTriggerConfig, {
      id: 'e2', type: 'communication.received', occurredAt: 1, channel: 'email', direction: 'inbound'
    }), false);
  });

  test('starts a generic flow occurrence and writes only the configured payload variable', () => {
    const p = project([trigger]);
    const event = {
      id: 'e1',
      type: 'communication.received',
      occurredAt: 10,
      channel: 'sms',
      direction: 'inbound',
      personId: 'person_1',
      communicationId: 'comm_1',
      payload: { text: 'call me' }
    };
    const applied = applyFlowEvent(p, event);
    assert.deepEqual(applied.matchedNodeIds, ['EVENT']);
    assert.equal(applied.project.projectData?.flow_occurrence_id, 'event:e1');
    assert.deepEqual(applied.project.projectData?.inbound_event, { text: 'call me' });
    assert.equal(applied.project.milestones[0].eventTriggerConfig?.lastEventId, 'e1');
  });
});

describe('generated coaching uses ordinary flow primitives', () => {
  test('retry behavior is Call -> Decision -> Wait -> Loop -> End', () => {
    const template = dailyCoachingTemplate({ retryAttempts: 2, retryDelayMinutes: 10 });
    const byId = new Map(template.milestones.map(item => [item.id, item]));
    assert.equal(byId.get('COACH_CALL')?.actionConfig?.failureMode, 'continue');
    assert.equal(byId.get('COACH_CALL')?.actionConfig?.resultVariable, 'coaching_call_result');
    assert.equal(byId.get('COACH_CALL_ROUTE')?.nodeType, NodeType.DECISION);
    assert.equal(byId.get('COACH_RETRY_WAIT')?.nodeType, NodeType.WAIT);
    assert.equal(byId.get('COACH_RETRY_LOOP')?.nodeType, NodeType.LOOP);
    assert.equal(byId.get('COACH_RETRIES_END')?.nodeType, NodeType.END);
  });
});
