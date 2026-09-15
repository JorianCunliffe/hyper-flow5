import { randomUUID } from 'node:crypto';
import { CoachingSession, HumanAsk, type FlowEvent, Project } from '../types.js';
import { activeOccurrenceId, getHoldConfig } from './flowEngine.js';
import { advanceProjectFlow, resolvePendingRun } from './flowOrchestrator.js';
import { findAskByToken } from './humanAsk.js';
import { serverExecutor } from './serverExecutor.js';
import { findProject, upsertCoachingSession, writeProject } from './serverStore.js';
import { deliverRaisedAsks } from './asks/deliverRaisedAsks.js';
import { expireAsk } from './asks/expireAsk.js';
import { finishFlowHold, listMatchingFlowHolds, syncFlowHoldsFromRun } from './flowHoldStore.js';
import { applyFlowEvent } from './flowEvents.js';
import { resetProjectForOccurrence } from './flowOccurrence.js';
import { createFlowRun, flowRunIdForOccurrence, materializeFlowRunProject, updateFlowRunFromProject } from './flowRun.js';
import {
  createFlowRunIfAbsent,
  findFlowRunByAction,
  findFlowRunByAsk,
  findLatestActiveFlowRun,
  readFlowRun,
  saveFlowRun
} from './flowRunStore.js';
import type { FlowHold, FlowHoldConfig, FlowRun, FlowSignal, RuntimeMilestone } from './flowRuntimeTypes.js';
import { settleVisibleCallback } from './visibleFlows/runtime.js';
export { respondToAsk } from './asks/respondToAsk.js';

export interface AdvanceOutcome {
  ok: boolean;
  reason?: string;
  flowRunId?: string;
  log?: string[];
  pending?: string[];
}

export interface ScheduledFlowContext {
  scheduleId: string;
  scheduleRunId: string;
  scheduledFor: number;
  flowId?: string;
  input?: Record<string, unknown>;
  resetPolicy?: 'none' | 'flow';
  clearProjectDataKeys?: string[];
}

export const resetProjectForScheduledOccurrence = (
  project: Project,
  occurrence: ScheduledFlowContext
): Project => {
  if (occurrence.resetPolicy !== 'flow' || project.projectData?.schedule_occurrence_id === occurrence.scheduleRunId) {
    return project;
  }
  return resetProjectForOccurrence(project, occurrence.scheduleRunId, occurrence.clearProjectDataKeys || []);
};

export const applyScheduledFlowContext = (
  project: Project,
  occurrence: ScheduledFlowContext
): Project => {
  const reset = resetProjectForScheduledOccurrence(project, occurrence);
  return {
    ...reset,
    projectData: {
      ...(reset.projectData || {}),
      ...(occurrence.input || {}),
      flow_occurrence_id: occurrence.scheduleRunId,
      schedule_id: occurrence.scheduleId,
      schedule_run_id: occurrence.scheduleRunId,
      schedule_occurrence_id: occurrence.scheduleRunId,
      scheduled_for: new Date(occurrence.scheduledFor).toISOString(),
      ...(occurrence.flowId ? { flow_id: occurrence.flowId } : {})
    }
  };
};

