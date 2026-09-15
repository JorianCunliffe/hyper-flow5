import { CoachingSession, HumanAsk, Project } from '../types.js';
import { advanceProjectFlow, resolvePendingRun } from './flowOrchestrator.js';
import { findAskByToken } from './humanAsk.js';
import { serverExecutor } from './serverExecutor.js';
import { findProject, upsertCoachingSession, writeProject } from './serverStore.js';
import { deliverRaisedAsks } from './asks/deliverRaisedAsks.js';
import { expireAsk } from './asks/expireAsk.js';
import { syncTimerHoldsFromProject } from './flowHoldStore.js';
import { settleVisibleCallback } from './visibleFlows/runtime.js';
export { respondToAsk } from './asks/respondToAsk.js';

export interface AdvanceOutcome {
  ok: boolean;
  reason?: string;
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
  const projectData = { ...(project.projectData || {}) };
  for (const key of occurrence.clearProjectDataKeys || []) delete projectData[key];
  return {
    ...project,
    projectData,
    milestones: project.milestones.map(node => ({
      ...node,
      ...(node.actionConfig ? {
        actionConfig: {
          ...node.actionConfig,
          lastRun: undefined,
          revision: undefined,
          runHistory: node.actionConfig.lastRun
            ? [...(node.actionConfig.runHistory || []), {
                ...node.actionConfig.lastRun,
                scheduleOccurrenceId: node.actionConfig.lastRun.scheduleOccurrenceId || project.projectData?.schedule_occurrence_id
              }]
            : node.actionConfig.runHistory
        }
      } : {}),
      ...(node.decisionConfig ? {
        decisionConfig: { ...node.decisionConfig, selectedTargetId: undefined, decidedAt: undefined }
      } : {}),
      ...(node.loopConfig ? {
        loopConfig: { ...node.loopConfig, currentIteration: 0, exited: false }
      } : {}),
      ...(node.waitConfig ? {
        waitConfig: {
          ...node.waitConfig,
          resumeAt: undefined,
          armedAt: undefined,
          resolvedAt: undefined,
          holdId: undefined,
          occurrenceId: undefined
        }
      } : {}),
      ...(node.asks ? {
        asks: node.asks.map(ask => ask.status === 'open' ? { ...ask, status: 'cancelled' as const } : ask)
      } : {})
    }))
  };
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
      schedule_id: occurrence.scheduleId,
      schedule_run_id: occurrence.scheduleRunId,
      schedule_occurrence_id: occurrence.scheduleRunId,
      scheduled_for: new Date(occurrence.scheduledFor).toISOString(),
      ...(occurrence.flowId ? { flow_id: occurrence.flowId } : {})
    }
  };
};

/** Compatibility projection only. Retry execution itself is expressed by flow primitives. */
export const coachingSessionFromProject = (
  orgId: string,
  project: Project,
  now = Date.now()
): (Omit<CoachingSession, 'createdAt' | 'updatedAt'> & Partial<Pick<CoachingSession, 'createdAt' | 'updatedAt'>>) | null => {
  const data = project.projectData || {};
  const occurrenceId = typeof data.schedule_occurrence_id === 'string' ? data.schedule_occurrence_id : '';
  if (data.project_template !== 'daily_coaching' || !occurrenceId) return null;
  const callNode = project.milestones.find(node => node.id === 'COACH_CALL');
  const extractionNode = project.milestones.find(node => node.id === 'COACH_EXTRACT');
  const writeNode = project.milestones.find(node => node.id === 'COACH_WRITE');
  const retryWait = project.milestones.find(node => node.id === 'COACH_RETRY_WAIT');
  const retryLoop = project.milestones.find(node => node.id === 'COACH_RETRY_LOOP');
  const callRun = callNode?.actionConfig?.lastRun;
  const callOutput = callRun?.output && typeof callRun.output === 'object' ? callRun.output : {};
  const outcome = callRun?.communicationOutcome;
  const retryWaiting = !!retryWait?.waitConfig?.resumeAt && !retryWait.waitConfig.resolvedAt;
  const retryExhausted = !!retryLoop?.loopConfig?.exited && callRun?.status === 'error';
  let status: 'scheduled' | 'calling' | 'review_required' | 'completed' | 'failed' = 'scheduled';
  if (writeNode?.actionConfig?.lastRun?.status === 'success') status = 'completed';
  else if (extractionNode?.actionConfig?.lastRun?.status === 'success' && data.coaching_requires_review) status = 'review_required';
  else if (callRun?.status === 'pending') status = 'calling';
  else if (retryExhausted) status = 'failed';
  else if (callRun?.status === 'error' && !retryWaiting) status = 'failed';

  const scheduledFor = typeof data.scheduled_for === 'string' ? Date.parse(data.scheduled_for) : NaN;
  const history = callNode?.actionConfig?.runHistory || [];
  const attempts = history.filter(run => run.scheduleOccurrenceId === occurrenceId).length + (callRun ? 1 : 0);
  const nextRetryAt = retryWaiting ? Number(retryWait?.waitConfig?.resumeAt) : undefined;

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
    attemptCount: attempts,
    nextRetryAt,
    retryStatus: retryWaiting ? 'pending' : retryExhausted ? 'exhausted' : undefined
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

const persistAdvancedProject = async (
  orgId: string,
  index: number,
  project: Project
): Promise<string | undefined> => {
  await writeProject(orgId, index, project);
  // Persist timer indexes only after the project containing the armed hold is durable.
  await syncTimerHoldsFromProject(orgId, project);
  return syncCoachingSessionFromProject(orgId, project);
};

/** Loads a project, advances it as far as it will go, and persists the result. */
export const advanceServerFlow = async (
  orgId: string,
  projectId: string
): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const { project, log, pending, askedFor } = await advanceProjectFlow(located.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });

  const delivered = await deliverRaisedAsks(project, orgId, askedFor);
  const projectionWarning = await persistAdvancedProject(orgId, located.index, delivered.project);
  return { ok: true, log: [...log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])], pending };
};

