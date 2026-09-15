import type { FlowRun, NodeRun } from './flowRuntimeTypes.js';

export interface FlowRunNodeHistory {
  nodeId: string;
  nodeType: string;
  status: NodeRun['status'];
  attemptCount: number;
  updatedAt?: number;
  attempts: Array<{
    id: string;
    attempt: number;
    status: NodeRun['status'];
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
    actionRunId?: string;
    holdIds?: string[];
    askCount: number;
    error?: string;
  }>;
}

/**
 * Produces a member-safe execution history. Deliberately excludes FlowRun state,
 * Ask tokens, provider payloads and action output; those remain backend-only.
 */
export const presentFlowRun = (run: FlowRun) => ({
  id: run.id,
  occurrenceId: run.occurrenceId,
  trigger: run.trigger,
  triggerId: run.triggerId,
  flowId: run.flowId,
  status: run.status,
  revision: run.revision,
  startedAt: run.startedAt,
  updatedAt: run.updatedAt,
  completedAt: run.completedAt,
  cancelledAt: run.cancelledAt,
  error: run.error,
  nodes: Object.entries(run.nodeRuns || {})
    .map(([nodeId, attempts]): FlowRunNodeHistory => {
      const ordered = [...(attempts || [])].sort((a, b) => a.attempt - b.attempt || a.startedAt - b.startedAt);
      const latest = ordered[ordered.length - 1];
      return {
        nodeId,
        nodeType: latest?.nodeType || 'UNKNOWN',
        status: latest?.status || 'pending',
        attemptCount: ordered.length,
        updatedAt: latest?.updatedAt,
        attempts: ordered.map(attempt => ({
          id: attempt.id,
          attempt: attempt.attempt,
          status: attempt.status,
          startedAt: attempt.startedAt,
          updatedAt: attempt.updatedAt,
          completedAt: attempt.completedAt,
          actionRunId: attempt.actionRunId,
          holdIds: attempt.holdIds,
          askCount: attempt.askIds?.length || 0,
          error: attempt.error
        }))
      };
    })
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
});

export const presentFlowRuns = (runs: FlowRun[]) => runs.map(presentFlowRun);
