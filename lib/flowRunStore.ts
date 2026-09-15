import type { HumanAsk, Milestone } from '../types.js';
import { normalizeNodeAsks } from './humanAsk.js';
import { runtimeDatabase } from './runtimeDatabase.js';
import type { FlowRun, NodeRun } from './flowRuntimeTypes.js';

const safeKey = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');
const runPath = (orgId: string, projectId: string, runId: string): string =>
  `flow_runs/${safeKey(orgId)}/${safeKey(projectId)}/${safeKey(runId)}`;

const arr = <T>(value: unknown): T[] =>
  Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value as Record<string, T>) : [];

const normalizeMilestone = (value: any): Milestone => ({
  ...normalizeNodeAsks(value),
  dependsOn: arr<string>(value?.dependsOn),
  subtasks: arr<any>(value?.subtasks),
  ...(value?.actionConfig?.runHistory ? {
    actionConfig: { ...value.actionConfig, runHistory: arr<any>(value.actionConfig.runHistory) }
  } : {})
});

const normalizeNodeRuns = (value: unknown): Record<string, NodeRun[]> => {
  const result: Record<string, NodeRun[]> = {};
  if (!value || typeof value !== 'object') return result;
  for (const [nodeId, rows] of Object.entries(value as Record<string, unknown>)) result[nodeId] = arr<NodeRun>(rows);
  return result;
};

export const normalizeFlowRun = (value: any): FlowRun => ({
  ...value,
  revision: Number(value?.revision || 0),
  state: {
    milestones: arr<any>(value?.state?.milestones).map(normalizeMilestone),
    projectData: value?.state?.projectData && typeof value.state.projectData === 'object' ? value.state.projectData : {}
  },
  nodeRuns: normalizeNodeRuns(value?.nodeRuns)
});

export const readFlowRun = async (orgId: string, projectId: string, runId: string): Promise<FlowRun | null> => {
  const db = await runtimeDatabase();
  const snapshot = await db.ref(runPath(orgId, projectId, runId)).get();
  return snapshot.exists() ? normalizeFlowRun(snapshot.val()) : null;
};

/** Idempotent creation for deterministic schedule/event occurrence ids. */
export const createFlowRunIfAbsent = async (run: FlowRun): Promise<FlowRun> => {
  const db = await runtimeDatabase();
  const reference = db.ref(runPath(run.orgId, run.projectId, run.id));
  const result = await reference.transaction(current => current || JSON.parse(JSON.stringify(run)), undefined, false);
  if (!result.committed || !result.snapshot.exists()) throw new Error('FlowRun creation was not committed');
  return normalizeFlowRun(result.snapshot.val());
};

/**
 * Compare-and-swap persistence. Runtime effects happen before this write, so a
 * stale worker must fail rather than overwrite a newer callback/signal result.
 */
export const saveFlowRun = async (run: FlowRun): Promise<FlowRun> => {
  const db = await runtimeDatabase();
  const reference = db.ref(runPath(run.orgId, run.projectId, run.id));
  let stale = false;
  const expected = Number(run.revision || 0);
  const nextRevision = expected + 1;
  const result = await reference.transaction(current => {
    if (!current) {
      if (expected !== 0) { stale = true; return undefined; }
      return { ...run, revision: nextRevision };
    }
    const currentRevision = Number(current.revision || 0);
    if (currentRevision !== expected) { stale = true; return undefined; }
    return { ...run, revision: nextRevision };
  }, undefined, false);
  if (!result.committed || stale) throw new Error('FlowRun changed concurrently; refusing stale write');
  return normalizeFlowRun(result.snapshot.val());
};

export const listFlowRuns = async (orgId: string, projectId: string, limit = 50): Promise<FlowRun[]> => {
  const db = await runtimeDatabase();
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const snapshot = await db.ref(`flow_runs/${safeKey(orgId)}/${safeKey(projectId)}`)
    .orderByChild('updatedAt').limitToLast(max).get();
  return Object.values(snapshot.val() || {})
    .map(normalizeFlowRun)
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export const findLatestActiveFlowRun = async (orgId: string, projectId: string): Promise<FlowRun | null> => {
  const runs = await listFlowRuns(orgId, projectId, 50);
  return runs.find(run => run.status === 'running' || run.status === 'waiting') || null;
};

export const findFlowRunByAction = async (
  orgId: string,
  projectId: string,
  match: { nodeId?: string; runId?: string; externalId?: string }
): Promise<FlowRun | null> => {
  if (!match.nodeId && !match.runId && !match.externalId) return null;
  const runs = await listFlowRuns(orgId, projectId, 100);
  return runs.find(run => run.state.milestones.some(node => {
    const action = node.actionConfig?.lastRun;
    if (!action) return false;
    if (match.nodeId && node.id !== match.nodeId) return false;
    if (match.runId && action.id !== match.runId) return false;
    if (match.externalId && action.externalId !== match.externalId && action.externalExecutionId !== match.externalId) return false;
    return true;
  })) || null;
};

const askMatches = (ask: HumanAsk, askId?: string, askToken?: string): boolean =>
  (!!askId && ask.id === askId) || (!!askToken && ask.token === askToken) ||
  (ask.deliveries || []).some(delivery => delivery.deliveryAskId === askId || delivery.deliveryToken === askToken);

export const findFlowRunByAsk = async (
  orgId: string,
  projectId: string,
  askId?: string,
  askToken?: string
): Promise<{ run: FlowRun; node: Milestone; ask: HumanAsk } | null> => {
  if (!askId && !askToken) return null;
  const runs = await listFlowRuns(orgId, projectId, 100);
  for (const run of runs) {
    for (const node of run.state.milestones) {
      const ask = (node.asks || []).find(item => askMatches(item, askId, askToken));
      if (ask) return { run, node, ask };
    }
  }
  return null;
};
