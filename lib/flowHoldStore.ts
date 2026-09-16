import type { HumanAsk, Milestone, Project } from '../types.js';
import { runtimeDatabase } from './runtimeDatabase.js';
import type { FlowHold, FlowHoldConfig, FlowRun, FlowSignal, RuntimeMilestone } from './flowRuntimeTypes.js';

const safeKey = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');
const indexKey = (hold: Pick<FlowHold, 'orgId' | 'projectId' | 'flowRunId' | 'id'>): string =>
  safeKey(`${hold.orgId}:${hold.projectId}:${hold.flowRunId}:${hold.id}`);
const holdPath = (hold: Pick<FlowHold, 'orgId' | 'projectId' | 'flowRunId' | 'id'>): string =>
  `flow_holds/${safeKey(hold.orgId)}/${safeKey(hold.projectId)}/${safeKey(hold.flowRunId)}/${safeKey(hold.id)}`;
const runHoldRoot = (run: Pick<FlowRun, 'orgId' | 'projectId' | 'id'>): string =>
  `flow_holds/${safeKey(run.orgId)}/${safeKey(run.projectId)}/${safeKey(run.id)}`;
const openPath = (hold: Pick<FlowHold, 'orgId' | 'projectId' | 'id'>): string =>
  `flow_hold_open/${safeKey(hold.orgId)}/${safeKey(hold.projectId)}/${safeKey(hold.id)}`;
const pendingPath = (hold: Pick<FlowHold, 'orgId' | 'projectId' | 'flowRunId' | 'id'>): string =>
  `flow_hold_pending/${indexKey(hold)}`;

const arr = <T>(value: unknown): T[] =>
  Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value as Record<string, T>) : [];

export const runtimeHoldConfig = (node: Milestone): FlowHoldConfig | undefined => {
  const generic = (node as RuntimeMilestone).holdConfig;
  if (generic) return generic;
  if (!node.waitConfig) return undefined;
  return {
    kind: 'timer',
    durationMinutes: node.waitConfig.durationMinutes,
    reason: node.waitConfig.reason,
    holdId: node.waitConfig.holdId,
    armedAt: node.waitConfig.armedAt,
    availableAt: node.waitConfig.resumeAt,
    resolvedAt: node.waitConfig.resolvedAt,
    occurrenceId: node.waitConfig.occurrenceId
  };
};

const latestRelevantAsk = (node: Milestone): HumanAsk | undefined => {
  const asks = arr<HumanAsk>(node.asks);
  for (let index = asks.length - 1; index >= 0; index--) {
    if (asks[index].status !== 'cancelled') return asks[index];
  }
  return undefined;
};

const waitHold = (run: FlowRun, project: Project, node: Milestone, now: number): FlowHold | null => {
  const cfg = runtimeHoldConfig(node);
  if (!cfg?.holdId || !cfg.armedAt) return null;
  const ask = cfg.kind === 'human' ? latestRelevantAsk(node) : undefined;
  return {
    id: cfg.holdId,
    orgId: run.orgId,
    projectId: run.projectId,
    flowRunId: run.id,
    nodeId: node.id,
    source: 'wait',
    kind: cfg.kind,
    status: cfg.resolvedAt ? 'resolved' : 'waiting',
    occurrenceId: cfg.occurrenceId || run.occurrenceId,
    reason: cfg.reason,
    resultVariable: cfg.resultVariable,
    payloadVariable: cfg.payloadVariable,
    match: cfg.match,
    askId: ask?.id,
    askToken: ask?.token,
    availableAt: cfg.availableAt,
    resolution: cfg.resolution,
    createdAt: cfg.armedAt,
    updatedAt: now
  };
};

const actionHold = (run: FlowRun, node: Milestone, now: number): FlowHold | null => {
  const action = node.actionConfig?.lastRun;
  if (!action?.id || !action.startedAt) return null;
  const id = `hold_action_${run.id}_${node.id}_${action.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 220);
  return {
    id,
    orgId: run.orgId,
    projectId: run.projectId,
    flowRunId: run.id,
    nodeId: node.id,
    source: 'action',
    kind: 'provider',
    status: action.status === 'pending' ? 'waiting' : 'resolved',
    occurrenceId: run.occurrenceId,
    reason: 'Awaiting asynchronous action provider result',
    match: {
      providerServices: action.externalService ? [action.externalService] : undefined,
      actionRunIds: [action.id],
      externalIds: [action.externalExecutionId || action.externalId].filter(Boolean) as string[]
    },
    actionRunId: action.id,
    externalId: action.externalExecutionId || action.externalId,
    providerService: action.externalService,
    resolution: action.status === 'pending' ? undefined : 'signal',
    createdAt: action.startedAt,
    updatedAt: now
  };
};

const reviewHolds = (run: FlowRun, node: Milestone, now: number): FlowHold[] => {
  const cfg = runtimeHoldConfig(node);
  const explicitHumanWait = cfg?.kind === 'human';
  return arr<HumanAsk>(node.asks)
    .filter(ask => !explicitHumanWait && ask.status !== 'cancelled')
    .map(ask => ({
      id: `hold_ask_${run.id}_${ask.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 220),
      orgId: run.orgId,
      projectId: run.projectId,
      flowRunId: run.id,
      nodeId: node.id,
      source: 'review' as const,
      kind: 'human' as const,
      status: ask.status === 'open' ? 'waiting' as const : 'resolved' as const,
      occurrenceId: run.occurrenceId,
      reason: 'Awaiting human response',
      match: { askIds: [ask.id] },
      askId: ask.id,
      askToken: ask.token,
      resolution: ask.status === 'open' ? undefined : 'signal' as const,
      createdAt: ask.createdAt,
      updatedAt: now
    }));
};

