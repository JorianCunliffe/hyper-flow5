import { CoachingSession, HumanAsk, NodeType, Project } from '../types.js';
import { advanceProjectFlow, resolvePendingRun } from './flowOrchestrator.js';
import { findAskByToken } from './humanAsk.js';
import { serverExecutor } from './serverExecutor.js';
import { findProject, upsertCoachingSession, writeProject } from './serverStore.js';
import { deliverRaisedAsks } from './asks/deliverRaisedAsks.js';
import { expireAsk } from './asks/expireAsk.js';
export { respondToAsk } from './asks/respondToAsk.js';

/**
 * Server-side flow execution. Actions are executed in-process rather than over
 * HTTP — there is no browser in this path, which is the whole point: a human
 * answering by phone (and, later, email or SMS) moves the flow forward whether
 * or not anyone has the app open.
 */

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
            ? [...(node.actionConfig.runHistory || []), node.actionConfig.lastRun]
            : node.actionConfig.runHistory
        }
      } : {}),
      ...(node.decisionConfig ? {
        decisionConfig: { ...node.decisionConfig, selectedTargetId: undefined, decidedAt: undefined }
      } : {}),
      ...(node.loopConfig ? {
        loopConfig: { ...node.loopConfig, currentIteration: 0, exited: false }
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

export const coachingSessionFromProject = (
  orgId: string,
  project: Project,
  now = Date.now()
): (Omit<CoachingSession, 'createdAt' | 'updatedAt'> & Partial<Pick<CoachingSession, 'createdAt' | 'updatedAt'>>) | null => {
  const data = project.projectData || {};
  const occurrenceId = typeof data.schedule_occurrence_id === 'string' ? data.schedule_occurrence_id : '';
  if (data.project_template !== 'daily_coaching' || !occurrenceId) return null;
  const callNode = project.milestones.find(node => node.id === 'COACH_CALL') ||
    project.milestones.find(node => node.nodeType === NodeType.PHONE_CALL && node.actionConfig?.template?.includes('coaching_session'));
  const extractionNode = project.milestones.find(node => node.id === 'COACH_EXTRACT');
  const writeNode = project.milestones.find(node => node.id === 'COACH_WRITE');
  const callRun = callNode?.actionConfig?.lastRun;
  const callOutput = callRun?.output && typeof callRun.output === 'object' ? callRun.output : {};
  const outcome = callRun?.communicationOutcome;
  let status: 'scheduled' | 'calling' | 'review_required' | 'completed' | 'failed' = 'scheduled';
  if (callRun?.status === 'error') status = 'failed';
  else if (writeNode?.actionConfig?.lastRun?.status === 'success') status = 'completed';
  else if (extractionNode?.actionConfig?.lastRun?.status === 'success' && data.coaching_requires_review) status = 'review_required';
  else if (callRun) status = 'calling';

  const attempts = [callRun, ...(callNode?.actionConfig?.runHistory || [])]
    .filter(run => Boolean(run?.id)).length;
  const maxAttempts = Math.min(Math.max(Number(data.coaching_max_attempts || 2), 1), 5);
  const retryDelayMinutes = Math.min(Math.max(Number(data.coaching_retry_delay_minutes || 30), 5), 24 * 60);
  const retryWindowMinutes = Math.min(Math.max(Number(data.coaching_retry_window_minutes || 180), 5), 24 * 60);
  const scheduledFor = typeof data.scheduled_for === 'string' ? Date.parse(data.scheduled_for) : NaN;
  const disposition = typeof outcome?.disposition === 'string'
    ? outcome.disposition
    : typeof callOutput.disposition === 'string' ? callOutput.disposition : undefined;
  const retryableDisposition = ['no_answer', 'busy', 'provider_failure', 'failed', 'voicemail'].includes(disposition || '');
  const withinWindow = Number.isFinite(scheduledFor) && now <= scheduledFor + retryWindowMinutes * 60_000;
  const nextRetryAt = status === 'failed' && retryableDisposition && attempts < maxAttempts && withinWindow
    ? Math.max(now, Number(callRun?.at || now) + retryDelayMinutes * 60_000)
    : undefined;

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
    disposition,
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
    retryStatus: nextRetryAt ? 'pending' : status === 'failed' && retryableDisposition && attempts >= maxAttempts ? 'exhausted' : undefined
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
    // The project is the workflow source of truth. A projection outage must not
    // turn an already-persisted callback into a provider retry that can no longer
    // match its completed run. A later advance reconciles the same session id.
    const warning = `Coaching session projection pending reconciliation: ${error?.message || String(error)}`;
    console.error(warning);
    return warning;
  }
};

/** Loads a project, advances it as far as it will go, and persists the result. */
export const advanceServerFlow = async (orgId: string, projectId: string): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const { project, log, pending, askedFor } = await advanceProjectFlow(located.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });

  const delivered = await deliverRaisedAsks(project, orgId, askedFor);
  await writeProject(orgId, located.index, delivered.project);
  const projectionWarning = await syncCoachingSessionFromProject(orgId, delivered.project);
  return { ok: true, log: [...log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])], pending };
};

