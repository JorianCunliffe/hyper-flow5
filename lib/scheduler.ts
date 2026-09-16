import { randomUUID } from 'node:crypto';
import type { TenantSchedule } from '../types.js';
import { advanceScheduledServerFlow } from './serverFlow.js';
import { claimDueFlowHolds, releaseFlowHold, resumeClaimedFlowHold } from './flowHoldStore.js';
import { runEmailTriage } from './triage/runEmailTriage.js';
export {
  communicationsAfterCursor,
  cursorAfterCommunications,
  listInboundEmailSince,
  occurredMs,
  reconciliationCursor
} from './triage/runEmailTriage.js';
import { processAgentInbox } from './agentRouter.js';
import { runVisibleRoutine } from './cockpit/scheduledRoutines.js';
import {
  advanceTenantSchedule,
  claimScheduleRun,
  completeScheduleRunAndAdvance,
  finishScheduleRun,
  readScheduleRun,
  listDueSchedules
} from './serverStore.js';

export interface ScheduleExecutionResult {
  scheduleId: string;
  status: 'completed' | 'deferred' | 'failed' | 'duplicate' | 'skipped';
  processedCount?: number;
  projectId?: string;
  runId?: string;
  error?: string;
}

export const failedScheduleResults = (results: ScheduleExecutionResult[]): ScheduleExecutionResult[] =>
  results.filter(result => result.status === 'failed');

const completeScheduleOccurrence = async (
  schedule: TenantSchedule,
  run: Awaited<ReturnType<typeof claimScheduleRun>> & {},
  scheduledFor: number,
  patch: Parameters<typeof finishScheduleRun>[1],
  advanceSchedule: boolean
): Promise<void> => {
  if (advanceSchedule) {
    await completeScheduleRunAndAdvance(run, schedule, patch, scheduledFor);
  } else {
    await finishScheduleRun(run, patch);
  }
};

