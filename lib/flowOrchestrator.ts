import { expandCollection } from './flowCollections.js';
import { ActionRun, HumanAsk, Milestone, Project, NodeType } from '../types.js';
import { ACTION_TASK_TYPE, activeOccurrenceId, advanceFlow, getHoldConfig, getLoopBody, getNodeType, isActionNode } from './flowEngine.js';
import { createApprovalAsk, upsertAsk } from './humanAsk.js';
import { communicationOutcomeFromOutput } from './actionRunPresentation.js';
import { createHumanHoldAsk } from './flowHoldAsk.js';

/**
 * Environment-agnostic flow orchestration.
 *
 * The flow engine is pure: it decides what should happen next. This module
 * performs effects and folds results back into the isolated run-state Project.
 */

export interface ActionExecutionContext {
  orgId?: string;
  projectId: string;
  nodeId: string;
  runId: string;
  flowRunId?: string;
  occurrenceId?: string;
  attempt?: number;
  webhookBaseUrl?: string;
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
  pending: string[];
  askedFor: { nodeId: string; ask: HumanAsk }[];
}

let runCounter = 0;
export const newRunId = (): string =>
  `run_${Date.now().toString(36)}_${(++runCounter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const actionAttemptIdentity = (project: Project, nodeId: string): { runId: string; attempt: number } => {
  const node = project.milestones.find(item => item.id === nodeId);
  const occurrence = activeOccurrenceId(project.projectData);
  const history = [...(node?.actionConfig?.runHistory || []), ...(node?.actionConfig?.lastRun ? [node.actionConfig.lastRun] : [])];
  const attempt = history.filter(run => run.scheduleOccurrenceId === occurrence).length + 1;
  const flowRunId = project.projectData?.flow_run_id;
  return { attempt, runId: flowRunId
    ? `op:${encodeURIComponent(String(flowRunId))}:${encodeURIComponent(nodeId)}:${attempt}`
    : newRunId() };
};

const validResultVariable = (value: unknown): string | undefined => {
  const key = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : undefined;
};

export const applyActionRun = (project: Project, nodeId: string, run: ActionRun): Project => {
  const node = project.milestones.find(m => m.id === nodeId);
  const merge = run.status === 'success' && run.output && typeof run.output === 'object' && !Array.isArray(run.output);
  const resultVariable = validResultVariable(node?.actionConfig?.resultVariable);
  const terminal = run.status !== 'pending' && resultVariable;
  const outcome = run.communicationOutcome || communicationOutcomeFromOutput(run.output);
  const resultData = terminal ? {
    [resultVariable!]: run.status,
    [`${resultVariable}_success`]: run.status === 'success' && outcome?.successful !== false,
    ...(run.output !== undefined ? { [`${resultVariable}_output`]: run.output } : {}),
    ...(run.error ? { [`${resultVariable}_error`]: run.error } : {}),
    ...(outcome?.disposition ? { [`${resultVariable}_disposition`]: outcome.disposition } : {}),
    ...(outcome?.failureCode ? { [`${resultVariable}_failure_code`]: outcome.failureCode } : {}),
    ...(outcome?.providerStatus ? { [`${resultVariable}_provider_status`]: outcome.providerStatus } : {})
  } : {};
  const nextProjectData = merge || terminal
    ? { ...(project.projectData || {}), ...(merge ? run.output : {}), ...resultData }
    : project.projectData;

  return {
    ...project,
    updatedAt: Date.now(),
    projectData: nextProjectData,
    milestones: project.milestones.map(m => {
      if (m.id !== nodeId) return m;
      const prior = m.actionConfig?.lastRun;
      const isResolutionOfPrior = !!prior && !!run.id && prior.id === run.id;
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

  if (node.actionConfig?.forEach && !node.actionConfig.collection) {
    try {
      if (project.milestones.some(candidate => candidate.nodeType === NodeType.LOOP && getLoopBody(project, candidate).includes(node.id))) throw new Error('For each cannot be nested inside a control-flow Loop');
      return { project: expandCollection(project, node), log: [`${node.name}: froze collection inputs before dispatch`] };
    } catch (error: any) {
      const run: ActionRun = { id: actionAttemptIdentity(project, nodeId).runId, at: Date.now(), status: 'error', error: error.message, scheduleOccurrenceId: activeOccurrenceId(project.projectData) };
      return { project: applyActionRun(project, nodeId, run), log: [error.message], run };
    }
  }
  const { runId, attempt } = actionAttemptIdentity(project, nodeId);
  const revision = node.actionConfig?.revision;
  const ctx: ActionExecutionContext = {
    orgId: opts.orgId,
    projectId: project.id,
    nodeId,
    runId,
    flowRunId: project.projectData?.flow_run_id,
    occurrenceId: activeOccurrenceId(project.projectData),
    attempt,
    webhookBaseUrl: opts.webhookBaseUrl,
    revision: revision ? { feedback: revision.feedback, priorOutput: revision.priorOutput, count: revision.count } : undefined
  };

  let outcome: ActionOutcome;
  try {
    if (node.actionConfig?.collection) {
      const children = node.actionConfig.collection.childIds.map(id => project.milestones.find(m => m.id === id));
      if (children.some(child => child?.actionConfig?.lastRun?.status !== 'success')) throw new Error('Collection still has incomplete items');
      outcome = { status: 'success', output: { items: children.map(child => ({ item: child!.actionConfig!.collectionItem, output: child!.actionConfig!.lastRun!.output })), count: children.length } };
    } else {
      const parent = node.actionConfig?.collectionParentId ? project.milestones.find(candidate => candidate.id === node.actionConfig!.collectionParentId) : undefined;
      const data = parent ? { ...parent.actionConfig?.collection?.data, ...node.actionConfig?.collectionData } : project.projectData || {};
      outcome = await executor(taskType, node.actionConfig?.template || '', data, ctx);
    }
  } catch (e: any) {
    if (e?.recoverable) throw e;
    outcome = { status: 'error', error: e?.message || String(e) };
  }

  const run: ActionRun = {
    id: runId,
    scheduleOccurrenceId: activeOccurrenceId(project.projectData),
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
    startedAt: outcome.startedAt || Date.now(),
    resolvedAt: outcome.status === 'pending' ? undefined : Date.now(),
    communicationOutcome: communicationOutcomeFromOutput(outcome.output)
  };

  const label =
    outcome.status === 'success' ? 'executed successfully'
    : outcome.status === 'pending' ? 'dispatched — awaiting callback'
    : `failed — ${run.error}`;

  return { project: applyActionRun(project, nodeId, run), log: [`${node.name}: ${label}`], run };
};

export const resolvePendingRun = (
  project: Project,
  match: { nodeId?: string; runId?: string; externalId?: string },
  result: { status: 'success' | 'error'; output?: any; logs?: string[]; error?: string; resolvedBy: string }
): { project: Project; log: string[]; nodeId: string } | null => {
  const node = findNodeByRun(project, match);
  if (!node) return null;

  const prior = node.actionConfig!.lastRun!;
  if (prior.status !== 'pending') return null;

  const run: ActionRun = {
    ...prior,
    status: result.status,
    executionState: result.status === 'success' ? 'completed' : 'failed',
    output: { ...(prior.output || {}), ...(result.output || {}) },
    logs: [...(prior.logs || []), ...(result.logs || [])],
    error: result.error,
    resolvedAt: Date.now(),
    resolvedBy: result.resolvedBy,
    communicationOutcome: communicationOutcomeFromOutput(result.output) || prior.communicationOutcome
  };

  return {
    project: applyActionRun(project, node.id, run),
    log: [`${node.name}: ${result.status === 'success' ? 'callback received — completed' : `callback reported failure — ${result.error}`}`],
    nodeId: node.id
  };
};

/** Failed actions are not silently retried; retry is graph configuration. */
export const advanceProjectFlow = async (
  project: Project,
  executor: ActionExecutor,
  opts: { orgId?: string; webhookBaseUrl?: string; maxRounds?: number; checkpoint?: (project: Project) => Promise<void> } = {}
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

    for (const nodeId of asksToOpen) {
      const node = current.milestones.find(m => m.id === nodeId);
      if (!node) continue;
      const hold = getHoldConfig(node);
      const ask = getNodeType(node) === NodeType.WAIT && hold?.kind === 'human'
        ? createHumanHoldAsk(current, node)
        : createApprovalAsk(node, { projectId: current.id });
      current = { ...current, milestones: current.milestones.map(m => (m.id === nodeId ? upsertAsk(m, ask) : m)) };
      askedFor.push({ nodeId, ask });
      log.push(`${node.name}: awaiting human response from ${(ask.assignees || []).join(', ') || 'an unassigned reviewer'}`);
    }

    const runnable = actionsToRun.filter(id => {
      const run = current.milestones.find(m => m.id === id)?.actionConfig?.lastRun;
      return run?.status !== 'pending' && run?.status !== 'error';
    });

    if (runnable.length === 0) break;

    for (const nodeId of runnable) {
      // Persist routing, loop iteration and input state before an action can claim dispatch.
      await opts.checkpoint?.(current);
      const res = await runActionNode(current, nodeId, executor, opts);
      current = res.project;
      await opts.checkpoint?.(current);
      log.push(...res.log);
      if (res.run?.status === 'pending') pending.add(nodeId);
    }
  }

  if (log.length === 0) log.push('Flow is up to date — nothing to advance.');

  return { project: current, log, pending: [...pending], askedFor };
};

export const isAwaitingCallback = (m: Milestone): boolean =>
  isActionNode(m) && m.actionConfig?.lastRun?.status === 'pending';