/** Compatibility projection only; execution authority lives in FlowRun. */
export const coachingSessionFromProject = (
  orgId: string,
  project: Project,
  _now = Date.now()
): (Omit<CoachingSession, 'createdAt' | 'updatedAt'> & Partial<Pick<CoachingSession, 'createdAt' | 'updatedAt'>>) | null => {
  const data = project.projectData || {};
  const occurrenceId = typeof data.schedule_occurrence_id === 'string' ? data.schedule_occurrence_id : '';
  if (data.project_template !== 'daily_coaching' || !occurrenceId) return null;
  const callNode = project.milestones.find(node => node.id === 'COACH_CALL');
  const extractionNode = project.milestones.find(node => node.id === 'COACH_EXTRACT');
  const writeNode = project.milestones.find(node => node.id === 'COACH_WRITE');
  const retryWait = project.milestones.find(node => node.id === 'COACH_RETRY_WAIT');
  const callRun = callNode?.actionConfig?.lastRun;
  const callOutput = callRun?.output && typeof callRun.output === 'object' ? callRun.output : {};
  const outcome = callRun?.communicationOutcome;
  const wait = retryWait ? getHoldConfig(retryWait) : undefined;
  const waitingOnGenericTimer = !!wait?.availableAt && !wait.resolvedAt;
  let status: 'scheduled' | 'calling' | 'review_required' | 'completed' | 'failed' = 'scheduled';
  if (writeNode?.actionConfig?.lastRun?.status === 'success') status = 'completed';
  else if (extractionNode?.actionConfig?.lastRun?.status === 'success' && data.coaching_requires_review) status = 'review_required';
  else if (callRun?.status === 'pending') status = 'calling';
  else if (callRun?.status === 'error' && !waitingOnGenericTimer) status = 'failed';

  const scheduledFor = typeof data.scheduled_for === 'string' ? Date.parse(data.scheduled_for) : NaN;
  const history = callNode?.actionConfig?.runHistory || [];
  const attempts = history.filter(run => run.scheduleOccurrenceId === occurrenceId).length + (callRun ? 1 : 0);

  return {
    id: occurrenceId,
    orgId,
    projectId: project.id,
    scheduleId: typeof data.schedule_id === 'string' ? data.schedule_id : undefined,
    scheduleRunId: typeof data.schedule_run_id === 'string' ? data.schedule_run_id : undefined,
    scheduledFor: Number.isFinite(scheduledFor) ? scheduledFor : undefined,
    communicationId: typeof callOutput.communication_id === 'string' ? callOutput.communication_id : callRun?.externalExecutionId,
    documentId: typeof data.google_doc_id === 'string' ? data.google_doc_id : undefined,
    documentRevision: typeof data.google_doc_revision === 'string' ? data.google_doc_revision : undefined,
    documentReadAt: typeof data.google_doc_read_at === 'string' ? data.google_doc_read_at : undefined,
    spreadsheetId: typeof data.google_sheet_id === 'string' ? data.google_sheet_id : undefined,
    sheetRange: typeof data.google_sheet_range === 'string' ? data.google_sheet_range : undefined,
    sheetReadAt: typeof data.google_sheet_read_at === 'string' ? data.google_sheet_read_at : undefined,
    disposition: outcome?.disposition,
    transcriptId: typeof callOutput.transcript_id === 'string' ? callOutput.transcript_id : undefined,
    status,
    summary: typeof data.coaching_summary === 'string' ? data.coaching_summary : undefined,
    progress: typeof data.coaching_progress === 'string' ? data.coaching_progress : undefined,
    blockers: typeof data.coaching_blockers === 'string' ? data.coaching_blockers : undefined,
    commitments: typeof data.coaching_commitments === 'string' ? data.coaching_commitments : undefined,
    nextActions: typeof data.coaching_next_actions === 'string' ? data.coaching_next_actions : undefined,
    confidence: Number.isFinite(Number(data.coaching_confidence)) ? Number(data.coaching_confidence) : undefined,
    sheetWrite: data.google_sheet_write && typeof data.google_sheet_write === 'object' ? data.google_sheet_write : undefined,
    failureReason: callRun?.status === 'error' ? callRun.error || outcome?.failureReason : undefined,
    attemptCount: attempts
  };
};

export const syncCoachingSessionFromProject = async (
  orgId: string,
  project: Project,
  persist: typeof upsertCoachingSession = upsertCoachingSession
): Promise<string | undefined> => {
  const session = coachingSessionFromProject(orgId, project);
  if (!session) return undefined;
  try {
    await persist(session);
    return undefined;
  } catch (error: any) {
    const warning = `Coaching session projection pending reconciliation: ${error?.message || String(error)}`;
    console.error(warning);
    return warning;
  }
};

const persistProjectProjection = async (
  orgId: string,
  index: number,
  project: Project
): Promise<string | undefined> => {
  try {
    await writeProject(orgId, index, project);
    return undefined;
  } catch (error: any) {
    const warning = `Project runtime projection skipped after concurrent update: ${error?.message || String(error)}`;
    console.warn(warning);
    return warning;
  }
};

const advanceRunAndPersist = async (
  orgId: string,
  located: Awaited<ReturnType<typeof findProject>> & {},
  run: FlowRun,
  initialLog: string[] = []
): Promise<AdvanceOutcome> => {
  const runtimeProject = materializeFlowRunProject(located.project, run);
  const advanced = await advanceProjectFlow(runtimeProject, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });
  const delivered = await deliverRaisedAsks(advanced.project, orgId, advanced.askedFor);
  const nextRun = updateFlowRunFromProject(run, delivered.project);
  const savedRun = await saveFlowRun(nextRun);
  await syncFlowHoldsFromRun(savedRun, delivered.project);

  const [projectionWarning, coachingWarning] = await Promise.all([
    persistProjectProjection(orgId, located.index, delivered.project),
    syncCoachingSessionFromProject(orgId, delivered.project)
  ]);
  return {
    ok: true,
    flowRunId: savedRun.id,
    log: [
      ...initialLog,
      ...advanced.log,
      ...delivered.log,
      ...(projectionWarning ? [projectionWarning] : []),
      ...(coachingWarning ? [coachingWarning] : [])
    ],
    pending: advanced.pending
  };
};

