import { ActionRun, HumanAsk, Milestone, Project } from '../types.js';
import { ACTION_TASK_TYPE, advanceFlow, getNodeType, isActionNode } from './flowEngine.js';
import { createApprovalAsk, upsertAsk } from './humanAsk.js';

/**
 * Environment-agnostic flow orchestration.
 *
 * The flow engine (./flowEngine) is pure: it decides *what* should happen next.
 * This module performs the effects — running action nodes and folding their
 * results back into the project — without knowing how those effects are carried
 * out. The browser injects an executor that POSTs to /api/tasks/execute; the
 * server injects one that calls executeTask() directly. That is what lets the
 * flow advance when nobody has the app open.
 */

export interface ActionExecutionContext {
  orgId?: string;
  projectId: string;
  nodeId: string;
  runId: string;
  /** Public base URL used to build provider callback URLs. */
  webhookBaseUrl?: string;
  /** Reviewer feedback from a previous attempt, when this run is a redo. */
  revision?: { feedback: string; priorOutput?: any; count: number };
}

export interface ActionOutcome {
  status: 'success' | 'error' | 'pending';
  output?: any;
  logs?: string[];
  error?: string;
  externalId?: string;
  externalExecutionId?: string;
  externalService?: string;
  startedAt?: number;
}

export type ActionExecutor = (
  taskType: string,
  templateFile: string,
  projectData: Record<string, any>,
  ctx: ActionExecutionContext
) => Promise<ActionOutcome>;

export interface OrchestrationResult {
  project: Project;
  log: string[];
  /** Node ids whose runs are awaiting an inbound webhook. */
  pending: string[];
  /** Asks raised during this advance, for the caller to deliver to people. */
  askedFor: { nodeId: string; ask: HumanAsk }[];
}

