import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { communicationsAfterCursor, cursorAfterCommunications, listInboundEmailSince, occurredMs } from '../lib/scheduler';
import { nextDailyScheduleOccurrence, normalizeTenantSchedule } from '../lib/serverStore';
import { applyScheduledFlowContext, resetProjectForScheduledOccurrence } from '../lib/serverFlow';
import { NodeType } from '../types';
import { project } from './helpers';

describe('durable communication cursor helpers', () => {
  test('sorts only records strictly after the committed cursor', () => {
    const records = [
      { id: 'late', occurredAt: '2026-08-28T03:00:00Z' },
      { id: 'old', occurredAt: '2026-08-28T01:00:00Z' },
      { id: 'next', occurredAt: '2026-08-28T02:00:00Z' }
    ];
    assert.deepEqual(
      communicationsAfterCursor(records, '2026-08-28T01:00:00Z').map(item => item.id),
      ['next', 'late']
    );
  });

  test('advances to the newest successfully processed record and never regresses', () => {
    assert.equal(cursorAfterCommunications('2026-08-28T02:00:00Z', [
      { occurredAt: '2026-08-28T03:00:00Z' }, { occurredAt: '2026-08-28T02:30:00Z' }
    ]), '2026-08-28T03:00:00Z');
    assert.equal(cursorAfterCommunications('2026-08-28T03:00:00Z', []), '2026-08-28T03:00:00Z');
  });

  test('treats missing and invalid timestamps as the beginning of time', () => {
    assert.equal(occurredMs(undefined), 0);
    assert.equal(occurredMs('not-a-date'), 0);
  });

  test('paginates backward until it reaches the committed cursor without dropping mail', async () => {
    const cursors: Array<string | undefined> = [];
    const client: any = {
      listCommunications: async (_orgId: string, options: any) => {
        cursors.push(options.cursor);
        return options.cursor
          ? { data: [
              { id: 'middle', occurredAt: '2026-08-28T02:00:00Z', direction: 'inbound' },
              { id: 'committed', occurredAt: '2026-08-28T01:00:00Z', direction: 'inbound' }
            ], limit: 200 }
          : { data: [{ id: 'newest', occurredAt: '2026-08-28T03:00:00Z', direction: 'inbound' }], limit: 200, nextCursor: 'page_2' };
      }
    };
    const result = await listInboundEmailSince(client, 'org_1', '2026-08-28T01:00:00Z');
    assert.deepEqual(cursors, [undefined, 'page_2']);
    assert.deepEqual(result.map(item => item.id), ['middle', 'newest']);
  });

  test('fails instead of moving the cursor over an unbounded backlog', async () => {
    const client: any = {
      listCommunications: async () => ({ data: [{ id: 'new', occurredAt: '2026-08-28T03:00:00Z' }], limit: 200, nextCursor: 'more' })
    };
    await assert.rejects(listInboundEmailSince(client, 'org_1', '2026-08-28T01:00:00Z', 2), /backlog exceeded/);
  });
});