const ensureOccurrenceRun = async (
  orgId: string,
  project: Project,
  input: {
    occurrenceId: string;
    trigger: FlowRun['trigger'];
    triggerId?: string;
    flowId?: string;
    clearProjectDataKeys?: string[];
    data?: Record<string, unknown>;
  }
): Promise<FlowRun> => {
  const id = flowRunIdForOccurrence(orgId, project.id, input.occurrenceId);
  const existing = await readFlowRun(orgId, project.id, id);
  if (existing) return existing;
  return createFlowRunIfAbsent(createFlowRun({
    orgId,
    project,
    occurrenceId: input.occurrenceId,
    trigger: input.trigger,
    triggerId: input.triggerId,
    flowId: input.flowId,
    clearProjectDataKeys: input.clearProjectDataKeys,
    input: input.data
  }));
};

export const advanceServerFlow = async (
  orgId: string,
  projectId: string
): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  let run = await findLatestActiveFlowRun(orgId, projectId);
  if (!run) {
    const projectedOccurrence = activeOccurrenceId(located.project.projectData);
    const occurrenceId = projectedOccurrence || `manual:${Date.now()}:${randomUUID()}`;
    run = await ensureOccurrenceRun(orgId, located.project, {
      occurrenceId,
      trigger: projectedOccurrence ? 'manual' : 'manual',
      flowId: typeof located.project.projectData?.flow_id === 'string' ? located.project.projectData.flow_id : undefined
    });
  }
  return advanceRunAndPersist(orgId, located, run);
};

export const advanceScheduledServerFlow = async (
  orgId: string,
  projectId: string,
  occurrence: ScheduledFlowContext
): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };
  const seed = applyScheduledFlowContext(located.project, occurrence);
  const run = await ensureOccurrenceRun(orgId, seed, {
    occurrenceId: occurrence.scheduleRunId,
    trigger: 'schedule',
    triggerId: occurrence.scheduleId,
    flowId: occurrence.flowId,
    clearProjectDataKeys: occurrence.clearProjectDataKeys,
    data: occurrence.input
  });
  return advanceRunAndPersist(orgId, located, run);
};

const validVariable = (value: unknown): string | undefined => {
  const key = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : undefined;
};

const writeResolvedHold = (
  project: Project,
  hold: FlowHold,
  resolution: 'timer' | 'timeout' | 'signal',
  signal?: FlowSignal
): Project | null => {
  const node = project.milestones.find(item => item.id === hold.nodeId);
  if (!node) return null;
  const cfg = getHoldConfig(node);
  if (!cfg || cfg.holdId !== hold.id || cfg.resolvedAt) return null;
  const now = signal?.occurredAt || Date.now();
  const resolved: FlowHoldConfig = {
    ...cfg,
    resolvedAt: now,
    resolution,
    resolvedBy: signal?.kind || (resolution === 'timer' ? 'scheduler/time' : 'scheduler/timeout'),
    signalId: signal?.id
  };
  const generic = Boolean((node as RuntimeMilestone).holdConfig) || resolved.kind !== 'timer';
  const nextNode = generic
    ? ({ ...node, holdConfig: resolved } as RuntimeMilestone)
    : {
        ...node,
        waitConfig: {
          ...node.waitConfig!,
          kind: 'timer' as const,
          durationMinutes: resolved.durationMinutes,
          reason: resolved.reason,
          holdId: resolved.holdId,
          armedAt: resolved.armedAt,
          resumeAt: resolved.availableAt,
          resolvedAt: resolved.resolvedAt,
          occurrenceId: resolved.occurrenceId
        }
      };

  let projectData = { ...(project.projectData || {}) };
  const resultKey = validVariable(resolved.resultVariable);
  if (resultKey) {
    projectData[resultKey] = resolution;
    projectData[`${resultKey}_resolved`] = true;
    projectData[`${resultKey}_resolution`] = resolution;
    if (signal?.payload !== undefined) projectData[`${resultKey}_payload`] = signal.payload;
  }
  const payloadKey = validVariable(resolved.payloadVariable);
  if (payloadKey && signal?.payload !== undefined) projectData[payloadKey] = signal.payload;

  return {
    ...project,
    updatedAt: now,
    projectData,
    milestones: project.milestones.map(item => item.id === node.id ? nextNode : item)
  };
};