export const advanceScheduledServerFlow = async (
  orgId: string,
  projectId: string,
  occurrence: ScheduledFlowContext
): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const project = applyScheduledFlowContext(located.project, occurrence);
  const advanced = await advanceProjectFlow(project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });
  const delivered = await deliverRaisedAsks(advanced.project, orgId, advanced.askedFor);
  const projectionWarning = await persistAdvancedProject(orgId, located.index, delivered.project);
  return { ok: true, log: [...advanced.log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])], pending: advanced.pending };
};

export interface AskLookup {
  ask: HumanAsk;
  nodeName: string;
  projectName: string;
}

export const readAskByToken = async (
  orgId: string,
  projectId: string,
  token: string
): Promise<AskLookup | null> => {
  const located = await findProject(orgId, projectId);
  if (!located) return null;

  const found = findAskByToken(located.project, token);
  if (!found) return null;

  return { ask: expireAsk(found.ask), nodeName: found.node.name, projectName: located.project.name };
};

/**
 * Resolves an action waiting on a provider callback, then always re-enters the
 * graph. Failed actions cannot redispatch themselves: block-mode failures remain
 * held, while continue-mode failures let a Decision/Wait/Loop recovery path run.
 */
export const resolveCallbackAndAdvance = async (
  orgId: string,
  projectId: string,
  match: { nodeId?: string; runId?: string; externalId?: string },
  result: { status: 'success' | 'error'; output?: any; logs?: string[]; error?: string; resolvedBy: string }
): Promise<AdvanceOutcome> => {
  if (match.runId?.startsWith('vf:')) return (await settleVisibleCallback(orgId, projectId, match, result))!;
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

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

    const output = result.status === 'success' && result.output && typeof result.output === 'object'
      ? result.output
      : {};
    const subtaskProject = {
      ...located.project,
      milestones,
      projectData: { ...(located.project.projectData || {}), ...output }
    };
    const advanced = await advanceProjectFlow(subtaskProject, serverExecutor, {
      orgId,
      webhookBaseUrl: process.env.PUBLIC_BASE_URL
    });
    const delivered = await deliverRaisedAsks(advanced.project, orgId, advanced.askedFor);
    const projectionWarning = await persistAdvancedProject(orgId, located.index, delivered.project);
    return {
      ok: true,
      log: ['Subtask completed from external event', ...advanced.log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])],
      pending: advanced.pending
    };
  }

  const advanced = await advanceProjectFlow(resolved.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });
  const delivered = await deliverRaisedAsks(advanced.project, orgId, advanced.askedFor);
  const projectionWarning = await persistAdvancedProject(orgId, located.index, delivered.project);
  return { ok: true, log: [...resolved.log, ...advanced.log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])], pending: advanced.pending };
};