/**
 * Reconciles all durable waits for one FlowRun. This includes explicit WAIT
 * nodes plus implicit provider/human waits created by action and review nodes.
 */
export const syncFlowHoldsFromRun = async (run: FlowRun, project: Project): Promise<void> => {
  const db = await runtimeDatabase();
  const now = Date.now();
  const desired = new Map<string, FlowHold>();
  for (const node of project.milestones) {
    const wait = waitHold(run, project, node, now);
    if (wait) desired.set(wait.id, wait);
    const action = actionHold(run, node, now);
    if (action) desired.set(action.id, action);
    for (const review of reviewHolds(run, node, now)) desired.set(review.id, review);
  }

  const existingSnapshot = await db.ref(runHoldRoot(run)).get();
  const existing = Object.values<any>(existingSnapshot.val() || {});
  const updates: Record<string, unknown> = {};

  for (const prior of existing) {
    if (desired.has(String(prior.id))) continue;
    const cancelled: FlowHold = {
      ...prior,
      status: prior.status === 'resolved' ? 'resolved' : 'cancelled',
      resolution: prior.resolution || (prior.status === 'resolved' ? 'signal' : 'cancelled'),
      updatedAt: now
    };
    updates[holdPath(cancelled)] = cancelled;
    updates[openPath(cancelled)] = null;
    updates[pendingPath(cancelled)] = null;
  }

  for (const hold of desired.values()) {
    updates[holdPath(hold)] = hold;
    if (hold.status === 'waiting') {
      updates[openPath(hold)] = {
        orgId: hold.orgId,
        projectId: hold.projectId,
        flowRunId: hold.flowRunId,
        holdId: hold.id,
        kind: hold.kind,
        updatedAt: hold.updatedAt
      };
      updates[pendingPath(hold)] = hold.availableAt ? {
        orgId: hold.orgId,
        projectId: hold.projectId,
        flowRunId: hold.flowRunId,
        holdId: hold.id,
        availableAt: hold.availableAt,
        createdAt: hold.createdAt
      } : null;
    } else {
      updates[openPath(hold)] = null;
      updates[pendingPath(hold)] = null;
    }
  }

  if (Object.keys(updates).length) await db.ref().update(updates);
};

const listMatches = (allowed: string[] | undefined, value: string | undefined): boolean =>
  !allowed?.length || allowed.includes('*') || (!!value && allowed.includes(value));

export const holdMatchesSignal = (hold: FlowHold, signal: FlowSignal): boolean => {
  if (hold.status !== 'waiting') return false;
  if (hold.kind !== signal.kind) return false;
  const match = hold.match || {};
  if (signal.kind === 'event') {
    return listMatches(match.eventTypes, signal.eventType) &&
      listMatches(match.channels, signal.channel) &&
      listMatches(match.directions, signal.direction) &&
      listMatches(match.personIds, signal.personId);
  }
  if (signal.kind === 'human') {
    return (!match.askIds?.length || (!!signal.askId && match.askIds.includes(signal.askId))) &&
      (!hold.askToken || !signal.askToken || hold.askToken === signal.askToken);
  }
  return listMatches(match.providerServices, signal.providerService) &&
    (!match.actionRunIds?.length || (!!signal.actionRunId && match.actionRunIds.includes(signal.actionRunId))) &&
    (!match.externalIds?.length || (!!signal.externalId && match.externalIds.includes(signal.externalId)));
};

export const listMatchingFlowHolds = async (
  orgId: string,
  projectId: string,
  signal: FlowSignal
): Promise<FlowHold[]> => {
  const db = await runtimeDatabase();
  const open = await db.ref(`flow_hold_open/${safeKey(orgId)}/${safeKey(projectId)}`).get();
  const stubs = Object.values<any>(open.val() || {});
  const holds: FlowHold[] = [];
  for (const stub of stubs.slice(0, 250)) {
    if (stub.kind !== signal.kind || !stub.flowRunId || !stub.holdId) continue;
    const snap = await db.ref(holdPath({ orgId, projectId, flowRunId: String(stub.flowRunId), id: String(stub.holdId) })).get();
    if (!snap.exists()) continue;
    const hold = snap.val() as FlowHold;
    if (holdMatchesSignal(hold, signal)) holds.push(hold);
  }
  return holds;
};

