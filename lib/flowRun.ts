import { createHash } from 'node:crypto';
import type { Milestone, Project } from '../types.js';
import { getNodeType, isActionNode, isAwaitingReview, resolveNodeStates } from './flowEngine.js';
import { resetProjectForOccurrence } from './flowOccurrence.js';
import { safeCoachingRetryGraph } from './projectTemplates.js';
import type { FlowRun, FlowRunStatus, FlowRunTrigger, NodeRun, NodeRunStatus, RuntimeMilestone } from './flowRuntimeTypes.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const flowRunIdForOccurrence = (orgId: string, projectId: string, occurrenceId: string): string =>
  `fr_${createHash('sha256').update(`${orgId}:${projectId}:${occurrenceId}`).digest('hex').slice(0, 28)}`;

export const materializeFlowRunProject = (definition: Project, run: FlowRun): Project => safeCoachingRetryGraph({
  ...definition,
  updatedAt: run.updatedAt,
  milestones: clone(run.state.milestones),
  projectData: { ...clone(run.state.projectData), flow_started_at: run.startedAt, flow_dispatch_version: run.dispatchVersion || 0 }
});

const waitConfig = (node: Milestone): any =>
  (node as RuntimeMilestone).holdConfig || node.waitConfig;

const nodeStatus = (project: Project, node: Milestone): NodeRunStatus => {
  const states = resolveNodeStates(project);
  const resolution = states.get(node.id);
  if (resolution === 'skipped') return 'skipped';
  if (resolution === 'complete') return 'completed';
  const action = node.actionConfig?.lastRun;
  if (action?.status === 'pending') return 'waiting';
  if (action?.status === 'error' && node.actionConfig?.failureMode !== 'continue') return 'failed';
  if (waitConfig(node)?.holdId && !waitConfig(node)?.resolvedAt) return 'waiting';
  if (isAwaitingReview(node, project.projectData)) return 'waiting';
  if (action) return 'running';
  return 'pending';
};

const runtimeIdentity = (node: Milestone): string => {
  const hold = waitConfig(node);
  const action = node.actionConfig?.lastRun;
  const ask = (node.asks || []).find(item => item.status === 'open') || (node.asks || []).at(-1);
  return action?.id || hold?.holdId || ask?.id || node.decisionConfig?.decidedAt?.toString() ||
    node.eventTriggerConfig?.lastEventId || node.completedAt?.toString() || 'definition';
};

const nodeRunId = (flowRunId: string, nodeId: string, attempt: number, identity: string): string =>
  `nr_${createHash('sha256').update(`${flowRunId}:${nodeId}:${attempt}:${identity}`).digest('hex').slice(0, 28)}`;

/**
 * Reconciles immutable-ish NodeRun attempt records from the current run state.
 * A loop re-arm creates a new attempt rather than overwriting the prior one.
 */
export const reconcileNodeRuns = (run: FlowRun, project: Project, now = Date.now()): Record<string, NodeRun[]> => {
  const next: Record<string, NodeRun[]> = clone(run.nodeRuns || {});
  for (const node of project.milestones) {
    const existing = next[node.id] || [];
    const identity = runtimeIdentity(node);
    const last = existing.at(-1);
    const actionRunId = node.actionConfig?.lastRun?.id;
    const holdId = waitConfig(node)?.holdId;
    const askIds = (node.asks || []).filter(item => item.status !== 'cancelled').map(item => item.id);
    const status = nodeStatus(project, node);
    const sameAttempt = !!last && (
      (actionRunId && last.actionRunId === actionRunId) ||
      (holdId && last.holdIds?.includes(holdId)) ||
      (!actionRunId && !holdId && last.id === nodeRunId(run.id, node.id, last.attempt, identity))
    );

    if (sameAttempt && last) {
      existing[existing.length - 1] = {
        ...last,
        status,
        updatedAt: now,
        ...(status === 'completed' || status === 'failed' || status === 'skipped' ? { completedAt: last.completedAt || now } : {}),
        ...(askIds.length ? { askIds } : {}),
        ...(node.actionConfig?.lastRun?.error ? { error: node.actionConfig.lastRun.error } : {})
      };
      next[node.id] = existing;
      continue;
    }

    const hasRuntimeEvidence = actionRunId || holdId || askIds.length || status !== 'pending';
    if (!hasRuntimeEvidence && existing.length) continue;
    const attempt = existing.length + 1;
    existing.push({
      id: nodeRunId(run.id, node.id, attempt, identity),
      flowRunId: run.id,
      nodeId: node.id,
      nodeType: String(getNodeType(node)),
      attempt,
      status,
      startedAt: now,
      updatedAt: now,
      ...(status === 'completed' || status === 'failed' || status === 'skipped' ? { completedAt: now } : {}),
      ...(actionRunId ? { actionRunId } : {}),
      ...(holdId ? { holdIds: [holdId] } : {}),
      ...(askIds.length ? { askIds } : {}),
      ...(node.actionConfig?.lastRun?.error ? { error: node.actionConfig.lastRun.error } : {})
    });
    next[node.id] = existing;
  }
  return next;
};