/**
 * Starts or resumes one durable scheduled occurrence. Reserved correlation
 * fields always win over schedule input so a configured payload cannot forge a
 * different occurrence identity. A retry of the same occurrence is safe: the
 * flow engine will not redispatch an action that is already waiting or complete.
 */
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
  await writeProject(orgId, located.index, delivered.project);
  const projectionWarning = await syncCoachingSessionFromProject(orgId, delivered.project);
  return { ok: true, log: [...advanced.log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])], pending: advanced.pending };
};

export interface AskLookup {
  ask: HumanAsk;
  nodeName: string;
  projectName: string;
}

/**
 * Reads an ask by its token. The token is the capability — it authorises
 * answering this one ask and nothing else, so this deliberately returns only
 * what a reviewer needs to see, never the surrounding project.
 */
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
 * Resolves an action run that was waiting on a provider callback, then advances
 * the flow so downstream nodes react to whatever the human just told us.
 */
export const resolveCallbackAndAdvance = async (
  orgId: string,
  projectId: string,
  match: { nodeId?: string; runId?: string; externalId?: string },
  result: { status: 'success' | 'error'; output?: any; logs?: string[]; error?: string; resolvedBy: string }
): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const resolved = resolvePendingRun(located.project, match, result);
  if (!resolved) {
    // Legacy workflow definitions can put executable task types on subtasks.
    // They use the same explicit correlation and waiting lifecycle as action
    // nodes, so complete them deterministically instead of leaving an orphaned
    // communication behind.
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
    await writeProject(orgId, located.index, delivered.project);
    const projectionWarning = await syncCoachingSessionFromProject(orgId, delivered.project);
    return {
      ok: true,
      log: ['Subtask completed from external event', ...advanced.log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])],
      pending: advanced.pending
    };
  }

  // Persist terminal provider failures before doing anything else. Advancing a
  // failed action in the same callback would immediately dispatch a duplicate
  // call/SMS. Coaching retries are claimed later by the scheduler; other failed
  // actions remain explicitly retryable by a deliberate flow advance.
  if (result.status === 'error') {
    await writeProject(orgId, located.index, resolved.project);
    const projectionWarning = await syncCoachingSessionFromProject(orgId, resolved.project);
    return {
      ok: true,
      log: [...resolved.log, 'Automatic redispatch suppressed after provider failure', ...(projectionWarning ? [projectionWarning] : [])],
      pending: []
    };
  }

  const advanced = await advanceProjectFlow(resolved.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });
  const delivered = await deliverRaisedAsks(advanced.project, orgId, advanced.askedFor);
  await writeProject(orgId, located.index, delivered.project);
  const projectionWarning = await syncCoachingSessionFromProject(orgId, delivered.project);
  return { ok: true, log: [...resolved.log, ...advanced.log, ...delivered.log, ...(projectionWarning ? [projectionWarning] : [])], pending: advanced.pending };
};
