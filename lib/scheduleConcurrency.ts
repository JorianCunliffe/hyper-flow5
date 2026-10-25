import type { TenantSchedule } from '../types.js';
import { findProject, readScheduleRun } from './serverStore.js';
import { readServiceRunProgress } from './serviceRunProgress.js';

/** A restarted daily timer must not overlap its still-unresolved manual call. */
export async function pendingManualScheduleOccurrence(schedule: TenantSchedule, scheduledFor: number,
  dependencies = { findProject, readScheduleRun, readServiceRunProgress }): Promise<number | null> {
  const at = schedule.manualStartAt;
  if (!at || at === scheduledFor || schedule.activity !== 'flow_start') return null;
  const occurrence = await dependencies.readScheduleRun(schedule, at);
  if (!occurrence) return at;
  if (occurrence.recoveryResolution) return null;
  const located = await dependencies.findProject(schedule.orgId, schedule.projectId);
  if (!located) return at;
  const progress = await dependencies.readServiceRunProgress(schedule, occurrence, located.project, at);
  return progress.canStartNewRun ? null : at;
}