export const resumeFlowRunFromHold = async (
  hold: FlowHold,
  resolution: 'timer' | 'timeout',
  signal?: FlowSignal
): Promise<AdvanceOutcome> => {
  const located = await findProject(hold.orgId, hold.projectId);
  if (!located || located.project.isArchived) {
    await finishFlowHold(hold, 'cancelled', 'project_not_available', 'cancelled');
    return { ok: true, reason: 'stale_flow_hold', flowRunId: hold.flowRunId };
  }
  const run = await readFlowRun(hold.orgId, hold.projectId, hold.flowRunId);
  if (!run || run.occurrenceId !== hold.occurrenceId || ['completed', 'failed', 'cancelled'].includes(run.status)) {
    await finishFlowHold(hold, 'cancelled', 'run_not_available', 'cancelled');
    return { ok: true, reason: 'stale_flow_hold', flowRunId: hold.flowRunId };
  }
  if (hold.source !== 'wait') {
    await finishFlowHold(hold, 'cancelled', 'non_wait_hold_cannot_be_time_resumed', 'cancelled');
    return { ok: true, reason: 'stale_flow_hold', flowRunId: hold.flowRunId };
  }

  const runtime = materializeFlowRunProject(located.project, run);
  const resolved = writeResolvedHold(runtime, hold, resolution, signal);
  if (!resolved) {
    await finishFlowHold(hold, 'cancelled', 'wait_no_longer_active', 'cancelled');
    return { ok: true, reason: 'stale_flow_hold', flowRunId: hold.flowRunId };
  }
  const saved = await saveFlowRun(updateFlowRunFromProject(run, resolved));
  await finishFlowHold(hold, 'resolved', undefined, resolution);
  return advanceRunAndPersist(hold.orgId, located, saved, [`Wait "${hold.nodeId}" resolved by ${resolution}`]);
};

export const resumeFlowRunFromSignal = async (hold: FlowHold, signal: FlowSignal): Promise<AdvanceOutcome> => {
  if (hold.source !== 'wait') return { ok: true, reason: 'hold_owned_by_other_primitive', flowRunId: hold.flowRunId };
  const located = await findProject(hold.orgId, hold.projectId);
  if (!located) return { ok: false, reason: 'project_not_found', flowRunId: hold.flowRunId };
  const run = await readFlowRun(hold.orgId, hold.projectId, hold.flowRunId);
  if (!run || run.occurrenceId !== hold.occurrenceId) {
    await finishFlowHold(hold, 'cancelled', 'occurrence_changed', 'cancelled');
    return { ok: true, reason: 'stale_flow_hold', flowRunId: hold.flowRunId };
  }
  const runtime = materializeFlowRunProject(located.project, run);
  const resolved = writeResolvedHold(runtime, hold, 'signal', signal);
  if (!resolved) {
    await finishFlowHold(hold, 'cancelled', 'wait_no_longer_active', 'cancelled');
    return { ok: true, reason: 'stale_flow_hold', flowRunId: hold.flowRunId };
  }
  const saved = await saveFlowRun(updateFlowRunFromProject(run, resolved));
  await finishFlowHold(hold, 'resolved', undefined, 'signal');
  return advanceRunAndPersist(hold.orgId, located, saved, [`Wait "${hold.nodeId}" resumed by ${signal.kind} signal`]);
};

const eventSignal = (event: FlowEvent): FlowSignal => ({
  id: event.id,
  kind: 'event',
  occurredAt: event.occurredAt,
  eventType: event.type,
  channel: event.channel,
  direction: event.direction,
  personId: event.personId,
  communicationId: event.communicationId,
  payload: event.payload
});

/**
 * A trusted event first resumes matching holds in existing runs. Only when no
 * run is waiting for it may the same event start a new EVENT_TRIGGER occurrence.
 */
export const advanceEventServerFlow = async (
  orgId: string,
  projectId: string,
  event: FlowEvent,
  clearProjectDataKeys: string[] = []
): Promise<AdvanceOutcome> => {
  const signal = eventSignal(event);
  const matching = await listMatchingFlowHolds(orgId, projectId, signal);
  const resumable = matching.filter(hold => hold.source === 'wait');
  if (resumable.length) {
    const results: AdvanceOutcome[] = [];
    for (const hold of resumable) results.push(await resumeFlowRunFromSignal(hold, signal));
    return {
      ok: results.every(result => result.ok),
      reason: 'resumed_flow_hold',
      flowRunId: results[0]?.flowRunId,
      log: results.flatMap(result => result.log || []),
      pending: Array.from(new Set(results.flatMap(result => result.pending || [])))
    };
  }

  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };
  const applied = applyFlowEvent(located.project, event, clearProjectDataKeys);
  if (!applied.matchedNodeIds.length) {
    return { ok: true, reason: 'no_matching_event_trigger', log: ['No ready event trigger or event hold matched the event'], pending: [] };
  }
  const run = await ensureOccurrenceRun(orgId, applied.project, {
    occurrenceId: applied.occurrenceId,
    trigger: 'event',
    triggerId: event.id,
    flowId: typeof applied.project.projectData?.flow_id === 'string' ? applied.project.projectData.flow_id : undefined,
    clearProjectDataKeys
  });
  return advanceRunAndPersist(orgId, located, run, [
    `Event ${event.type} triggered ${applied.matchedNodeIds.length} flow node(s)`
  ]);
};

