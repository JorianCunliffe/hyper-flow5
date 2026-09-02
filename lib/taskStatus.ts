import type { Subtask } from '../types.js';

const COMPLETE_STATUSES = new Set(['complete', 'completed']);

export const isTaskComplete = (taskOrStatus: Pick<Subtask, 'status'> | string | undefined): boolean => {
  const status = typeof taskOrStatus === 'string' ? taskOrStatus : taskOrStatus?.status;
  return COMPLETE_STATUSES.has(String(status || '').trim().toLowerCase());
};

export const displayTaskStatus = (status: string): string => isTaskComplete(status) ? 'Completed' : status;
