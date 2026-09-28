import type { ActionRun, Milestone } from '../types.js';
import { NodeType } from '../types.js';

export const TRIAGE_BATCH_CHECKPOINT = 'Mailbox batch checkpoint saved; this occurrence will resume before planning';

export const isTriageCheckpoint = (node: Milestone, run?: ActionRun): boolean =>
  node.nodeType === NodeType.EMAIL_TRIAGE && !!run && run.status !== 'success'
  && (run.error === TRIAGE_BATCH_CHECKPOINT || (run.status === 'pending' && run.recoveryRequired === true));

/** Only the uninterrupted unfinished suffix belongs to a legacy manual continuation. */
export const unfinishedTriageRunIds = (node: Milestone, occurrence?: string): string[] => {
  const runs = [...(node.actionConfig?.runHistory || []), ...(node.actionConfig?.lastRun ? [node.actionConfig.lastRun] : [])];
  const ids: string[] = [];
  for (const run of runs.reverse()) {
    if (run.scheduleOccurrenceId !== occurrence || !isTriageCheckpoint(node, run) || !run.id) break;
    ids.push(run.id);
  }
  return [...new Set(ids)];
};