describe('tenant schedule normalization', () => {
  test('preserves omitted fields during a partial update', () => {
    const existing = normalizeTenantSchedule('org_1', 'schedule_1', {
      name: 'Inbox triage', intervalMinutes: 60, timezone: 'Australia/Brisbane',
      connectionId: 'connection_1', policy: 'allow_approved_send', nextRunAt: 2000
    }, null, 1000);
    const updated = normalizeTenantSchedule('org_1', 'schedule_1', { enabled: false }, existing, 1500);
    assert.equal(updated.activity, 'communications_triage');
    if (updated.activity !== 'communications_triage') assert.fail('expected communications triage schedule');
    assert.equal(updated.name, 'Inbox triage');
    assert.equal(updated.intervalMinutes, 60);
    assert.equal(updated.connectionId, 'connection_1');
    assert.equal(updated.policy, 'allow_approved_send');
    assert.equal(updated.digestChannel, 'web');
    assert.equal(updated.nextRunAt, 2000);
    assert.equal(updated.enabled, false);
    assert.equal(updated.createdAt, 1000);
  });

  test('clamps intervals and fails closed on an unknown send policy', () => {
    const schedule = normalizeTenantSchedule('org_1', 'schedule_1', {
      name: 'Inbox triage', intervalMinutes: 1, policy: 'unexpected' as any
    }, null, 1000);
    assert.equal(schedule.intervalMinutes, 5);
    assert.equal(schedule.activity, 'communications_triage');
    if (schedule.activity !== 'communications_triage') assert.fail('expected communications triage schedule');
    assert.equal(schedule.policy, 'draft_only');
  });

  test('normalizes and preserves digest delivery settings', () => {
    const schedule = normalizeTenantSchedule('org_1', 'schedule_1', {
      name: 'Daily digest', activity: 'communications_triage',
      digestChannel: 'sms', digestRecipient: '+61411111111'
    }, null, 1000);
    assert.equal(schedule.activity, 'communications_triage');
    if (schedule.activity !== 'communications_triage') assert.fail('expected communications triage schedule');
    assert.equal(schedule.digestChannel, 'sms');
    assert.equal(schedule.digestRecipient, '+61411111111');
  });

  test('normalizes a flow start schedule without communications-only fields', () => {
    const schedule = normalizeTenantSchedule('org_1', 'coaching_daily', {
      name: 'Daily coaching', activity: 'flow_start', projectId: 'project_7', flowId: 'coaching',
      recurrence: { kind: 'daily', localTime: '08:30' }, timezone: 'Australia/Brisbane',
      misfirePolicy: 'run_once', input: { source: 'daily_schedule' }, resetPolicy: 'flow',
      clearProjectDataKeys: ['coaching_summary']
    }, null, Date.parse('2026-08-30T00:00:00Z'));
    assert.equal(schedule.activity, 'flow_start');
    if (schedule.activity !== 'flow_start') assert.fail('expected flow start schedule');
    assert.equal(schedule.projectId, 'project_7');
    assert.equal(schedule.flowId, 'coaching');
    assert.deepEqual(schedule.input, { source: 'daily_schedule' });
    assert.deepEqual(schedule.recurrence, { kind: 'daily', localTime: '08:30' });
    assert.equal(schedule.resetPolicy, 'flow');
    assert.deepEqual(schedule.clearProjectDataKeys, ['coaching_summary']);
    assert.equal(schedule.intervalMinutes, 1440);
  });

  test('calculates a Brisbane daily occurrence in UTC', () => {
    assert.equal(
      new Date(nextDailyScheduleOccurrence(
        Date.parse('2026-08-30T00:00:00Z'), '09:00', 'Australia/Brisbane'
      )).toISOString(),
      '2026-08-30T23:00:00.000Z'
    );
  });
});

describe('scheduled flow correlation', () => {
  test('merges configured input but protects authoritative occurrence fields', () => {
    const original = project([]);
    original.projectData = { existing: 'kept' };
    const next = applyScheduledFlowContext(original, {
      scheduleId: 'schedule_1',
      scheduleRunId: 'schedule_1:123',
      scheduledFor: Date.parse('2026-08-30T23:00:00Z'),
      flowId: 'coaching',
      input: { goal: 'focus', schedule_run_id: 'forged' }
    });
    assert.deepEqual(next.projectData, {
      existing: 'kept', goal: 'focus', schedule_id: 'schedule_1',
      schedule_run_id: 'schedule_1:123', schedule_occurrence_id: 'schedule_1:123',
      scheduled_for: '2026-08-30T23:00:00.000Z', flow_id: 'coaching'
    });
    assert.deepEqual(original.projectData, { existing: 'kept' });
  });

  test('re-arms a completed flow once for a new occurrence but not for a retry', () => {
    const original = project([{
      id: 'CALL', name: 'Coach', dependsOn: [], subtasks: [], estimatedDuration: 1,
      nodeType: NodeType.PHONE_CALL,
      actionConfig: { template: '{}', autoExecute: true, lastRun: { id: 'run_old', at: 1, status: 'success' } },
      asks: [{ id: 'ask_old', token: 'token', kind: 'approval', status: 'open', prompt: 'Review', nodeId: 'CALL', assignees: [], channels: ['web'], createdAt: 1, responses: [] }]
    }]);
    original.projectData = { schedule_occurrence_id: 'old', coaching_summary: 'stale', durable_goal: 'keep' };
    const occurrence = {
      scheduleId: 'daily', scheduleRunId: 'daily:new', scheduledFor: 2,
      resetPolicy: 'flow' as const, clearProjectDataKeys: ['coaching_summary']
    };
    const reset = resetProjectForScheduledOccurrence(original, occurrence);
    assert.equal(reset.milestones[0].actionConfig?.lastRun, undefined);
    assert.equal(reset.milestones[0].actionConfig?.runHistory?.[0].id, 'run_old');
    assert.equal(reset.milestones[0].asks?.[0].status, 'cancelled');
    assert.equal(reset.projectData?.coaching_summary, undefined);
    assert.equal(reset.projectData?.durable_goal, 'keep');

    const retrySource = applyScheduledFlowContext(reset, occurrence);
    const retry = resetProjectForScheduledOccurrence({
      ...retrySource,
      milestones: retrySource.milestones.map(node => ({
        ...node,
        actionConfig: node.actionConfig ? { ...node.actionConfig, lastRun: { id: 'run_new', at: 2, status: 'pending' } } : undefined
      }))
    }, occurrence);
    assert.equal(retry.milestones[0].actionConfig?.lastRun?.id, 'run_new', 'a retry must not dispatch the occurrence again');
  });
});
