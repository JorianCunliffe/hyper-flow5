import { getApps } from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';
import type { Project } from '../types.js';
import { findProject, readSchedulerHealth, writeProject } from './serverStore.js';

export interface FlowHold {
  id: string;
  orgId: string;
  projectId: string;
  nodeId: string;
  kind: 'timer';
  status: 'waiting' | 'processing' | 'resolved' | 'cancelled';
  availableAt: number;
  occurrenceId?: string;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  leaseExpiresAt?: number;
  attemptCount?: number;
  error?: string;
}

const safeKey = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');
const indexKey = (hold: Pick<FlowHold, 'orgId' | 'projectId' | 'id'>): string =>
  safeKey(`${hold.orgId}:${hold.projectId}:${hold.id}`);

/**
 * serverStore owns Firebase initialization. Calling this tiny read first keeps
 * credentials and tenant lifecycle settings in one place instead of duplicating
 * service-account parsing in the hold adapter.
 */
const runtimeDb = async (): Promise<Database> => {
  await readSchedulerHealth();
  const app = getApps().find(candidate => candidate.name === 'hyperflow-server');
  if (!app) throw new Error('HyperFlow runtime database is unavailable');
  return getDatabase(app);
};

const holdPath = (hold: Pick<FlowHold, 'orgId' | 'id'>): string =>
  `flow_holds/${safeKey(hold.orgId)}/${safeKey(hold.id)}`;

const pendingPath = (hold: Pick<FlowHold, 'orgId' | 'projectId' | 'id'>): string =>
  `flow_hold_pending/${indexKey(hold)}`;

/** Persist every armed WAIT node as a sparse scheduler index. Idempotent. */
export const syncTimerHoldsFromProject = async (orgId: string, project: Project): Promise<void> => {
  const db = await runtimeDb();
  const updates: Record<string, unknown> = {};
  const now = Date.now();

  for (const node of project.milestones) {
    if (node.nodeType !== 'wait' || !node.waitConfig?.holdId) continue;
    const cfg = node.waitConfig;
    const hold: FlowHold = {
      id: cfg.holdId,
      orgId,
      projectId: project.id,
      nodeId: node.id,
      kind: 'timer',
      status: cfg.resolvedAt ? 'resolved' : 'waiting',
      availableAt: Number(cfg.resumeAt || now),
      occurrenceId: cfg.occurrenceId,
      reason: cfg.reason,
      createdAt: Number(cfg.armedAt || now),
      updatedAt: now
    };
    updates[holdPath(hold)] = hold;
    updates[pendingPath(hold)] = cfg.resolvedAt ? null : {
      orgId, projectId: project.id, holdId: hold.id,
      availableAt: hold.availableAt, createdAt: hold.createdAt
    };
  }

  if (Object.keys(updates).length) await db.ref().update(updates);
};

export const claimDueFlowHolds = async (now = Date.now(), limit = 10): Promise<FlowHold[]> => {
  const db = await runtimeDb();
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
      id: String(candidate.holdId || '')
    };
    if (!stub.orgId || !stub.projectId || !stub.id) continue;
    const reference = db.ref(holdPath(stub));
    const result = await reference.transaction(current => {
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
    if (result.committed) {
      const hold = result.snapshot.val() as FlowHold;
      claimed.push(hold);
      await db.ref(pendingPath(hold)).set({
        orgId: hold.orgId, projectId: hold.projectId, holdId: hold.id,
        availableAt: hold.leaseExpiresAt, createdAt: hold.createdAt
      });
    }
  }
  return claimed;
};

export const finishFlowHold = async (hold: FlowHold, status: 'resolved' | 'cancelled', error?: string): Promise<void> => {
  const db = await runtimeDb();
  const now = Date.now();
  await db.ref(holdPath(hold)).transaction(current => {
    if (!current) return undefined;
    if (current.status === 'processing' && hold.claimedAt && current.claimedAt !== hold.claimedAt) return undefined;
    return {
      ...current,
      status,
      updatedAt: now,
      leaseExpiresAt: null,
      ...(error ? { error: String(error).slice(0, 1000) } : {})
    };
  });
  await db.ref(pendingPath(hold)).remove();
};

export const releaseFlowHold = async (hold: FlowHold, error: string): Promise<void> => {
  const db = await runtimeDb();
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
    await db.ref(pendingPath(saved)).set({
      orgId: saved.orgId, projectId: saved.projectId, holdId: saved.id,
      availableAt: saved.availableAt, createdAt: saved.createdAt
    });
  }
};

/**
 * Resolve a claimed timer hold against the exact node/occurrence that armed it,
 * then re-enter normal server-side orchestration. Stale timers are cancelled.
 */
export const resumeClaimedFlowHold = async (hold: FlowHold): Promise<{ ok: boolean; reason?: string }> => {
  const located = await findProject(hold.orgId, hold.projectId);
  if (!located || located.project.isArchived) {
    await finishFlowHold(hold, 'cancelled', 'project_not_available');
    return { ok: true, reason: 'stale_flow_hold' };
  }

  const activeOccurrence = typeof located.project.projectData?.schedule_occurrence_id === 'string'
    ? located.project.projectData.schedule_occurrence_id : undefined;
  if (hold.occurrenceId && activeOccurrence !== hold.occurrenceId) {
    await finishFlowHold(hold, 'cancelled', 'occurrence_changed');
    return { ok: true, reason: 'stale_flow_hold' };
  }

  const node = located.project.milestones.find(item => item.id === hold.nodeId);
  if (!node?.waitConfig || node.waitConfig.holdId !== hold.id || node.waitConfig.resolvedAt) {
    await finishFlowHold(hold, 'cancelled', 'wait_no_longer_active');
    return { ok: true, reason: 'stale_flow_hold' };
  }

  const resolvedAt = Date.now();
  const project: Project = {
    ...located.project,
    milestones: located.project.milestones.map(item => item.id === hold.nodeId ? {
      ...item,
      waitConfig: { ...item.waitConfig!, resolvedAt }
    } : item)
  };
  await writeProject(hold.orgId, located.index, project);
  await finishFlowHold(hold, 'resolved');

  const { advanceServerFlow } = await import('./serverFlow.js');
  return advanceServerFlow(hold.orgId, hold.projectId);
};
