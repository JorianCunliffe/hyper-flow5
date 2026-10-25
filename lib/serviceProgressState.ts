import type { ServiceRunProgress } from './serviceRunProgress.js';

export const progressBusy = (progress?: ServiceRunProgress | null): boolean =>
  !!progress && !progress.canStartNewRun && ['starting', 'running', 'waiting', 'held'].includes(progress.status);