let runCounter = 0;
export const newRunId = (): string =>
  `run_${Date.now().toString(36)}_${(++runCounter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Records a run against a node. On success the run's output is merged into
 * projectData so downstream decisions and loops can branch on it. Pending and
 * failed runs never touch projectData.
 *
 * Pure — returns a new project.
 */
export const applyActionRun = (project: Project, nodeId: string, run: ActionRun): Project => {
  const merge = run.status === 'success' && run.output && typeof run.output === 'object' && !Array.isArray(run.output);

  return {
    ...project,
    updatedAt: Date.now(),
    projectData: merge ? { ...(project.projectData || {}), ...run.output } : project.projectData,
    milestones: project.milestones.map(m => {
      if (m.id !== nodeId) return m;
      const prior = m.actionConfig?.lastRun;
      // A pending run being resolved is the same run, not a new one — don't archive it.
      const isResolutionOfPrior = !!prior && prior.status === 'pending' && !!run.id && prior.id === run.id;
      return {
        ...m,
        actionConfig: {
          template: '',
          ...(m.actionConfig || {}),
          lastRun: run,
          runHistory: prior && !isResolutionOfPrior ? [...(m.actionConfig?.runHistory || []), prior] : m.actionConfig?.runHistory
        }
      };
    })
  };
};

/** Finds the node holding a pending run with the given run id or provider external id. */
export const findNodeByRun = (
  project: Project,
  match: { nodeId?: string; runId?: string; externalId?: string }
): Milestone | undefined =>
  project.milestones.find(m => {
    const run = m.actionConfig?.lastRun;
    if (!run) return false;
    if (!match.nodeId && !match.runId && !match.externalId) return false;
    if (match.nodeId && m.id !== match.nodeId) return false;
    if (match.runId && run.id !== match.runId) return false;
    if (match.externalId && run.externalExecutionId !== match.externalId && run.externalId !== match.externalId) return false;
    return true;
  });

/** Executes a single action node and folds the result back into the project. */
export const runActionNode = async (
  project: Project,
  nodeId: string,
  executor: ActionExecutor,
  opts: { orgId?: string; webhookBaseUrl?: string } = {}
): Promise<{ project: Project; log: string[]; run?: ActionRun }> => {
  const node = project.milestones.find(m => m.id === nodeId);
  if (!node) return { project, log: [`Node ${nodeId} not found`] };

  const taskType = ACTION_TASK_TYPE[getNodeType(node)];
  if (!taskType) return { project, log: [`${node.name}: not an executable action node`] };

  const runId = newRunId();
  const revision = node.actionConfig?.revision;
  const ctx: ActionExecutionContext = {
    orgId: opts.orgId,
    projectId: project.id,
    nodeId,
    runId,
    webhookBaseUrl: opts.webhookBaseUrl,
    revision: revision ? { feedback: revision.feedback, priorOutput: revision.priorOutput, count: revision.count } : undefined
  };

  let outcome: ActionOutcome;
  try {
    outcome = await executor(taskType, node.actionConfig?.template || '', project.projectData || {}, ctx);
  } catch (e: any) {
    outcome = { status: 'error', error: e?.message || String(e) };
  }

  const run: ActionRun = {
    id: runId,
    at: Date.now(),
    status: outcome.status,
    executionState:
      outcome.status === 'pending' ? 'waiting'
      : outcome.status === 'success' ? 'completed'
      : 'failed',
    output: outcome.output,
    logs: outcome.logs,
    error: outcome.error,
    externalId: outcome.externalId,
    externalExecutionId: outcome.externalExecutionId || outcome.externalId,
    externalService: outcome.externalService,
    startedAt: outcome.startedAt || Date.now()
  };

  const label =
    outcome.status === 'success' ? 'executed successfully'
    : outcome.status === 'pending' ? 'dispatched — awaiting callback'
    : `failed — ${run.error}`;

  return { project: applyActionRun(project, nodeId, run), log: [`${node.name}: ${label}`], run };
};

/**
 * Resolves a previously-pending run when its provider calls back.
 * Returns null when the run cannot be matched (already resolved, or unknown).
 */
export const resolvePendingRun = (
  project: Project,
  match: { nodeId?: string; runId?: string; externalId?: string },
  result: { status: 'success' | 'error'; output?: any; logs?: string[]; error?: string; resolvedBy: string }
): { project: Project; log: string[]; nodeId: string } | null => {
  const node = findNodeByRun(project, match);
  if (!node) return null;

  const prior = node.actionConfig!.lastRun!;
  if (prior.status !== 'pending') return null; // already resolved — treat as duplicate

  const run: ActionRun = {
    ...prior,
    status: result.status,
    executionState: result.status === 'success' ? 'completed' : 'failed',
    output: { ...(prior.output || {}), ...(result.output || {}) },
    logs: [...(prior.logs || []), ...(result.logs || [])],
    error: result.error,
    resolvedAt: Date.now(),
    resolvedBy: result.resolvedBy
  };

  return {
    project: applyActionRun(project, node.id, run),
    log: [`${node.name}: ${result.status === 'success' ? 'callback received — completed' : `callback reported failure — ${result.error}`}`],
    nodeId: node.id
  };
};

/**
 * Advances the flow and runs whatever it schedules, repeating until the flow
 * settles. Each round is: advance (decide/iterate) → run ready auto-execute
 * actions → advance again, since an action's output can satisfy a downstream
 * decision. Bounded so a misconfigured loop cannot spin forever.
 */
export const advanceProjectFlow = async (
  project: Project,
  executor: ActionExecutor,
  opts: { orgId?: string; webhookBaseUrl?: string; maxRounds?: number } = {}
): Promise<OrchestrationResult> => {
  const maxRounds = opts.maxRounds ?? 5;
  let current = project;
  const log: string[] = [];
  const pending = new Set<string>();
  const askedFor: { nodeId: string; ask: HumanAsk }[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const { project: advanced, actionsToRun, asksToOpen, log: advanceLog } = advanceFlow(current);
    current = advanced;
    log.push(...advanceLog);

    // Raise review asks before running anything else: a node awaiting sign-off
    // is not complete, so its dependents stay blocked either way, but the person
    // should be asked as early as possible.
    for (const nodeId of asksToOpen) {
      const node = current.milestones.find(m => m.id === nodeId);
      if (!node) continue;
      const ask = createApprovalAsk(node, { projectId: current.id });
      current = { ...current, milestones: current.milestones.map(m => (m.id === nodeId ? upsertAsk(m, ask) : m)) };
      askedFor.push({ nodeId, ask });
      log.push(`${node.name}: awaiting review by ${(ask.assignees || []).join(', ') || 'an unassigned reviewer'}`);
    }

    // Never re-dispatch an action that is already waiting on a callback.
    const runnable = actionsToRun.filter(id => {
      const run = current.milestones.find(m => m.id === id)?.actionConfig?.lastRun;
      return run?.status !== 'pending';
    });

    if (runnable.length === 0) break;

    for (const nodeId of runnable) {
      const res = await runActionNode(current, nodeId, executor, opts);
      current = res.project;
      log.push(...res.log);
      if (res.run?.status === 'pending') pending.add(nodeId);
    }
  }

  if (log.length === 0) log.push('Flow is up to date — nothing to advance.');

  return { project: current, log, pending: [...pending], askedFor };
};

/** True when a node is an action node currently awaiting an inbound callback. */
export const isAwaitingCallback = (m: Milestone): boolean =>
  isActionNode(m) && m.actionConfig?.lastRun?.status === 'pending';
