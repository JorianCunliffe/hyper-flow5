import { Milestone, Project, NodeType, ActionRun } from '../types.js';
import { checkReadyCondition } from './taskReadinessUtils.js';
import { isReviewSatisfied, needsApprovalAsk } from './humanAsk.js';
import { isTaskComplete } from './taskStatus.js';
import type { FlowHoldConfig, RuntimeMilestone } from './flowRuntimeTypes.js';

export type NodeResolution = 'pending' | 'complete' | 'skipped';

export { ACTION_NODE_TYPES, ACTION_TASK_TYPE, getNodeType, isActionNode } from './nodeTypes.js';
import { getNodeType, isActionNode } from './nodeTypes.js';

export const activeOccurrenceId = (projectData?: Record<string, any>): string | undefined => {
  const generic = projectData?.flow_occurrence_id;
  if (typeof generic === 'string' && generic) return generic;
  const scheduled = projectData?.schedule_occurrence_id;
  return typeof scheduled === 'string' && scheduled ? scheduled : undefined;
};

/** Generic hold config with legacy timer WAIT mapped into the same runtime shape. */
export const getHoldConfig = (m: Milestone): FlowHoldConfig | undefined => {
  const generic = (m as RuntimeMilestone).holdConfig;
  if (generic) return generic;
  if (!m.waitConfig) return undefined;
  return {
    kind: 'timer',
    durationMinutes: m.waitConfig.durationMinutes,
    reason: m.waitConfig.reason,
    holdId: m.waitConfig.holdId,
    armedAt: m.waitConfig.armedAt,
    availableAt: m.waitConfig.resumeAt,
    resolvedAt: m.waitConfig.resolvedAt,
    occurrenceId: m.waitConfig.occurrenceId
  };
};

const writeHoldConfig = (m: Milestone, cfg: FlowHoldConfig): Milestone => {
  if ((m as RuntimeMilestone).holdConfig || cfg.kind !== 'timer') {
    return { ...m, holdConfig: cfg } as RuntimeMilestone;
  }
  return {
    ...m,
    waitConfig: {
      ...m.waitConfig,
      kind: 'timer',
      durationMinutes: cfg.durationMinutes,
      reason: cfg.reason,
      holdId: cfg.holdId,
      armedAt: cfg.armedAt,
      resumeAt: cfg.availableAt,
      resolvedAt: cfg.resolvedAt,
      occurrenceId: cfg.occurrenceId
    }
  };
};

const waitMatchesOccurrence = (m: Milestone, projectData?: Record<string, any>): boolean => {
  const active = activeOccurrenceId(projectData);
  if (!active) return true;
  return getHoldConfig(m)?.occurrenceId === active;
};

const eventMatchesOccurrence = (m: Milestone, projectData?: Record<string, any>): boolean => {
  const active = activeOccurrenceId(projectData);
  if (!active) return !!m.eventTriggerConfig?.triggeredAt;
  return !!m.eventTriggerConfig?.triggeredAt && m.eventTriggerConfig?.occurrenceId === active;
};

export const isNodeWorkDone = (m: Milestone, projectData?: Record<string, any>): boolean => {
  switch (getNodeType(m)) {
    case NodeType.DECISION:
      return !!m.decisionConfig?.selectedTargetId;
    case NodeType.LOOP:
      return !!m.loopConfig?.exited;
    case NodeType.WAIT:
      return !!getHoldConfig(m)?.resolvedAt && waitMatchesOccurrence(m, projectData);
    case NodeType.EVENT_TRIGGER:
      return eventMatchesOccurrence(m, projectData);
    case NodeType.END:
      return !!m.completedAt;
    case NodeType.MILESTONE:
      return (m.subtasks || []).length > 0 && m.subtasks.every(isTaskComplete);
    default: {
      const run = m.actionConfig?.lastRun;
      if (run?.status === 'success') return true;
      return run?.status === 'error' && m.actionConfig?.failureMode === 'continue';
    }
  }
};

