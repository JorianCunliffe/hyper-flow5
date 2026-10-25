import type { TenantSchedule } from '../types.js';
import { findProject, listScheduleRuns, readScheduleRun } from './serverStore.js';
import { readServiceRunProgress } from './serviceRunProgress.js';

/** A restarted daily timer must not overlap its still-unresolved manual call. */
export async function pendingManualScheduleOccurrence(schedule: TenantSchedule, scheduledFor: number,
  dependencies = { findProject, listScheduleRuns, readScheduleRun, readServiceRunProgress }): Promise<number | null> {
  if (schedule.activity !== 'flow_start' || schedule.manualStartAt === scheduledFor) return null;
  const located = await dependencies.findProject(schedule.orgId, schedule.projectId);
  if (!located) return schedule.manualStartAt || null;
  let at = schedule.manualStartAt;
  let occurrence = at ? await dependencies.readScheduleRun(schedule, at) : null;
  // Sessions started before the reservation field existed still protect the
  // next timer occurrence. Only coaching uses this compatibility lookup.
  if (!at && located.project.projectData?.project_template === 'daily_coaching') {
    occurrence = (await dependencies.listScheduleRuns(schedule.orgId, schedule.id, 1))[0] || null;
    if (!occurrence || occurrence.scheduledFor === scheduledFor) return null;
    at = occurrence.scheduledFor;
  }
  if (!at) return null;
  if (!occurrence) return at;
  if (occurrence.recoveryResolution) return null;
  const progress = await dependencies.readServiceRunProgress(schedule, occurrence, located.project, at);
  return progress.canStartNewRun ? null : at;
}
