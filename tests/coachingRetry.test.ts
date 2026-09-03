import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { coachingCallNode, coachingRetryMatchesProject, coachingRetryPolicy, coachingRetryState } from '../lib/coachingRetry';
import { dailyCoachingTemplate } from '../lib/projectTemplates';
import { advanceProjectFlow, resolvePendingRun } from '../lib/flowOrchestrator';
import { coachingSessionFromProject, resetProjectForScheduledOccurrence } from '../lib/serverFlow';
import type { ActionRun, Project } from '../types';

const minute = 60_000;
const now = Date.parse('2026-09-03T00:00:00Z');
const failedProject = (failedAt = now, disposition = 'voicemail'): Project => {
  const template = dailyCoachingTemplate();
  const project: Project = {
    id: 'coaching', name: 'Coaching', company: 'Acme', type: 'Other',
    startDate: failedAt - 2 * minute, createdAt: failedAt - 2 * minute, updatedAt: failedAt,
    ...template,
    projectData: {
      ...template.projectData, schedule_occurrence_id: 'today', schedule_id: 'daily',
      scheduled_for: new Date(failedAt - 2 * minute).toISOString()
    }
  };
  for (const id of ['COACH_DOC', 'COACH_TRACKER']) {
    project.milestones.find(node => node.id === id)!.actionConfig!.lastRun = {
      id: `read_${id}`, at: failedAt - 2 * minute, status: 'success'
    };
  }
  coachingCallNode(project)!.actionConfig!.lastRun = {
    id: 'first', scheduleOccurrenceId: 'today', status: 'error',
    at: failedAt - 2 * minute, resolvedAt: failedAt,
    communicationOutcome: { disposition, successful: false, memoryEligible: false }
  };
  return project;
};

describe('coaching retry policy', () => {
  test('defaults to one retry after ten minutes, including existing generated defaults', () => {
    assert.deepEqual(coachingRetryPolicy(), { maxAttempts: 2, delayMinutes: 10, windowMinutes: 180 });
    assert.equal(dailyCoachingTemplate().projectData.coaching_retry_delay_minutes, 10);
    assert.equal(coachingRetryPolicy({ coaching_max_attempts: 2, coaching_retry_delay_minutes: 30, coaching_retry_window_minutes: 180 }).delayMinutes, 10);
  });

  test('preserves custom policies, including an explicitly saved thirty-minute delay', () => {
    assert.equal(coachingRetryPolicy({ coaching_retry_policy_version: 2, coaching_retry_delay_minutes: 30 }).delayMinutes, 30);
    assert.equal(coachingRetryPolicy({ coaching_max_attempts: 3, coaching_retry_delay_minutes: 30 }).maxAttempts, 3);
    assert.equal(coachingRetryPolicy({ coaching_max_attempts: 3, coaching_retry_delay_minutes: 30 }).delayMinutes, 30);
    assert.equal(coachingRetryPolicy({ coaching_max_attempts: 0 }).maxAttempts, 1);
    assert.equal(coachingRetryPolicy({ coaching_retry_delay_minutes: 'invalid' }).delayMinutes, 10);
  });

  for (const disposition of ['voicemail', 'no_meaningful_response', 'hangup', 'hang_up', 'hung_up', 'no_answer', 'busy', 'provider_failed']) {
    test(`waits ten minutes after ${disposition} resolves, not after dialling`, () => {
      const project = failedProject(now, disposition);
      const waiting = coachingRetryState(project, now + 10 * minute - 1);
      assert.equal(waiting.nextRetryAt, now + 10 * minute);
      assert.equal(waiting.due, false);
      assert.equal(coachingRetryState(project, now + 10 * minute).due, true);
      assert.equal(coachingRetryState(project, now + 11 * minute).nextRetryAt, waiting.nextRetryAt, 'reconciliation must not move the due time');
      const session = coachingSessionFromProject('org', project, now);
      assert.equal(session?.retryStatus, 'pending');
      assert.equal(session?.nextRetryAt, waiting.nextRetryAt);
      assert.equal(session?.sheetWrite, undefined);
    });
  }

  test('never retries success, wrong numbers, cancellation or unsafe/unknown outcomes', () => {
    for (const disposition of ['human_completed', 'wrong_number', 'canceled', 'fax', 'automated_system', 'unclassified']) {
      assert.equal(coachingRetryState(failedProject(now, disposition), now + 10 * minute).nextRetryAt, undefined, disposition);
    }
    const project = failedProject();
    coachingCallNode(project)!.actionConfig!.lastRun!.status = 'success';
    assert.equal(coachingRetryState(project, now + 10 * minute).nextRetryAt, undefined);
  });

  test('counts unique attempts in this occurrence, not earlier days', () => {
    const project = failedProject();
    const config = coachingCallNode(project)!.actionConfig!;
    config.runHistory = [
      { id: 'yesterday', scheduleOccurrenceId: 'yesterday', at: now - minute, status: 'error' },
      { id: 'older_legacy', at: now - 24 * 60 * minute, status: 'error' },
      { ...config.lastRun! }
    ];
    assert.equal(coachingRetryState(project, now).attempts, 1);
    assert.equal(coachingRetryState(project, now).retryStatus, 'pending');
    config.runHistory.push({ id: 'same_day_legacy', at: now - minute, status: 'error' });
    assert.equal(coachingRetryState(project, now).attempts, 2);
    assert.equal(coachingRetryState(project, now).retryStatus, 'exhausted');
  });

  test('tags archived legacy calls when resetting for a new day', () => {
    const project = failedProject();
    delete coachingCallNode(project)!.actionConfig!.lastRun!.scheduleOccurrenceId;
    const reset = resetProjectForScheduledOccurrence(project, {
      scheduleId: 'daily', scheduleRunId: 'tomorrow', scheduledFor: now + 24 * 60 * minute, resetPolicy: 'flow'
    });
    assert.equal(coachingCallNode(reset)!.actionConfig!.runHistory![0].scheduleOccurrenceId, 'today');
  });

  test('does not queue beyond the retry window or without occurrence identity', () => {
    const project = failedProject();
    project.projectData!.coaching_retry_window_minutes = 5;
    assert.equal(coachingRetryState(project, now).retryStatus, 'exhausted');
    project.projectData!.coaching_retry_window_minutes = 180;
    assert.equal(coachingRetryState(project, now + 181 * minute).nextRetryAt, undefined);
    delete project.projectData!.schedule_occurrence_id;
    assert.equal(coachingRetryState(project, now).nextRetryAt, undefined);
  });

  test('stale retry claims cannot start a different occurrence or an archived project', () => {
    const project = failedProject();
    assert.equal(coachingRetryMatchesProject(project, 'today'), true);
    assert.equal(coachingRetryMatchesProject(project, 'yesterday'), false);
    project.isArchived = true;
    assert.equal(coachingRetryMatchesProject(project, 'today'), false);
  });
});