export const isNodeComplete = (m: Milestone, projectData?: Record<string, any>): boolean =>
  isNodeWorkDone(m, projectData) && isReviewSatisfied(m, projectData);

export const isAwaitingReview = (m: Milestone, projectData?: Record<string, any>): boolean =>
  isNodeWorkDone(m, projectData) && !isReviewSatisfied(m, projectData);

const getChildren = (milestones: Milestone[], id: string): Milestone[] =>
  milestones.filter(m => (m.dependsOn || []).includes(id));

export const resolveNodeStates = (project: Project): Map<string, NodeResolution> => {
  const milestones = project.milestones;
  const states = new Map<string, NodeResolution>();

  const resolve = (id: string, visiting: Set<string>): NodeResolution => {
    const cached = states.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return 'pending';
    visiting.add(id);

    const m = milestones.find(mil => mil.id === id);
    if (!m) return 'pending';

    const parents = (m.dependsOn || [])
      .map(pid => milestones.find(mil => mil.id === pid))
      .filter(Boolean) as Milestone[];

    let skipped = false;
    if (parents.length > 0) {
      skipped = parents.every(p => resolve(p.id, visiting) === 'skipped');
      for (const p of parents) {
        if (
          getNodeType(p) === NodeType.DECISION &&
          p.decisionConfig?.selectedTargetId &&
          p.decisionConfig.selectedTargetId !== id &&
          resolve(p.id, visiting) !== 'skipped'
        ) {
          skipped = true;
        }
      }
    }

    const state: NodeResolution = skipped ? 'skipped' : isNodeComplete(m, project.projectData) ? 'complete' : 'pending';
    states.set(id, state);
    return state;
  };

  milestones.forEach(m => resolve(m.id, new Set()));
  return states;
};

export const isNodeReady = (m: Milestone, states: Map<string, NodeResolution>): boolean => {
  const own = states.get(m.id);
  if (own === 'complete' || own === 'skipped') return false;
  const parents = m.dependsOn || [];
  if (parents.length === 0) return true;
  const parentStates = parents.map(pid => states.get(pid) || 'pending');
  return parentStates.every(s => s !== 'pending') && parentStates.some(s => s === 'complete');
};

export const getLoopBody = (project: Project, loopNode: Milestone): string[] => {
  const startId = loopNode.loopConfig?.loopStartId;
  if (!startId) return [];
  const milestones = project.milestones;

  const forward = new Set<string>();
  const walkForward = (id: string) => {
    if (forward.has(id)) return;
    forward.add(id);
    getChildren(milestones, id).forEach(c => walkForward(c.id));
  };
  walkForward(startId);

  const backward = new Set<string>();
  const walkBackward = (id: string) => {
    if (backward.has(id)) return;
    backward.add(id);
    const m = milestones.find(mil => mil.id === id);
    (m?.dependsOn || []).forEach(pid => walkBackward(pid));
  };
  walkBackward(loopNode.id);

  return milestones
    .filter(m => m.id !== loopNode.id && forward.has(m.id) && backward.has(m.id))
    .map(m => m.id);
};