export const runTenantSchedule = async (
  schedule: TenantSchedule,
  scheduledFor = schedule.nextRunAt,
  options: { advanceSchedule?: boolean } = {}
): Promise<ScheduleExecutionResult> => {
  const run = await claimScheduleRun(schedule, scheduledFor, randomUUID());
  if (!run) {
    const existing = await readScheduleRun(schedule, scheduledFor);
    if (existing?.status === 'completed' && options.advanceSchedule !== false) await advanceTenantSchedule(schedule, scheduledFor);
    return { scheduleId: schedule.id, status: 'duplicate' };
  }
  let cursorBefore: string | undefined;

  if (schedule.activity === 'flow_start') {
    let actionError: unknown;
    let flowOutcome: Awaited<ReturnType<typeof advanceScheduledServerFlow>> | undefined;
    try {
      const outcome = schedule.flowId?.startsWith('visible:') ? await runVisibleRoutine(schedule,run.id) : await advanceScheduledServerFlow(schedule.orgId, schedule.projectId, {
        scheduleId: schedule.id,
        scheduleRunId: run.id,
        scheduledFor,
        flowId: schedule.flowId,
        input: schedule.input,
        resetPolicy: schedule.resetPolicy,
        clearProjectDataKeys: schedule.clearProjectDataKeys
      });
      if (!outcome.ok) throw new Error(outcome.reason || 'Scheduled flow could not be started');
      flowOutcome = outcome;
    } catch (error) {
      actionError = error;
    }
    if (actionError) {
      const message = actionError instanceof Error ? actionError.message : String(actionError);
      await finishScheduleRun(run, { status: 'recoverable', error: message });
      console.error('[scheduler] flow occurrence failed', { scheduleId: schedule.id, scheduledFor, message });
      return { scheduleId: schedule.id, status: 'failed', error: message };
    }
    if (flowOutcome?.status === 'waiting' || flowOutcome?.status === 'running') {
      await finishScheduleRun(run, { status: flowOutcome.status === 'waiting' ? 'waiting' : 'partial', flowRunId: flowOutcome.flowRunId });
      return { scheduleId: schedule.id, status: 'deferred', projectId: schedule.projectId, runId: run.id };
    }
    await completeScheduleOccurrence(
      schedule, run, scheduledFor,
      { status: flowOutcome?.status === 'failed' ? 'failed' : 'completed', flowRunId: flowOutcome?.flowRunId, processedCount: 1 },
      options.advanceSchedule !== false
    );
    console.info('[scheduler] occurrence completed', {
      scheduleId: schedule.id, activity: schedule.activity, scheduledFor, attempt: run.attempt
    });
    return {
      scheduleId: schedule.id,
      status: flowOutcome?.status === 'failed' ? 'failed' : 'completed',
      processedCount: 1,
      projectId: schedule.projectId,
      runId: run.id
    };
  }

  let triageResult: Awaited<ReturnType<typeof runEmailTriage>> | undefined;
  let triageError: unknown;
  try {
    if (!schedule.connectionId) throw new Error('Legacy email triage schedule is not bound to a mailbox connection');
    if (!schedule.projectId) {
      console.warn(`[scheduler] legacy unbound triage schedule ${schedule.id} is running in compatibility mode`);
    }
    triageResult = await runEmailTriage({
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
    cursorBefore = triageResult.cursorBefore;
  } catch (error) {
    triageError = error;
  }
  if (triageError || !triageResult) {
    const message = triageError instanceof Error ? triageError.message : String(triageError || 'Email triage returned no result');
    await finishScheduleRun(run, { status: 'failed', cursorBefore, error: message });
    console.error('[scheduler] triage occurrence failed', { scheduleId: schedule.id, scheduledFor, message });
    return { scheduleId: schedule.id, status: 'failed', error: message };
  }
  if (triageResult.hasMore) {
    await finishScheduleRun(run, {
      status: 'partial',
      cursorBefore,
      cursorAfter: triageResult.cursorAfter,
      processedCount: triageResult.processedCount
    });
    console.info('[scheduler] triage occurrence checkpointed', {
      scheduleId: schedule.id,
      scheduledFor,
      attempt: run.attempt,
      processedCount: triageResult.processedCount,
      remainingCount: triageResult.remainingCount
    });
    return {
      scheduleId: schedule.id,
      status: 'deferred',
      processedCount: triageResult.processedCount,
      projectId: schedule.projectId,
      runId: run.id
    };
  }
  await completeScheduleOccurrence(
    schedule, run, scheduledFor,
    {
      status: 'completed',
      cursorBefore,
      cursorAfter: triageResult.cursorAfter,
      processedCount: triageResult.processedCount
    },
    options.advanceSchedule !== false
  );
  console.info('[scheduler] occurrence completed', {
    scheduleId: schedule.id, activity: schedule.activity, scheduledFor,
    attempt: run.attempt, processedCount: triageResult.processedCount
  });
  return {
    scheduleId: schedule.id, status: 'completed', processedCount: triageResult.processedCount,
    projectId: schedule.projectId, runId: run.id
  };
};

export const tickSchedules = async (now = Date.now()): Promise<ScheduleExecutionResult[]> => {
  const agentJobs = await processAgentInbox(10);
  const flowHolds = await claimDueFlowHolds(now, 10);
  const due = (await listDueSchedules(now)).slice(0, 25);
  const results: ScheduleExecutionResult[] = agentJobs.claimed
    ? [{ scheduleId: 'agent_inbox', status: 'completed', processedCount: agentJobs.completed }]
    : [];

  for (const hold of flowHolds) {
    try {
      const outcome = await resumeClaimedFlowHold(hold);
      if (!outcome.ok) throw new Error(outcome.reason || 'Flow hold could not resume');
      results.push({
        scheduleId: `flow_hold:${hold.id}`,
        status: outcome.reason === 'stale_flow_hold' ? 'skipped' : 'completed',
        processedCount: outcome.reason === 'stale_flow_hold' ? 0 : 1,
        projectId: hold.projectId,
        runId: hold.id
      });
    } catch (error: any) {
      const message = error?.message || String(error);
      await releaseFlowHold(hold, message);
      results.push({
        scheduleId: `flow_hold:${hold.id}`,
        status: 'failed', projectId: hold.projectId, runId: hold.id, error: message
      });
    }
  }

  for (const schedule of due) {
    const overdueBy = now - schedule.nextRunAt;
    const occurrenceWindow = Math.max(5, schedule.intervalMinutes) * 60_000;
    if (schedule.misfirePolicy === 'skip' && overdueBy >= occurrenceWindow && !(await readScheduleRun(schedule))) {
      await advanceTenantSchedule(schedule, schedule.nextRunAt, now);
      results.push({ scheduleId: schedule.id, status: 'skipped' });
      continue;
    }
    results.push(await runTenantSchedule(schedule, schedule.nextRunAt));
  }
  return results;
};