describe('coaching retry orchestration without live calls', () => {
  test('an ordinary flow advance cannot bypass the ten-minute wait', async () => {
    let calls = 0;
    const result = await advanceProjectFlow(failedProject(Date.now()), async () => {
      calls++;
      return { status: 'pending' };
    });
    assert.equal(calls, 0);
    assert.match(result.log.join('\n'), /retry held until/);
  });

  test('dispatches only one retry, and a failed retry cannot loop into a third call', async () => {
    let calls = 0;
    const project = failedProject(Date.now() - 11 * minute, 'no_meaningful_response');
    const result = await advanceProjectFlow(project, async taskType => {
      assert.equal(taskType, 'outgoing_call');
      calls++;
      return { status: 'error', output: { disposition: 'voicemail', successful: false, memory_eligible: false } };
    });
    assert.equal(calls, 1);
    const state = coachingRetryState(result.project);
    assert.equal(state.attempts, 2);
    assert.equal(state.retryStatus, 'exhausted');
    assert.equal(coachingCallNode(result.project)!.actionConfig!.lastRun!.scheduleOccurrenceId, 'today');
    await advanceProjectFlow(result.project, async () => { calls++; return { status: 'pending' }; });
    assert.equal(calls, 1);
    assert.equal(result.project.milestones.find(node => node.id === 'COACH_WRITE')!.actionConfig!.lastRun, undefined);
  });

  test('a pending retry and replayed terminal callback cannot place an extra call', async () => {
    let calls = 0;
    const executor = async () => { calls++; return { status: 'pending' as const, externalId: 'retry_communication' }; };
    const retry = await advanceProjectFlow(failedProject(Date.now() - 11 * minute), executor);
    await advanceProjectFlow(retry.project, executor);
    assert.equal(calls, 1);
    const run: ActionRun = coachingCallNode(retry.project)!.actionConfig!.lastRun!;
    const match = { nodeId: 'COACH_CALL', runId: run.id, externalId: 'retry_communication' };
    const outcome = { status: 'error' as const, output: { disposition: 'no_meaningful_response', successful: false, memory_eligible: false }, resolvedBy: 'test' };
    const resolved = resolvePendingRun(retry.project, match, outcome)!;
    assert.ok(resolved);
    assert.equal(resolvePendingRun(resolved.project, match, outcome), null);
    await advanceProjectFlow(resolved.project, executor);
    assert.equal(calls, 1);
    assert.equal(coachingSessionFromProject('org', resolved.project)?.retryStatus, 'exhausted');
  });
});
