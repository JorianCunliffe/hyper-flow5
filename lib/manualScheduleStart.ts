import { findProject, listScheduleRuns, readScheduleRun, reserveManualScheduleStart } from './serverStore.js';
import { runTenantSchedule } from './scheduler.js';
import { manualRecoveryOccurrence } from './outboundScheduleRecovery.js';
import { readServiceRunProgress } from './serviceRunProgress.js';
import type { TenantSchedule } from '../types.js';

const defaults = { findProject, listScheduleRuns, readScheduleRun, reserveManualScheduleStart, runTenantSchedule, readServiceRunProgress, now: Date.now };

/** Restart a coaching timer without replaying missed or uncertain calls. */
export async function startScheduleNow(schedule: TenantSchedule, requested?: number, dependencies = defaults) {
  const runs = await dependencies.listScheduleRuns(schedule.orgId, schedule.id, 100);
  const recovery = manualRecoveryOccurrence(runs);
  let scheduledFor = recovery?.scheduledFor ?? requested ?? dependencies.now();
  const exact = requested === undefined ? undefined : await dependencies.readScheduleRun(schedule, requested);
  const located = schedule.activity === 'flow_start' ? await dependencies.findProject(schedule.orgId, schedule.projectId) : null;
  const coaching = located?.project.projectData?.project_template === 'daily_coaching';
  if (coaching && !recovery && !exact) {
    const reserved = schedule.manualStartAt ? await dependencies.readScheduleRun(schedule, schedule.manualStartAt) : null;
    const latest = [...runs, ...(reserved ? [reserved] : [])].sort((a, b) => b.scheduledFor - a.scheduledFor)[0];
    const awaitingClaim = !!schedule.manualStartAt && !reserved;
    if (awaitingClaim) scheduledFor = schedule.manualStartAt!;
    if (coaching && latest && !latest.recoveryResolution) {
      const progress = await dependencies.readServiceRunProgress(schedule, latest, located!.project, latest.scheduledFor);
      if (!progress.canStartNewRun) {
        scheduledFor = latest.scheduledFor;
        if (!awaitingClaim && schedule.manualStartAt !== scheduledFor) {
          // Adopt a pre-upgrade/manual session so the recurring timer also
          // respects its unresolved outcome. This does not change its next time.
          schedule = await dependencies.reserveManualScheduleStart(schedule, scheduledFor, false, dependencies.now());
          scheduledFor = schedule.manualStartAt!;
        }
      }
    }
    if (!awaitingClaim && (!latest || scheduledFor !== latest.scheduledFor)) {
      schedule = await dependencies.reserveManualScheduleStart(schedule, scheduledFor, coaching, dependencies.now());
      scheduledFor = schedule.manualStartAt!;
    }
  }
  return { scheduledFor, nextRunAt: schedule.nextRunAt, scheduleEnabled: schedule.enabled,
    result: await dependencies.runTenantSchedule(schedule, scheduledFor, { advanceSchedule: false }) };
}
