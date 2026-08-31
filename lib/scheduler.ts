import { randomUUID } from 'node:crypto';
import type { TenantSchedule } from '../types.js';
import { advanceScheduledServerFlow, advanceServerFlow } from './serverFlow.js';
import { runEmailTriage } from './triage/runEmailTriage.js';
export {
  communicationsAfterCursor,
  cursorAfterCommunications,
  listInboundEmailSince,
  occurredMs,
  reconciliationCursor
} from './triage/runEmailTriage.js';
import { processAgentInbox } from './agentRouter.js';
import {
  advanceTenantSchedule,
  claimDueCoachingRetries,
  claimScheduleRun,
  finishScheduleRun,
  listDueSchedules,
  releaseCoachingRetry
} from './serverStore.js';

export interface ScheduleExecutionResult {
  scheduleId: string;
  status: 'completed' | 'failed' | 'duplicate' | 'skipped';
  processedCount?: number;
  projectId?: string;
  runId?: string;
  error?: string;
}

export const runTenantSchedule = async (
  schedule: TenantSchedule,
  scheduledFor = schedule.nextRunAt,
  options: { advanceSchedule?: boolean } = {}
): Promise<ScheduleExecutionResult> => {
  const run = await claimScheduleRun(schedule, scheduledFor, randomUUID());
  if (!run) return { scheduleId: schedule.id, status: 'duplicate' };
  let cursorBefore: string | undefined;

  try {
    if (schedule.activity === 'flow_start') {
      const outcome = await advanceScheduledServerFlow(schedule.orgId, schedule.projectId, {
        scheduleId: schedule.id,
        scheduleRunId: run.id,
        scheduledFor,
        flowId: schedule.flowId,
        input: schedule.input,
        resetPolicy: schedule.resetPolicy,
        clearProjectDataKeys: schedule.clearProjectDataKeys
      });
      if (!outcome.ok) throw new Error(outcome.reason || 'Scheduled flow could not be started');
      await finishScheduleRun(run, { status: 'completed', processedCount: 1 });
      if (options.advanceSchedule !== false) await advanceTenantSchedule(schedule, scheduledFor);
      return {
        scheduleId: schedule.id,
        status: 'completed',
        processedCount: 1,
        projectId: schedule.projectId,
        runId: run.id
      };
    }

    if (!schedule.connectionId) throw new Error('Legacy email triage schedule is not bound to a mailbox connection');
    if (!schedule.projectId) {
      console.warn(`[scheduler] legacy unbound triage schedule ${schedule.id} is running in compatibility mode`);
    }
    const result = await runEmailTriage({
      orgId: schedule.orgId,
      projectId: schedule.projectId,
      connectionId: schedule.connectionId,
      triagePolicy: schedule.triagePolicy,
      createDrafts: schedule.createDrafts,
      sendPolicy: schedule.policy,
      digestChannel: schedule.digestChannel,
      digestRecipient: schedule.digestRecipient,
      scheduleId: schedule.id,
      scheduledFor,
      timezone: schedule.timezone,
      runId: run.id,
      actor: `schedule:${schedule.id}`,
      createdAt: schedule.createdAt
    });
    cursorBefore = result.cursorBefore;
    await finishScheduleRun(run, {
      status: 'completed',
      cursorBefore,
      cursorAfter: result.cursorAfter,
      processedCount: result.processedCount
    });
    if (options.advanceSchedule !== false) await advanceTenantSchedule(schedule, scheduledFor);
    return { scheduleId: schedule.id, status: 'completed', processedCount: result.processedCount, projectId: schedule.projectId, runId: run.id };
  } catch (error: any) {
    const message = error?.message || String(error);
    await finishScheduleRun(run, { status: 'failed', cursorBefore, error: message });
    // A failed run does not advance the cursor or schedule occurrence. The
    // stale-run lease allows a later tick to retry this exact occurrence.
    return { scheduleId: schedule.id, status: 'failed', error: message };
  }
};

export const tickSchedules = async (now = Date.now()): Promise<ScheduleExecutionResult[]> => {
  const agentJobs = await processAgentInbox(10);
  const coachingRetries = await claimDueCoachingRetries(now, 10);
  const due = (await listDueSchedules(now)).slice(0, 25);
  const results: ScheduleExecutionResult[] = agentJobs.claimed
    ? [{ scheduleId: 'agent_inbox', status: 'completed', processedCount: agentJobs.completed }]
    : [];
  for (const retry of coachingRetries) {
    try {
      const outcome = await advanceServerFlow(retry.orgId, retry.projectId);
      if (!outcome.ok) throw new Error(outcome.reason || 'Coaching retry could not advance');
      results.push({
        scheduleId: retry.scheduleId || `coaching_retry:${retry.id}`,
        status: 'completed', processedCount: 1, projectId: retry.projectId, runId: retry.scheduleRunId
      });
    } catch (error: any) {
      const message = error?.message || String(error);
      await releaseCoachingRetry(retry, message);
      results.push({
        scheduleId: retry.scheduleId || `coaching_retry:${retry.id}`,
        status: 'failed', projectId: retry.projectId, runId: retry.scheduleRunId, error: message
      });
    }
  }
  for (const schedule of due) {
    const overdueBy = now - schedule.nextRunAt;
    const occurrenceWindow = Math.max(5, schedule.intervalMinutes) * 60_000;
    if (schedule.misfirePolicy === 'skip' && overdueBy >= occurrenceWindow) {
      await advanceTenantSchedule(schedule, schedule.nextRunAt, now);
      results.push({ scheduleId: schedule.id, status: 'skipped' });
      continue;
    }
    results.push(await runTenantSchedule(schedule, schedule.nextRunAt));
  }
  return results;
};