export const deriveFlowRunStatus = (project: Project): FlowRunStatus => {
  const states = resolveNodeStates(project);
  const active = project.milestones.filter(node => states.get(node.id) !== 'skipped');
  if (active.length && active.every(node => states.get(node.id) === 'complete')) return 'completed';

  const blockedFailure = active.some(node =>
    isActionNode(node) && node.actionConfig?.lastRun?.status === 'error' && node.actionConfig.failureMode !== 'continue'
  );
  if (blockedFailure) return 'failed';

  const waiting = active.some(node => {
    const hold = waitConfig(node);
    return node.actionConfig?.lastRun?.status === 'pending' ||
      (!!hold?.holdId && !hold?.resolvedAt) ||
      (node.asks || []).some(ask => ask.status === 'open');
  });
  return waiting ? 'waiting' : 'running';
};

export interface NewFlowRunInput {
  orgId: string;
  project: Project;
  occurrenceId: string;
  trigger: FlowRunTrigger;
  triggerId?: string;
  flowId?: string;
  input?: Record<string, unknown>;
  clearProjectDataKeys?: string[];
  now?: number;
}

export const createFlowRun = (input: NewFlowRunInput): FlowRun => {
  const now = input.now ?? Date.now();
  const reset = resetProjectForOccurrence(input.project, input.occurrenceId, input.clearProjectDataKeys || []);
  const project: Project = {
    ...reset,
    updatedAt: now,
    projectData: {
      ...(reset.projectData || {}),
      ...(input.input || {}),
      flow_occurrence_id: input.occurrenceId,
      flow_run_id: flowRunIdForOccurrence(input.orgId, input.project.id, input.occurrenceId),
      flow_started_at: now,
      flow_dispatch_version: 1,
      ...(input.flowId ? { flow_id: input.flowId } : {})
    }
  };
  const run: FlowRun = {
    dispatchVersion: 1,
    id: String(project.projectData!.flow_run_id),
    orgId: input.orgId,
    projectId: input.project.id,
    flowId: input.flowId,
    occurrenceId: input.occurrenceId,
    trigger: input.trigger,
    triggerId: input.triggerId,
    status: 'running',
    state: { milestones: clone(project.milestones), projectData: clone(project.projectData || {}) },
    nodeRuns: {},
    revision: 0,
    startedAt: now,
    updatedAt: now
  };
  run.nodeRuns = reconcileNodeRuns(run, project, now);
  return run;
};

export const updateFlowRunFromProject = (run: FlowRun, project: Project, now = Date.now()): FlowRun => {
  const status = deriveFlowRunStatus(project);
  return {
    ...run,
    status,
    state: { milestones: clone(project.milestones), projectData: clone(project.projectData || {}) },
    nodeRuns: reconcileNodeRuns(run, project, now),
    updatedAt: now,
    ...(status === 'completed' || status === 'failed' ? { completedAt: run.completedAt || now } : { completedAt: undefined })
  };
};