const resetNodeForIteration = (m: Milestone): Milestone => {
  let reset: Milestone = {
    ...m,
    completedAt: undefined,
    subtasks: (m.subtasks || []).map(s => ({
      ...s,
      status: 'Not started',
      completedAt: undefined,
      approvalStatus: undefined
    })),
    asks: (m.asks || []).map(a => (a.status === 'open' || a.status === 'answered' ? { ...a, status: 'cancelled' as const } : a))
  };
  if (m.decisionConfig) {
    reset.decisionConfig = { ...m.decisionConfig, selectedTargetId: undefined, decidedAt: undefined };
  }
  const hold = getHoldConfig(m);
  if (hold) {
    reset = writeHoldConfig(reset, {
      ...hold,
      availableAt: undefined,
      armedAt: undefined,
      resolvedAt: undefined,
      holdId: undefined,
      occurrenceId: undefined,
      resolution: undefined,
      resolvedBy: undefined,
      signalId: undefined
    });
  }
  if (m.eventTriggerConfig) {
    reset.eventTriggerConfig = {
      ...m.eventTriggerConfig,
      lastEventId: undefined,
      triggeredAt: undefined,
      occurrenceId: undefined
    };
  }
  if (m.actionConfig?.lastRun) {
    reset.actionConfig = {
      ...m.actionConfig,
      lastRun: undefined,
      runHistory: [...(m.actionConfig.runHistory || []), m.actionConfig.lastRun]
    };
  }
  return reset;
};

export interface AdvanceResult {
  project: Project;
  actionsToRun: string[];
  asksToOpen: string[];
  log: string[];
}

const boundedMinutes = (value: unknown, fallback = 5): number => {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return fallback;
  return Math.min(Math.max(requested, 1), 24 * 60);
};

const validVariable = (value: unknown): string | undefined => {
  const key = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : undefined;
};

const applyHoldResult = (
  data: Record<string, any>,
  cfg: FlowHoldConfig,
  resolution: 'timer' | 'timeout'
): Record<string, any> => {
  const key = validVariable(cfg.resultVariable);
  if (!key) return data;
  return {
    ...data,
    [key]: resolution,
    [`${key}_resolved`]: true,
    [`${key}_resolution`]: resolution
  };
};

const humanWaitNeedsAsk = (m: Milestone): boolean => {
  const cfg = getHoldConfig(m);
  if (getNodeType(m) !== NodeType.WAIT || cfg?.kind !== 'human' || !cfg.holdId || cfg.resolvedAt) return false;
  return !(m.asks || []).some(ask => ask.status === 'open' || ask.status === 'answered');
};

/**
 * Pure graph advance. EVENT_TRIGGER nodes start occurrences. WAIT is the generic
 * durable hold primitive: timer waits resolve by time, other waits resolve only
 * from a matching external signal or their configured timeout.
 */
