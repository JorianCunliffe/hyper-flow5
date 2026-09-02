import { Milestone, Project, NodeType, ActionRun } from '../types.js';
import { checkReadyCondition } from './taskReadinessUtils.js';
import { isReviewSatisfied, needsApprovalAsk } from './humanAsk.js';
import { isTaskComplete } from './taskStatus.js';

export type NodeResolution = 'pending' | 'complete' | 'skipped';

export { ACTION_NODE_TYPES, ACTION_TASK_TYPE, getNodeType, isActionNode } from './nodeTypes.js';
import { getNodeType, isActionNode } from './nodeTypes.js';

/**
 * A node's work, ignoring dependencies and any review gate:
 * - milestone: has subtasks and all are complete
 * - decision: a branch has been selected
 * - loop: exit condition met (exited)
 * - action: last run succeeded
 */
export const isNodeWorkDone = (m: Milestone): boolean => {
  switch (getNodeType(m)) {
    case NodeType.DECISION:
      return !!m.decisionConfig?.selectedTargetId;
    case NodeType.LOOP:
      return !!m.loopConfig?.exited;
    case NodeType.MILESTONE:
      return (m.subtasks || []).length > 0 && m.subtasks.every(isTaskComplete);
    default:
      return m.actionConfig?.lastRun?.status === 'success';
  }
};

/**
 * A node is complete when its work is done *and* any human review gate on it has
 * been satisfied. An unreviewed node stays pending, so the flow does not run
 * ahead of the person who is supposed to sign the work off.
 */
export const isNodeComplete = (m: Milestone, projectData?: Record<string, any>): boolean =>
  isNodeWorkDone(m) && isReviewSatisfied(m, projectData);

/** A node whose work is finished but which is waiting on a human. */
export const isAwaitingReview = (m: Milestone, projectData?: Record<string, any>): boolean =>
  isNodeWorkDone(m) && !isReviewSatisfied(m, projectData);

const getChildren = (milestones: Milestone[], id: string): Milestone[] =>
  milestones.filter(m => (m.dependsOn || []).includes(id));

/**
 * Resolves every node to pending / complete / skipped.
 * A node is skipped when a decided decision parent chose a different branch,
 * or when all of its parents are skipped. Skipped parents don't block a join:
 * a node can proceed when every parent is resolved and at least one is complete.
 */
export const resolveNodeStates = (project: Project): Map<string, NodeResolution> => {
  const milestones = project.milestones;
  const states = new Map<string, NodeResolution>();

  const resolve = (id: string, visiting: Set<string>): NodeResolution => {
    const cached = states.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return 'pending'; // cycle guard
    visiting.add(id);

    const m = milestones.find(mil => mil.id === id);
    if (!m) return 'pending';

    const parents = (m.dependsOn || [])
      .map(pid => milestones.find(mil => mil.id === pid))
      .filter(Boolean) as Milestone[];

    let skipped = false;
    if (parents.length > 0) {
      // Skipped if every parent is skipped...
      skipped = parents.every(p => resolve(p.id, visiting) === 'skipped');
      // ...or any decided decision parent chose a different child
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

/**
 * A node is ready when it isn't complete/skipped itself, every parent is
 * resolved (complete or skipped), and at least one parent is complete
 * (or it has no parents).
 */
export const isNodeReady = (m: Milestone, states: Map<string, NodeResolution>): boolean => {
  const own = states.get(m.id);
  if (own === 'complete' || own === 'skipped') return false;
  const parents = m.dependsOn || [];
  if (parents.length === 0) return true;
  const parentStates = parents.map(pid => states.get(pid) || 'pending');
  return parentStates.every(s => s !== 'pending') && parentStates.some(s => s === 'complete');
};

/**
 * Loop body = nodes forward-reachable from loopStart that can also reach the
 * loop node (excluding the loop node itself).
 */
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
  const reset: Milestone = {
    ...m,
    completedAt: undefined,
    subtasks: (m.subtasks || []).map(s => ({
      ...s,
      status: 'Not started',
      completedAt: undefined,
      approvalStatus: undefined
    })),
    // Cancel rather than delete: the audit trail survives, but a sign-off given
    // for the previous iteration can never satisfy the gate for this one.
    asks: (m.asks || []).map(a => (a.status === 'open' || a.status === 'answered' ? { ...a, status: 'cancelled' as const } : a))
  };
  if (m.decisionConfig) {
    reset.decisionConfig = { ...m.decisionConfig, selectedTargetId: undefined, decidedAt: undefined };
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
  actionsToRun: string[]; // ids of auto-execute action nodes now ready
  /** Ids of nodes whose work is done but which need a review ask raised. */
  asksToOpen: string[];
  log: string[];
}

/**
 * Advances the flow one step (pure function):
 * 1. Decides ready decision nodes (first branch whose conditions all pass wins;
 *    a branch without conditions is the default).
 * 2. Processes ready loop nodes: exits when exit conditions pass or max
 *    iterations reached, otherwise increments the counter and resets the body.
 * 3. Collects ready auto-execute action nodes for the caller to run.
 */
export const advanceFlow = (project: Project): AdvanceResult => {
  let current = project;
  const log: string[] = [];
  const projectData = project.projectData || {};

  // Iterate a few passes so a decision unblocking a loop (etc.) settles in one call
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    const states = resolveNodeStates(current);

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
    }

    if (!changed) break;
  }

  const finalStates = resolveNodeStates(current);
  const actionsToRun = current.milestones
    .filter(m =>
      isActionNode(m) &&
      m.actionConfig?.autoExecute &&
      isNodeReady(m, finalStates) &&
      // A node held at a review gate is neither complete nor skipped, so
      // readiness alone would schedule it again on every pass — redoing the work
      // repeatedly while a person is still looking at the first attempt.
      !isNodeWorkDone(m) &&
      // Likewise for an action still waiting on a provider callback.
      m.actionConfig?.lastRun?.status !== 'pending'
    )
    .map(m => m.id);

  // A node whose work is finished but which is gated on a person needs an ask
  // raised. Skipped nodes are excluded — nobody should be asked to review work
  // on a branch the flow never took.
  const asksToOpen = current.milestones
    .filter(m => finalStates.get(m.id) !== 'skipped' && isNodeWorkDone(m) && needsApprovalAsk(m, current.projectData))
    .map(m => m.id);

  return { project: current, actionsToRun, asksToOpen, log };
};