export const claimDueFlowHolds = async (now = Date.now(), limit = 10): Promise<FlowHold[]> => {
  const db = await runtimeDatabase();
  const max = Math.min(Math.max(limit, 1), 25);
  const snapshot = await db.ref('flow_hold_pending')
    .orderByChild('availableAt').endAt(now).limitToFirst(max * 3).get();
  if (!snapshot.exists()) return [];

  const candidates = Object.values<any>(snapshot.val() || {})
    .filter(candidate => Number(candidate.availableAt || 0) <= now)
    .sort((a, b) => Number(a.availableAt || 0) - Number(b.availableAt || 0))
    .slice(0, max);
  const claimed: FlowHold[] = [];

  for (const candidate of candidates) {
    const stub = {
      orgId: String(candidate.orgId || ''),
      projectId: String(candidate.projectId || ''),
      flowRunId: String(candidate.flowRunId || ''),
      id: String(candidate.holdId || '')
    };
    if (!stub.orgId || !stub.projectId || !stub.flowRunId || !stub.id) continue;
    // The global queue contains metadata for suspended tenants too. Do not let
    // one paused tenant prevent the scheduler from serving every active tenant.
    const tenantActive = async () => {
      const state = await db.ref(`tenant_lifecycle/${safeKey(stub.orgId)}/state`).get();
      return !state.exists() || state.val() === 'active';
    };
    if (!await tenantActive()) continue;
    const reference = db.ref(holdPath(stub));
    const keepCurrent = () => {};
    let result;
    try {
      // Cold Admin SDK transactions may first see null. Keep an authoritative
      // value listener until the claim completes instead of aborting that claim.
      await new Promise<void>((resolve, reject) => {
        reference.on('value', keepCurrent, reject);
        reference.once('value', () => resolve(), reject);
      });
      result = await reference.transaction(current => {
        if (!current) return undefined;
        const due = current.status === 'waiting' && Number(current.availableAt || 0) <= now;
        const stale = current.status === 'processing' && Number(current.leaseExpiresAt || 0) <= now;
        if (!due && !stale) return undefined;
        return {
          ...current,
          status: 'processing',
          claimedAt: now,
          leaseExpiresAt: now + 2 * 60_000,
          attemptCount: Number(current.attemptCount || 0) + 1,
          updatedAt: now,
          error: null
        };
      });
    } catch (error) {
      if (!await tenantActive()) continue;
      throw error;
    } finally {
      reference.off('value', keepCurrent);
    }
    if (result.committed) {
      const hold = result.snapshot.val() as FlowHold;
      claimed.push(hold);
      await db.ref(pendingPath(hold)).set({
        orgId: hold.orgId,
        projectId: hold.projectId,
        flowRunId: hold.flowRunId,
        holdId: hold.id,
        availableAt: hold.leaseExpiresAt,
        createdAt: hold.createdAt
      });
    }
  }
  return claimed;
};

export const finishFlowHold = async (
  hold: FlowHold,
  status: 'resolved' | 'cancelled',
  error?: string,
  resolution?: FlowHold['resolution']
): Promise<void> => {
  const db = await runtimeDatabase();
  const now = Date.now();
  await db.ref(holdPath(hold)).transaction(current => {
    if (!current) return undefined;
    if (current.status === 'processing' && hold.claimedAt && current.claimedAt !== hold.claimedAt) return undefined;
    return {
      ...current,
      status,
      resolution: resolution || current.resolution || (status === 'cancelled' ? 'cancelled' : 'signal'),
      updatedAt: now,
      leaseExpiresAt: null,
      ...(error ? { error: String(error).slice(0, 1000) } : {})
    };
  });
  await db.ref(openPath(hold)).remove();
  await db.ref(pendingPath(hold)).remove();
};

export const releaseFlowHold = async (hold: FlowHold, error: string): Promise<void> => {
  const db = await runtimeDatabase();
  const now = Date.now();
  const result = await db.ref(holdPath(hold)).transaction(current => {
    if (!current || current.status !== 'processing' || current.claimedAt !== hold.claimedAt) return undefined;
    return {
      ...current,
      status: 'waiting',
      availableAt: now + 60_000,
      leaseExpiresAt: null,
      updatedAt: now,
      error: String(error).slice(0, 1000)
    };
  });
  if (result.committed) {
    const saved = result.snapshot.val() as FlowHold;
    await db.ref(openPath(saved)).set({
      orgId: saved.orgId, projectId: saved.projectId, flowRunId: saved.flowRunId,
      holdId: saved.id, kind: saved.kind, updatedAt: saved.updatedAt
    });
    await db.ref(pendingPath(saved)).set({
      orgId: saved.orgId, projectId: saved.projectId, flowRunId: saved.flowRunId,
      holdId: saved.id, availableAt: saved.availableAt, createdAt: saved.createdAt
    });
  }
};

/** Scheduler entry point for timer waits and timeouts on signal waits. */
export const resumeClaimedFlowHold = async (hold: FlowHold): Promise<{ ok: boolean; reason?: string }> => {
  const { resumeFlowRunFromHold } = await import('./serverFlow.js');
  try {
    return await resumeFlowRunFromHold(hold, hold.kind === 'timer' ? 'timer' : 'timeout');
  } catch (error: any) {
    await releaseFlowHold(hold, error?.message || String(error));
    return { ok: false, reason: error?.message || String(error) };
  }
};
