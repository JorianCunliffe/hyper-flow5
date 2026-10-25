import test from 'node:test';
import assert from 'node:assert/strict';
import { coachingReviewAllowsNextOccurrence } from '../lib/coachingSchedule.js';
import { deliverRaisedAsks } from '../lib/asks/deliverRaisedAsks.js';
import { CommunicationsApiError } from '../lib/communications/errors.js';
import { ActionRecoveryRequired } from '../lib/actionDispatch.js';
import { buildScheduleCompletionUpdates, normalizeTenantSchedule } from '../lib/serverStore.js';
import { NodeType } from '../types.js';
import { dailyCoachingTemplate } from '../lib/projectTemplates.js';
import { action, project } from './helpers.js';

function reviewProject() {
  const ask: any = { id: 'review', token: 'token', kind: 'approval', status: 'open',
    nodeId: 'EXTRACT', runId: 'extract-1', channels: ['web', 'email'], assignees: ['reviewer'], deliveries: [] };
  return project([
    action('CALL', NodeType.PHONE_CALL, { actionConfig: { template: '{}', lastRun: { id: 'call-1', status: 'success', at: 1 } } }),
    action('EXTRACT', NodeType.COACHING_EXTRACT, { dependsOn: ['CALL'], reviewPolicy: { required: true },
      actionConfig: { template: '{}', lastRun: { id: 'extract-1', status: 'success', at: 2 } }, asks: [ask] }),
    action('WRITE', NodeType.GOOGLE_SHEET_APPEND, { dependsOn: ['EXTRACT'] })
  ], { project_template: 'daily_coaching' });
}

test('draft-only notification preserves the coaching review without a durable dispatch or accepted receipt', async () => {
  const p = reviewProject();
  let dispatches = 0;
  const result = await deliverRaisedAsks(p, 'org', [{ nodeId: 'EXTRACT', ask: p.milestones[1].asks![0] }], {
    readTenantCommunicationsSettings: async () => ({}),
    assertEmailAllowed: async () => { throw new CommunicationsApiError('Email is draft-only for this organization.', 403); },
    resolveAskRecipient: async () => { throw new Error('Recipient lookup should not occur'); },
    durableActionExecutor: () => { dispatches++; throw new Error('Provider dispatch should not occur'); },
    deliverAsk: async () => { throw new Error('Email should not be sent'); }
  } as any);
  const ask = result.project.milestones[1].asks![0];
  assert.equal(dispatches, 0);
  assert.equal(ask.status, 'open');
  assert.ok(ask.channels.includes('web'));
  assert.equal(ask.deliveries!.length, 1);
  assert.equal(ask.deliveries![0].status, 'failed');
  assert.equal(ask.deliveries![0].communicationId, undefined);
  assert.equal(coachingReviewAllowsNextOccurrence(result.project), true);
  assert.equal(result.project.milestones[2].actionConfig?.lastRun, undefined, 'Tracker must still await human review');
});

test('an uncertain actual notification still requires reconciliation', async () => {
  const p = reviewProject();
  await assert.rejects(deliverRaisedAsks(p, 'org', [{ nodeId: 'EXTRACT', ask: p.milestones[1].asks![0] }], {
    readTenantCommunicationsSettings: async () => ({}), assertEmailAllowed: async () => {},
    resolveAskRecipient: async () => 'reviewer@example.invalid',
    durableActionExecutor: () => async () => { throw new ActionRecoveryRequired('Provider result unknown'); }
  } as any), ActionRecoveryRequired);
});

test('only a completed coaching session waiting for its current web review can advance', () => {
  const p = reviewProject();
  assert.equal(coachingReviewAllowsNextOccurrence(p), true);
  for (const mutate of [
    (p: any) => { p.projectData.project_template = 'email_triage'; },
    (p: any) => { p.milestones[0].actionConfig.lastRun.status = 'pending'; },
    (p: any) => { p.milestones[0].actionConfig.lastRun.status = 'error'; },
    (p: any) => { p.milestones[1].asks[0].runId = 'older-extraction'; },
    (p: any) => { p.milestones[1].asks[0].channels = ['email']; },
    (p: any) => { p.milestones[0].asks = [{ status: 'open', kind: 'question' }]; },
    (p: any) => { p.milestones[0].waitConfig = { kind: 'timer', holdId: 'retry' }; }
  ]) {
    const copy = structuredClone(p); mutate(copy);
    assert.equal(coachingReviewAllowsNextOccurrence(copy), false);
  }
});

test('advancing a stale review schedules the next future day and retains waiting evidence', () => {
  const scheduledFor = Date.parse('2026-10-13T23:00:00Z');
  const now = Date.parse('2026-10-25T02:00:00Z');
  const schedule = normalizeTenantSchedule('org', 'daily', { activity: 'flow_start', projectId: 'p',
    timezone: 'Australia/Brisbane', recurrence: { kind: 'daily', localTime: '09:00' },
    nextRunAt: scheduledFor, misfirePolicy: 'run_once', enabled: true }, null, now);
  const run: any = { orgId: 'org', scheduleId: 'daily', id: 'occurrence', claimId: 'claim', scheduledFor, status: 'running' };
  const { updates, runPath, schedulePath } = buildScheduleCompletionUpdates(run, schedule, run, schedule,
    { status: 'waiting', flowRunId: 'original-flow' }, scheduledFor, now);
  assert.equal((updates[runPath] as any).status, 'waiting');
  assert.equal((updates[runPath] as any).flowRunId, 'original-flow');
  assert.equal((updates[schedulePath] as any).nextRunAt, Date.parse('2026-10-25T23:00:00Z'));
});

test('the generated coaching graph advances only after the call reaches extraction review', () => {
  const template = dailyCoachingTemplate({ reviewer: 'reviewer', email: 'reviewer@example.invalid' });
  const p = project(template.milestones, { ...template.projectData, coaching_requires_review: true, coaching_call_result_success: true });
  for (const id of ['COACH_DOC', 'COACH_TRACKER', 'COACH_CALL', 'COACH_EXTRACT']) {
    p.milestones.find(n => n.id === id)!.actionConfig!.lastRun = { id, at: 1, status: 'success' };
  }
  const route = p.milestones.find(n => n.id === 'COACH_CALL_ROUTE')!;
  route.decisionConfig!.selectedTargetId = 'COACH_EXTRACT';
  route.decisionConfig!.decidedAt = 1;
  p.milestones.find(n => n.id === 'COACH_EXTRACT')!.asks = [{ ...reviewProject().milestones[1].asks![0], runId: 'COACH_EXTRACT' }];
  assert.equal(coachingReviewAllowsNextOccurrence(p), true);
  p.milestones.find(n => n.id === 'COACH_CALL')!.actionConfig!.lastRun!.status = 'pending';
  assert.equal(coachingReviewAllowsNextOccurrence(p), false);
});