export interface AskLookup {
  ask: HumanAsk;
  nodeName: string;
  projectName: string;
  flowRunId?: string;
}

export const readAskByToken = async (
  orgId: string,
  projectId: string,
  token: string
): Promise<AskLookup | null> => {
  const located = await findProject(orgId, projectId);
  if (!located) return null;
  const runFound = await findFlowRunByAsk(orgId, projectId, undefined, token);
  if (runFound) {
    return {
      ask: expireAsk(runFound.ask),
      nodeName: runFound.node.name,
      projectName: located.project.name,
      flowRunId: runFound.run.id
    };
  }
  const found = findAskByToken(located.project, token);
  if (!found) return null;
  return { ask: expireAsk(found.ask), nodeName: found.node.name, projectName: located.project.name };
};

export const resolveCallbackAndAdvance = async (
  orgId: string,
  projectId: string,
  match: { nodeId?: string; runId?: string; externalId?: string },
  result: { status: 'success' | 'error'; output?: any; logs?: string[]; error?: string; resolvedBy: string }
): Promise<AdvanceOutcome> => {
  if (match.runId?.startsWith('vf:')) return (await settleVisibleCallback(orgId, projectId, match, result))!;
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const run = await findFlowRunByAction(orgId, projectId, match);
  if (run) {
    const runtime = materializeFlowRunProject(located.project, run);
    const resolved = resolvePendingRun(runtime, match, result);
    if (!resolved) return { ok: false, reason: 'no_matching_pending_run', flowRunId: run.id };
    const saved = await saveFlowRun(updateFlowRunFromProject(run, resolved.project));
    return advanceRunAndPersist(orgId, located, saved, resolved.log);
  }

  // Legacy fallback for an in-flight action created before FlowRun migration.
  const resolved = resolvePendingRun(located.project, match, result);
  if (!resolved) {
    let found = false;
    const milestones = located.project.milestones.map(m => ({
      ...m,
      subtasks: m.subtasks.map(task => {
        if (found || !match.nodeId || task.id !== match.nodeId) return task;
        if (match.runId && task.externalRunId !== match.runId) return task;
        if (match.externalId && task.externalExecutionId !== match.externalId) return task;
        if (task.status === 'Completed') return task;
        found = true;
        return {
          ...task,
          status: result.status === 'success' ? 'Completed' : 'Not Complete',
          taskOutput: { ...(task.taskOutput || {}), ...(result.output || {}) },
          evaluationResult: result.status === 'success' ? 'Completed from external event' : (result.error || 'External communication failed')
        };
      })
    }));
    if (!found) return { ok: false, reason: 'no_matching_pending_run' };
    const output = result.status === 'success' && result.output && typeof result.output === 'object' ? result.output : {};
    const legacyProject = {
      ...located.project,
      milestones,
      projectData: { ...(located.project.projectData || {}), ...output }
    };
    const occurrenceId = activeOccurrenceId(legacyProject.projectData) || `legacy:${Date.now()}:${randomUUID()}`;
    const migrated = await ensureOccurrenceRun(orgId, legacyProject, { occurrenceId, trigger: 'manual' });
    return advanceRunAndPersist(orgId, located, migrated, ['Subtask completed from external event']);
  }

  const occurrenceId = activeOccurrenceId(resolved.project.projectData) || `legacy:${Date.now()}:${randomUUID()}`;
  const migrated = await ensureOccurrenceRun(orgId, resolved.project, { occurrenceId, trigger: 'manual' });
  const migratedProject = materializeFlowRunProject(located.project, migrated);
  const folded = resolvePendingRun(migratedProject, match, result);
  const finalRun = folded ? await saveFlowRun(updateFlowRunFromProject(migrated, folded.project)) : migrated;
  return advanceRunAndPersist(orgId, located, finalRun, resolved.log);
};
