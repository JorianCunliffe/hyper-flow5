import type { ActionOutcome } from './flowOrchestrator.js';

/** A recoverable server response holds the same operation; it is not a business failure. */
export const manualActionOutcome = (ok: boolean, status: number, data: any): ActionOutcome => {
  if (!ok || data.status !== 'success') {
    if (status === 503 && data.recoverable === true) {
      return { status: 'pending', recoveryRequired: true, error: data.error, logs: data.logs };
    }
    return { status: 'error', error: data.error || `HTTP ${status}`, logs: data.logs };
  }
  return {
    status: data.pending ? 'pending' : 'success', output: data.output, logs: data.logs,
    externalId: data.externalId, externalExecutionId: data.externalExecutionId,
    externalService: data.externalService, startedAt: data.startedAt
  };
};