export const advanceFlow = (project: Project): AdvanceResult => {
  let current = project;
  const log: string[] = [];

  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    const states = resolveNodeStates(current);
    const projectData = current.projectData || {};

    for (const m of current.milestones) {
      const type = getNodeType(m);

      if (type === NodeType.DECISION && !m.decisionConfig?.selectedTargetId && isNodeReady(m, states)) {
        const branches = m.decisionConfig?.branches || [];
        const match =
          branches.find(b => (b.conditions || []).length > 0 && b.conditions!.every(c => checkReadyCondition(c, projectData))) ||
          branches.find(b => !(b.conditions || []).length);
        if (match) {
          log.push(`Decision "${m.name}": selected branch "${match.label}"`);
          current = {
            ...current,
            milestones: current.milestones.map(mil =>
              mil.id === m.id
                ? { ...mil, decisionConfig: { ...mil.decisionConfig!, selectedTargetId: match.targetId, decidedAt: Date.now() } }
                : mil
            )
          };
          changed = true;
        }
      }

      if (type === NodeType.LOOP && !m.loopConfig?.exited && isNodeReady(m, states)) {
        const cfg = m.loopConfig!;
        const exitMet = cfg.exitConditions.length > 0 && cfg.exitConditions.every(c => checkReadyCondition(c, projectData));
        const maxed = cfg.currentIteration >= cfg.maxIterations;
        if (exitMet || maxed) {
          log.push(`Loop "${m.name}": exited (${exitMet ? 'condition met' : 'max iterations reached'})`);
          current = {
            ...current,
            milestones: current.milestones.map(mil =>
              mil.id === m.id ? { ...mil, loopConfig: { ...cfg, exited: true } } : mil
            )
          };
        } else {
          const bodyIds = new Set(getLoopBody(current, m));
          log.push(`Loop "${m.name}": iteration ${cfg.currentIteration + 1} of ${cfg.maxIterations} — resetting ${bodyIds.size} node(s)`);
          current = {
            ...current,
            milestones: current.milestones.map(mil => {
              if (mil.id === m.id) return { ...mil, loopConfig: { ...cfg, currentIteration: cfg.currentIteration + 1 } };
              return bodyIds.has(mil.id) ? resetNodeForIteration(mil) : mil;
            })
          };
        }
        changed = true;
      }

      if (type === NodeType.WAIT && isNodeReady(m, states)) {
        const now = Date.now();
        const occurrenceId = activeOccurrenceId(projectData);
        const existing = getHoldConfig(m) || { kind: 'timer' as const };
        const sameOccurrence = !occurrenceId || existing.occurrenceId === occurrenceId;
        const availableAt = sameOccurrence ? Number(existing.availableAt || 0) : 0;

        if (availableAt > 0 && availableAt <= now) {
          const resolution = existing.kind === 'timer' ? 'timer' as const : 'timeout' as const;
          const resolved = { ...existing, occurrenceId, resolvedAt: now, resolution, resolvedBy: 'scheduler/time' };
          current = {
            ...current,
            projectData: applyHoldResult(current.projectData || {}, resolved, resolution),
            milestones: current.milestones.map(mil => mil.id === m.id ? writeHoldConfig(mil, resolved) : mil)
          };
          log.push(`Wait "${m.name}": ${resolution === 'timer' ? 'timer completed' : 'timed out'}`);
          changed = true;
        } else if (!existing.armedAt || !sameOccurrence) {
          const delay = existing.kind === 'timer'
            ? boundedMinutes(existing.durationMinutes)
            : existing.timeoutMinutes ? boundedMinutes(existing.timeoutMinutes) : undefined;
          const holdId = `hold_${current.projectData?.flow_run_id || current.id}_${m.id}_${occurrenceId || now}`
            .replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 220);
          const armed: FlowHoldConfig = {
            ...existing,
            ...(existing.kind === 'timer' ? { durationMinutes: delay } : {}),
            holdId,
            armedAt: now,
            availableAt: delay ? now + delay * 60_000 : undefined,
            resolvedAt: undefined,
            occurrenceId,
            resolution: undefined,
            resolvedBy: undefined,
            signalId: undefined
          };
          current = {
            ...current,
            milestones: current.milestones.map(mil => mil.id === m.id ? writeHoldConfig(mil, armed) : mil)
          };
          log.push(`Wait "${m.name}": holding for ${armed.kind}${delay ? ` (timeout ${delay} minute(s))` : ''}`);
          changed = true;
        }
      }

      if (type === NodeType.END && !m.completedAt && isNodeReady(m, states)) {
        current = {
          ...current,
          milestones: current.milestones.map(mil => mil.id === m.id ? { ...mil, completedAt: Date.now() } : mil)
        };
        log.push(`End "${m.name}": branch terminated`);
        changed = true;
      }
    }

    if (!changed) break;
  }

  const finalStates = resolveNodeStates(current);
  const actionsToRun = current.milestones
    .filter(m => {
      if (!isActionNode(m) || !m.actionConfig?.autoExecute || !isNodeReady(m, finalStates)) return false;
      if (isNodeWorkDone(m, current.projectData)) return false;
      const status = m.actionConfig?.lastRun?.status;
      return status !== 'pending' && status !== 'error';
    })
    .map(m => m.id);

  const asksToOpen = current.milestones
    .filter(m =>
      (finalStates.get(m.id) !== 'skipped' && isNodeWorkDone(m, current.projectData) && needsApprovalAsk(m, current.projectData)) ||
      humanWaitNeedsAsk(m)
    )
    .map(m => m.id);

  return { project: current, actionsToRun, asksToOpen, log };
};
