import { NodeType, type Project } from '../types.js';
import { getHoldConfig, isAwaitingReview, resolveNodeStates } from './flowEngine.js';

/** A completed session's review remains open without blocking tomorrow's call. */
export function coachingReviewAllowsNextOccurrence(project: Project): boolean {
  if (project.projectData?.project_template !== 'daily_coaching') return false;
  const states = resolveNodeStates(project);
  const active = project.milestones.filter(node => states.get(node.id) !== 'skipped');
  const reviews = active.filter(node => node.nodeType === NodeType.COACHING_EXTRACT
    && node.actionConfig?.lastRun?.status === 'success'
    && isAwaitingReview(node, project.projectData)
    && node.asks?.some(ask => ask.kind === 'approval' && ask.status === 'open'
      && ask.runId === node.actionConfig?.lastRun?.id && ask.channels.includes('web')));
  if (!reviews.length) return false;
  const blockedByReview = new Set(reviews.map(node => node.id));
  for (let pass = 0; pass < active.length; pass++) {
    for (const node of active) {
      if (node.dependsOn.some(id => blockedByReview.has(id))) blockedByReview.add(node.id);
    }
  }
  return active.every(node => {
    if (states.get(node.id) !== 'complete' && !blockedByReview.has(node.id)) return false;
    const action = node.actionConfig?.lastRun;
    const hold = getHoldConfig(node);
    if (action?.status === 'pending' || action?.status === 'error' || (hold?.holdId && !hold.resolvedAt)) return false;
    return !(node.asks || []).some(ask => ask.status === 'open'
      && (!reviews.includes(node) || ask.kind !== 'approval' || ask.runId !== action?.id));
  });
}
